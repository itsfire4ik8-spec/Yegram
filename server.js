const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище подключенных пользователей
const users = new Map();

// Статический сервер для клиентских файлов
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// WebSocket соединения
wss.on('connection', (ws) => {
    console.log('Новое подключение');
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'register':
                    // Регистрация пользователя
                    users.set(message.userId, ws);
                    ws.userId = message.userId;
                    console.log(`Пользователь ${message.userId} зарегистрирован`);
                    
                    // Отправляем подтверждение
                    ws.send(JSON.stringify({
                        type: 'registered',
                        userId: message.userId
                    }));
                    break;
                    
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    // Пересылка WebRTC сигналов
                    const targetUser = users.get(message.target);
                    if (targetUser && targetUser.readyState === WebSocket.OPEN) {
                        targetUser.send(JSON.stringify({
                            ...message,
                            sender: ws.userId
                        }));
                        console.log(`Сигнал ${message.type} от ${ws.userId} к ${message.target}`);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Пользователь не найден'
                        }));
                    }
                    break;
                    
                case 'disconnect':
                    console.log(`Пользователь ${ws.userId} отключился`);
                    users.delete(ws.userId);
                    break;
                    
                case 'ping':
                    // Keep-alive
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });
    
    ws.on('close', () => {
        if (ws.userId) {
            console.log(`Пользователь ${ws.userId} отключился`);
            users.delete(ws.userId);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
    });
    
    // Отправляем приветственное сообщение
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Добро пожаловать в Yegram!'
    }));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`📡 WebSocket сервер готов для P2P соединений`);
});
