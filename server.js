const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
    }
});

// Хранилище подключенных пользователей
const users = new Map();

// Статический сервер для клиентских файлов
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint для Render.com
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        users: users.size,
        timestamp: new Date().toISOString()
    });
});

// WebSocket соединения
wss.on('connection', (ws, req) => {
    console.log('Новое подключение от:', req.socket.remoteAddress);
    
    // Настройка keep-alive
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'register':
                    // Регистрация пользователя
                    if (users.has(message.userId)) {
                        // Если пользователь уже подключен, закрываем старое соединение
                        const oldWs = users.get(message.userId);
                        if (oldWs !== ws) {
                            oldWs.close(1000, 'Новое подключение с тем же ID');
                        }
                    }
                    
                    users.set(message.userId, ws);
                    ws.userId = message.userId;
                    console.log(`✅ Пользователь ${message.userId} зарегистрирован (всего: ${users.size})`);
                    
                    // Отправляем подтверждение
                    ws.send(JSON.stringify({
                        type: 'registered',
                        userId: message.userId,
                        timestamp: Date.now()
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
                            sender: ws.userId,
                            timestamp: Date.now()
                        }));
                        console.log(`📤 Сигнал ${message.type} от ${ws.userId} к ${message.target}`);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Пользователь не в сети или не найден',
                            code: 'USER_OFFLINE',
                            timestamp: Date.now()
                        }));
                    }
                    break;
                    
                case 'disconnect':
                    console.log(`❌ Пользователь ${ws.userId} запросил отключение`);
                    if (ws.userId) {
                        users.delete(ws.userId);
                    }
                    break;
                    
                case 'ping':
                    // Keep-alive
                    ws.send(JSON.stringify({ 
                        type: 'pong',
                        timestamp: Date.now()
                    }));
                    break;
                    
                default:
                    console.log('Неизвестный тип сообщения:', message.type);
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Ошибка обработки сообщения',
                error: error.message,
                timestamp: Date.now()
            }));
        }
    });
    
    ws.on('close', (code, reason) => {
        if (ws.userId) {
            console.log(`❌ Пользователь ${ws.userId} отключился (код: ${code}, причина: ${reason || 'нет'})`);
            users.delete(ws.userId);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка для пользователя', ws.userId || 'неизвестный', ':', error);
    });
    
    // Отправляем приветственное сообщение
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Добро пожаловать в Yegram!',
        serverTime: Date.now(),
        onlineUsers: users.size
    }));
});

// Keep-alive интервал
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log(`⚠️ Закрываем неактивное соединение: ${ws.userId || 'неизвестный'}`);
            return ws.terminate();
        }
        
        ws.isAlive = false;
        try {
            ws.ping();
        } catch (error) {
            console.error('Ошибка ping:', error);
        }
    });
}, 30000); // 30 секунд

wss.on('close', () => {
    clearInterval(interval);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📡 WebSocket сервер готов для P2P соединений`);
    console.log(`🌐 Health check доступен по: http://localhost:${PORT}/health`);
    
    // Логируем информацию о сервере
    console.log('Серверная информация:');
    console.log('- Память:', process.memoryUsage());
    console.log('- Платформа:', process.platform);
    console.log('- Node версия:', process.version);
});
