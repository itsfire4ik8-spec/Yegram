[file name]: app.js
[file content begin]
// Yegram - P2P мессенджер с сохранением аккаунтов
class Yegram {
    constructor() {
        this.currentUser = null;
        this.activeChat = null;
        this.connections = new Map(); // ID друга -> RTCPeerConnection
        this.dataChannels = new Map(); // ID друга -> DataChannel
        this.friends = new Map(); // ID друга -> информация о друге
        this.ws = null;
        
        // Автоматическое определение URL сервера для локальной разработки и Render.com
        this.serverURL = this.getServerUrl();
        
        this.emojiList = this.generateEmojiList();
        
        this.init();
    }

    // Автоматическое определение URL сервера
    getServerUrl() {
        console.log('Определение URL сервера для:', window.location.hostname);
        
        // Если открыто локально (localhost) - используем localhost
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'ws://localhost:10000'; // Порт из вашего server.js
        }
        
        // Если открыто на Render - используем защищенный WSS и текущий домен
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // На Render.com WebSocket должен подключаться к тому же хосту без указания порта
        // (если ваш сервер слушает на порту, который Render проксирует)
        return protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : '');
    }

    async init() {
        console.log('🚀 Yegram инициализируется...');
        console.log('Server URL:', this.serverURL); // Для отладки
        
        // Проверяем WebRTC поддержку
        if (!this.checkWebRTCSupport()) {
            this.showNotification('Ошибка', 'Ваш браузер не поддерживает WebRTC', 'error');
            return;
        }
        
        this.setupEventListeners();
        this.testServerConnection();
        this.loadSavedAccounts();
    }
    
    checkWebRTCSupport() {
        return !!(navigator.mediaDevices && 
                 navigator.mediaDevices.getUserMedia &&
                 window.RTCPeerConnection &&
                 window.RTCSessionDescription &&
                 window.RTCIceCandidate);
    }
    
    async testServerConnection() {
        const statusDot = document.getElementById('server-status');
        const statusText = document.getElementById('status-text');
        
        console.log('Тестируем подключение к серверу:', this.serverURL);
        
        try {
            const ws = new WebSocket(this.serverURL);
            
            ws.onopen = () => {
                console.log('✅ Подключение к серверу установлено');
                statusDot.className = 'status-dot online';
                statusText.textContent = 'Сервер доступен';
                ws.close();
            };
            
            ws.onerror = (error) => {
                console.error('Ошибка подключения к серверу:', error);
                statusDot.className = 'status-dot offline';
                statusText.textContent = 'Сервер недоступен';
                this.showNotification('Ошибка подключения', 'Не удалось подключиться к серверу. Проверьте, запущен ли сервер на Render.com.', 'error');
            };
            
            ws.onmessage = (event) => {
                console.log('Получено сообщение от сервера:', event.data);
            };
            
            setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    console.log('Таймаут подключения к серверу');
                    statusDot.className = 'status-dot offline';
                    statusText.textContent = 'Сервер недоступен';
                    ws.close();
                }
            }, 5000); // Увеличиваем таймаут для Render.com
            
        } catch (error) {
            console.error('Ошибка создания WebSocket:', error);
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Ошибка подключения';
        }
    }
    
    // ==================== УПРАВЛЕНИЕ АККАУНТАМИ ====================
    
    loadSavedAccounts() {
        const accounts = JSON.parse(localStorage.getItem('yegram-accounts') || '[]');
        const container = document.getElementById('saved-accounts-list');
        
        if (!container || accounts.length === 0) return;
        
        container.innerHTML = '<h4>Сохраненные аккаунты</h4>';
        
        accounts.forEach(account => {
            const accountElement = document.createElement('div');
            accountElement.className = 'account-item';
            accountElement.dataset.userId = account.id;
            
            accountElement.innerHTML = `
                <div class="account-avatar" style="background: ${account.avatarColor || '#667eea'}">
                    ${account.name.charAt(0).toUpperCase()}
                </div>
                <div class="account-info">
                    <div class="account-name">${account.name}</div>
                    <div class="account-id">${account.id.substring(0, 16)}...</div>
                </div>
            `;
            
            accountElement.addEventListener('click', () => {
                this.loginToAccount(account.id);
            });
            
            container.appendChild(accountElement);
        });
    }
    
    async createNewAccount() {
        const username = document.getElementById('new-username').value.trim();
        const colorOption = document.querySelector('.color-option.active');
        const avatarColor = colorOption ? colorOption.dataset.color : '#667eea';
        
        if (!username) {
            this.showNotification('Ошибка', 'Введите имя пользователя', 'error');
            return;
        }
        
        const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        this.currentUser = {
            id: userId,
            name: username,
            avatarColor: avatarColor,
            created: Date.now(),
            lastLogin: Date.now()
        };
        
        // Сохраняем аккаунт
        this.saveAccount(this.currentUser);
        
        // Показываем уведомление с ID
        this.showModal(
            'Аккаунт создан!',
            `<p>Ваш аккаунт успешно создан.</p>
             <p><strong>Ваш ID:</strong></p>
             <div class="id-display">
                <code>${userId}</code>
                <button class="btn-icon copy-btn" onclick="navigator.clipboard.writeText('${userId}')">
                    <i class="fas fa-copy"></i>
                </button>
             </div>
             <p class="hint">Сохраните этот ID для входа в будущем!</p>`,
            'Продолжить'
        ).then(() => {
            this.showMainApp();
        });
    }
    
    async loginToAccount(userId) {
        const accounts = JSON.parse(localStorage.getItem('yegram-accounts') || '[]');
        const account = accounts.find(acc => acc.id === userId);
        
        if (!account) {
            this.showNotification('Ошибка', 'Аккаунт не найден', 'error');
            return;
        }
        
        this.currentUser = account;
        this.currentUser.lastLogin = Date.now();
        
        // Обновляем дату последнего входа
        this.saveAccount(this.currentUser);
        
        // Подключаемся к серверу
        await this.connectToServer();
        
        this.showMainApp();
        this.showNotification('Успешно', `Добро пожаловать, ${account.name}!`, 'success');
    }
    
    saveAccount(account) {
        let accounts = JSON.parse(localStorage.getItem('yegram-accounts') || '[]');
        
        // Удаляем старую версию аккаунта если есть
        accounts = accounts.filter(acc => acc.id !== account.id);
        
        // Добавляем обновленный аккаунт
        accounts.push(account);
        
        // Сортируем по дате последнего входа
        accounts.sort((a, b) => b.lastLogin - a.lastLogin);
        
        // Ограничиваем 10 аккаунтами
        if (accounts.length > 10) {
            accounts = accounts.slice(0, 10);
        }
        
        localStorage.setItem('yegram-accounts', JSON.stringify(accounts));
        
        // Сохраняем текущего пользователя отдельно
        localStorage.setItem('yegram-current-user', JSON.stringify(account));
    }
    
    async connectToServer() {
        console.log('Подключаемся к серверу:', this.serverURL);
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket уже открыт');
            return this.ws;
        }
        
        // Если есть старое соединение, закрываем его
        if (this.ws) {
            this.ws.close();
        }
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverURL);
                
                this.ws.onopen = () => {
                    console.log('✅ Подключен к сигнальному серверу');
                    this.updateConnectionStatus('online');
                    
                    // Регистрируем пользователя
                    if (this.currentUser) {
                        console.log('Регистрируем пользователя:', this.currentUser.id);
                        this.ws.send(JSON.stringify({
                            type: 'register',
                            userId: this.currentUser.id
                        }));
                    }
                    
                    // Keep-alive для Render.com
                    if (this.keepAliveInterval) {
                        clearInterval(this.keepAliveInterval);
                    }
                    
                    this.keepAliveInterval = setInterval(() => {
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.ws.send(JSON.stringify({ type: 'ping' }));
                        }
                    }, 45000); // 45 секунд - чтобы Render не разрывал соединение
                    
                    resolve(this.ws);
                };
                
                this.ws.onmessage = (event) => {
                    this.handleServerMessage(event.data);
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket ошибка:', error);
                    this.updateConnectionStatus('error');
                    reject(error);
                };
                
                this.ws.onclose = (event) => {
                    console.log('❌ Отключен от сервера', event.code, event.reason);
                    this.updateConnectionStatus('offline');
                    
                    if (this.keepAliveInterval) {
                        clearInterval(this.keepAliveInterval);
                        this.keepAliveInterval = null;
                    }
                    
                    // Пробуем переподключиться через 5 секунд
                    setTimeout(() => {
                        if (this.currentUser) {
                            console.log('Попытка переподключения...');
                            this.connectToServer();
                        }
                    }, 5000);
                };
                
                // Таймаут подключения
                setTimeout(() => {
                    if (this.ws.readyState !== WebSocket.OPEN) {
                        console.log('Таймаут подключения WebSocket');
                        this.ws.close();
                        reject(new Error('WebSocket connection timeout'));
                    }
                }, 10000);
                
            } catch (error) {
                console.error('Ошибка создания WebSocket:', error);
                reject(error);
            }
        });
    }
    
    // ==================== P2P СОЕДИНЕНИЯ ====================
    
    async connectToFriend(friendId) {
        if (!friendId.trim()) {
            this.showNotification('Ошибка', 'Введите ID друга', 'error');
            return;
        }
        
        if (friendId === this.currentUser.id) {
            this.showNotification('Ошибка', 'Нельзя подключиться к самому себе', 'error');
            return;
        }
        
        if (this.connections.has(friendId)) {
            this.showNotification('Информация', 
                'Соединение с этим пользователем уже установлено', 
                'info');
            return;
        }
        
        try {
            const connection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    // Для лучшей совместимости добавляем fallback STUN серверы
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    // TURN серверы (для пользователей за NAT)
                    // В реальном приложении нужно добавить свои TURN серверы
                    // {
                    //     urls: 'turn:your-turn-server.com:3478',
                    //     username: 'username',
                    //     credential: 'password'
                    // }
                ]
            });
            
            this.connections.set(friendId, connection);
            
            const dataChannel = connection.createDataChannel('chat', {
                ordered: true,
                maxPacketLifeTime: 3000
            });
            
            this.setupDataChannel(dataChannel, friendId);
            
            connection.onicecandidate = (event) => {
                if (event.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    console.log('Отправляем ICE кандидат для:', friendId);
                    this.ws.send(JSON.stringify({
                        type: 'ice-candidate',
                        target: friendId,
                        candidate: event.candidate
                    }));
                }
            };
            
            connection.oniceconnectionstatechange = () => {
                console.log(`ICE соединение с ${friendId}: ${connection.iceConnectionState}`);
            };
            
            connection.onconnectionstatechange = () => {
                console.log(`Соединение с ${friendId}: ${connection.connectionState}`);
                this.updateConnectionState(friendId, connection.connectionState);
            };
            
            const offer = await connection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await connection.setLocalDescription(offer);
            
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'offer',
                    target: friendId,
                    offer: offer
                }));
                
                this.showNotification('Подключение', 
                    `Отправляем запрос на подключение к ${friendId.substring(0, 12)}...`, 
                    'info');
            } else {
                throw new Error('WebSocket не подключен');
            }
            
        } catch (error) {
            console.error('Ошибка подключения:', error);
            this.showNotification('Ошибка', 
                `Не удалось установить соединение: ${error.message}`, 
                'error');
            this.connections.delete(friendId);
        }
    }
    
    async handleOffer(friendId, offer) {
        try {
            console.log('Получен offer от:', friendId);
            
            const connection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' }
                ]
            });
            
            this.connections.set(friendId, connection);
            
            connection.ondatachannel = (event) => {
                const dataChannel = event.channel;
                this.setupDataChannel(dataChannel, friendId);
            };
            
            connection.onicecandidate = (event) => {
                if (event.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'ice-candidate',
                        target: friendId,
                        candidate: event.candidate
                    }));
                }
            };
            
            await connection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'answer',
                    target: friendId,
                    answer: answer
                }));
                
                this.showNotification('Подключение', 
                    `Принят запрос на подключение от ${friendId.substring(0, 12)}...`, 
                    'info');
            }
            
        } catch (error) {
            console.error('Ошибка обработки offer:', error);
            this.showNotification('Ошибка', 
                'Не удалось принять соединение', 
                'error');
            this.connections.delete(friendId);
        }
    }
    
    async handleAnswer(friendId, answer) {
        try {
            console.log('Получен answer от:', friendId);
            const connection = this.connections.get(friendId);
            if (connection) {
                await connection.setRemoteDescription(new RTCSessionDescription(answer));
                console.log(`✅ Установлено соединение с ${friendId}`);
                
                // Запрашиваем информацию о друге
                setTimeout(() => {
                    this.sendData(friendId, {
                        type: 'user-info',
                        user: this.currentUser
                    });
                }, 1000);
                
                this.showNotification('Успешно', 
                    `Соединение установлено!`, 
                    'success');
            }
        } catch (error) {
            console.error('Ошибка обработки answer:', error);
            this.showNotification('Ошибка', 
                'Не удалось завершить соединение', 
                'error');
        }
    }
    
    async handleIceCandidate(friendId, candidate) {
        try {
            console.log('Получен ICE кандидат от:', friendId);
            const connection = this.connections.get(friendId);
            if (connection) {
                await connection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('Ошибка добавления ICE кандидата:', error);
        }
    }
    
    setupDataChannel(dataChannel, friendId) {
        dataChannel.onopen = () => {
            console.log(`✅ DataChannel открыт с ${friendId}`);
            this.dataChannels.set(friendId, dataChannel);
            this.updateConnectionState(friendId, 'connected');
            
            // Отправляем информацию о себе
            setTimeout(() => {
                this.sendData(friendId, {
                    type: 'user-info',
                    user: this.currentUser
                });
            }, 500);
            
            // Обновляем список диалогов
            this.updateDialogsList();
        };
        
        dataChannel.onclose = () => {
            console.log(`❌ DataChannel закрыт с ${friendId}`);
            this.dataChannels.delete(friendId);
            this.updateConnectionState(friendId, 'disconnected');
        };
        
        dataChannel.onerror = (error) => {
            console.error(`DataChannel ошибка с ${friendId}:`, error);
            this.dataChannels.delete(friendId);
            this.updateConnectionState(friendId, 'error');
        };
        
        dataChannel.onmessage = (event) => {
            this.handlePeerMessage(friendId, event.data);
        };
    }
    
    sendData(friendId, data) {
        const dataChannel = this.dataChannels.get(friendId);
        if (dataChannel && dataChannel.readyState === 'open') {
            try {
                dataChannel.send(JSON.stringify(data));
                return true;
            } catch (error) {
                console.error('Ошибка отправки данных:', error);
                return false;
            }
        }
        return false;
    }
    
    // ==================== СООБЩЕНИЯ ====================
    
    async sendMessage(friendId, content, type = 'text') {
        if (!content || !friendId) return false;
        
        const message = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            senderId: this.currentUser.id,
            content: content,
            type: type,
            timestamp: Date.now(),
            status: 'sending',
            reactions: []
        };
        
        const sent = this.sendData(friendId, {
            type: 'message',
            message: message
        });
        
        if (sent) {
            message.status = 'sent';
            this.saveMessage(friendId, message, true);
            
            if (this.activeChat && this.activeChat.friendId === friendId) {
                this.renderMessage(message, true);
                this.scrollToBottom(true);
            }
            
            this.updateDialogsList();
            return true;
        } else {
            message.status = 'error';
            this.saveMessage(friendId, message, true);
            this.showNotification('Ошибка', 
                'Не удалось отправить сообщение. Соединение потеряно.', 
                'error');
            return false;
        }
    }
    
    handlePeerMessage(friendId, data) {
        try {
            const message = JSON.parse(data);
            console.log('Получено сообщение от peer:', message.type, friendId);
            
            switch (message.type) {
                case 'user-info':
                    this.saveFriendInfo(friendId, message.user);
                    this.updateDialogsList();
                    
                    // Если это активный чат, обновляем заголовок
                    if (this.activeChat && this.activeChat.friendId === friendId) {
                        this.updateChatHeader();
                    }
                    break;
                    
                case 'message':
                    const msg = message.message;
                    msg.isOutgoing = false;
                    msg.status = 'delivered';
                    
                    this.saveMessage(friendId, msg, false);
                    this.updateDialogsList();
                    
                    if (this.activeChat && this.activeChat.friendId === friendId) {
                        this.renderMessage(msg, false);
                        this.scrollToBottom(true);
                    } else {
                        // Показываем уведомление
                        const friend = this.getFriendInfo(friendId);
                        if (friend) {
                            this.showNotification(friend.name, 
                                msg.type === 'text' ? msg.content : '📷 Изображение', 
                                'info');
                            this.playNotificationSound();
                        }
                        
                        // Помечаем как непрочитанное
                        this.markDialogAsUnread(friendId);
                    }
                    break;
                    
                case 'typing':
                    this.showTypingIndicator(friendId, message.typing);
                    break;
            }
            
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    }
    
    saveFriendInfo(friendId, userInfo) {
        const friends = JSON.parse(localStorage.getItem('yegram-friends') || '{}');
        friends[friendId] = {
            ...userInfo,
            lastSeen: Date.now()
        };
        localStorage.setItem('yegram-friends', JSON.stringify(friends));
        this.friends.set(friendId, friends[friendId]);
    }
    
    getFriendInfo(friendId) {
        if (this.friends.has(friendId)) {
            return this.friends.get(friendId);
        }
        
        const friends = JSON.parse(localStorage.getItem('yegram-friends') || '{}');
        return friends[friendId];
    }
    
    saveMessage(friendId, message, isOutgoing) {
        const key = `yegram-messages-${friendId}`;
        const messages = JSON.parse(localStorage.getItem(key) || '[]');
        
        message.isOutgoing = isOutgoing;
        messages.push(message);
        
        // Ограничиваем историю 5000 сообщений
        if (messages.length > 5000) {
            messages.splice(0, messages.length - 5000);
        }
        
        localStorage.setItem(key, JSON.stringify(messages));
    }
    
    getMessages(friendId) {
        const key = `yegram-messages-${friendId}`;
        return JSON.parse(localStorage.getItem(key) || '[]');
    }
    
    // ==================== ИНТЕРФЕЙС ====================
    
    showLoginChoice() {
        document.getElementById('login-choice-screen').classList.remove('hidden');
        document.getElementById('create-account-screen').classList.add('hidden');
        document.getElementById('login-id-screen').classList.add('hidden');
        document.getElementById('main-app').classList.add('hidden');
    }
    
    showCreateAccount() {
        document.getElementById('login-choice-screen').classList.add('hidden');
        document.getElementById('create-account-screen').classList.remove('hidden');
    }
    
    showLoginById() {
        document.getElementById('login-choice-screen').classList.add('hidden');
        document.getElementById('login-id-screen').classList.remove('hidden');
        this.loadSavedAccounts();
    }
    
    showMainApp() {
        document.getElementById('login-choice-screen').classList.add('hidden');
        document.getElementById('create-account-screen').classList.add('hidden');
        document.getElementById('login-id-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        
        // Обновляем информацию о пользователе
        document.getElementById('current-username').textContent = this.currentUser.name;
        document.getElementById('avatar-letter').textContent = this.currentUser.name.charAt(0).toUpperCase();
        document.getElementById('user-avatar').style.background = this.currentUser.avatarColor;
        document.getElementById('user-id-text').textContent = this.currentUser.id;
        
        // Загружаем диалоги
        this.updateDialogsList();
        
        // Подключаемся к серверу
        this.connectToServer();
    }
    
    updateDialogsList() {
        const dialogsList = document.getElementById('dialogs-list');
        if (!dialogsList) return;
        
        dialogsList.innerHTML = '';
        
        // Получаем всех друзей из localStorage
        const friends = JSON.parse(localStorage.getItem('yegram-friends') || '{}');
        const friendIds = Object.keys(friends);
        
        if (friendIds.length === 0) {
            dialogsList.innerHTML = `
                <div class="empty-dialogs">
                    <p>Нет диалогов</p>
                    <p class="hint">Подключитесь к другу чтобы начать общение</p>
                </div>
            `;
            return;
        }
        
        // Сортируем по дате последнего сообщения
        const dialogs = friendIds.map(friendId => {
            const messages = this.getMessages(friendId);
            const lastMessage = messages[messages.length - 1];
            
            return {
                friendId: friendId,
                friendInfo: friends[friendId],
                lastMessage: lastMessage,
                unread: this.getUnreadCount(friendId)
            };
        }).sort((a, b) => {
            const timeA = a.lastMessage ? a.lastMessage.timestamp : 0;
            const timeB = b.lastMessage ? b.lastMessage.timestamp : 0;
            return timeB - timeA;
        });
        
        // Отображаем диалоги
        dialogs.forEach(dialog => {
            const dialogElement = this.createDialogElement(dialog);
            dialogsList.appendChild(dialogElement);
        });
    }
    
    createDialogElement(dialog) {
        const div = document.createElement('div');
        div.className = `dialog-item ${this.activeChat?.friendId === dialog.friendId ? 'active' : ''}`;
        div.dataset.friendId = dialog.friendId;
        
        const friend = dialog.friendInfo;
        const lastMessage = dialog.lastMessage;
        const preview = lastMessage ? 
            (lastMessage.type === 'image' ? '📷 Изображение' : lastMessage.content) : 
            'Нет сообщений';
        
        div.innerHTML = `
            <div class="dialog-avatar" style="background: ${friend.avatarColor || '#667eea'}">
                ${friend.name.charAt(0).toUpperCase()}
            </div>
            <div class="dialog-info">
                <div class="dialog-header">
                    <div class="dialog-name">${friend.name}</div>
                    ${lastMessage ? `
                        <div class="dialog-time">${this.formatTime(lastMessage.timestamp, true)}</div>
                    ` : ''}
                </div>
                <div class="dialog-preview">${preview.substring(0, 30)}${preview.length > 30 ? '...' : ''}</div>
                ${dialog.unread > 0 ? `<div class="dialog-unread">${dialog.unread}</div>` : ''}
            </div>
        `;
        
        div.addEventListener('click', () => {
            this.openChat(dialog.friendId);
        });
        
        return div;
    }
    
    openChat(friendId) {
        const friendInfo = this.getFriendInfo(friendId);
        if (!friendInfo) {
            this.showNotification('Ошибка', 'Информация о друге не найдена', 'error');
            return;
        }
        
        this.activeChat = {
            friendId: friendId,
            friendInfo: friendInfo
        };
        
        // Показываем чат
        this.showChat();
        
        // Загружаем сообщения
        this.loadChatMessages(friendId);
        
        // Сбрасываем счетчик непрочитанных
        this.resetUnreadCount(friendId);
        
        // На мобильных скрываем боковую панель
        if (window.innerWidth <= 768) {
            document.querySelector('.sidebar').classList.remove('active');
        }
    }
    
    showChat() {
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('active-chat').classList.remove('hidden');
        this.updateChatHeader();
    }
    
    updateChatHeader() {
        if (!this.activeChat) return;
        
        const { friendId, friendInfo } = this.activeChat;
        
        document.getElementById('chat-title').textContent = friendInfo.name;
        document.getElementById('chat-avatar-letter').textContent = friendInfo.name.charAt(0).toUpperCase();
        document.getElementById('chat-avatar').style.background = friendInfo.avatarColor || '#667eea';
        
        // Обновляем статус соединения
        const connection = this.connections.get(friendId);
        if (connection) {
            this.updateP2PStatus(connection.connectionState);
        } else {
            this.updateP2PStatus('disconnected');
        }
    }
    
    loadChatMessages(friendId) {
        const messages = this.getMessages(friendId);
        this.renderMessages(messages);
        
        // Прокручиваем вниз
        setTimeout(() => {
            this.scrollToBottom(true);
        }, 100);
    }
    
    renderMessages(messages) {
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        
        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-messages">
                    <p>Пока нет сообщений</p>
                    <p class="hint">Начните общение первым!</p>
                </div>
            `;
            return;
        }
        
        let lastDate = null;
        
        messages.forEach(message => {
            // Добавляем дату если она изменилась
            const messageDate = new Date(message.timestamp).toDateString();
            if (messageDate !== lastDate) {
                this.renderDateSeparator(message.timestamp);
                lastDate = messageDate;
            }
            
            this.renderMessage(message, message.isOutgoing);
        });
    }
    
    renderDateSeparator(timestamp) {
        const container = document.getElementById('messages-container');
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        let dateText;
        if (date.toDateString() === today.toDateString()) {
            dateText = 'Сегодня';
        } else if (date.toDateString() === yesterday.toDateString()) {
            dateText = 'Вчера';
        } else {
            dateText = date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        }
        
        const separator = document.createElement('div');
        separator.className = 'date-separator';
        separator.innerHTML = `<span>${dateText}</span>`;
        container.appendChild(separator);
    }
    
    renderMessage(message, isOutgoing) {
        const container = document.getElementById('messages-container');
        const messageElement = this.createMessageElement(message, isOutgoing);
        container.appendChild(messageElement);
    }
    
    createMessageElement(message, isOutgoing) {
        const div = document.createElement('div');
        div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
        div.dataset.messageId = message.id;
        
        const time = this.formatTime(message.timestamp, true);
        const statusIcon = message.status === 'sending' ? '🕐' : 
                          message.status === 'sent' ? '✓' : 
                          message.status === 'error' ? '✗' : '✓✓';
        
        let content = '';
        if (message.type === 'image') {
            content = `
                <div class="message-text">
                    <img src="${message.content}" alt="Изображение" class="message-image" 
                         onclick="yegram.viewImage('${message.content}')">
                </div>
            `;
        } else {
            content = `<div class="message-text">${this.escapeHtml(message.content)}</div>`;
        }
        
        div.innerHTML = `
            <div class="message-content">
                ${content}
                <div class="message-time">
                    ${time}
                    ${isOutgoing ? `<span class="message-status">${statusIcon}</span>` : ''}
                </div>
            </div>
        `;
        
        return div;
    }
    
    scrollToBottom(instant = false) {
        const container = document.getElementById('messages-container');
        const wrapper = document.querySelector('.messages-wrapper');
        
        if (instant) {
            container.scrollTop = container.scrollHeight;
        } else {
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
            
            if (isNearBottom) {
                container.scrollTop = container.scrollHeight;
            } else {
                // Показываем индикатор новых сообщений
                const indicator = document.getElementById('scroll-indicator');
                indicator.classList.remove('hidden');
                
                indicator.onclick = () => {
                    container.scrollTop = container.scrollHeight;
                    indicator.classList.add('hidden');
                };
            }
        }
    }
    
    showTypingIndicator(friendId, isTyping) {
        const indicator = document.getElementById('typing-indicator');
        
        if (this.activeChat && this.activeChat.friendId === friendId) {
            if (isTyping) {
                indicator.classList.remove('hidden');
            } else {
                indicator.classList.add('hidden');
            }
        }
    }
    
    // ==================== УТИЛИТЫ ====================
    
    formatTime(timestamp, includeSeconds = false) {
        const date = new Date(timestamp);
        const now = new Date();
        
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
                ...(includeSeconds && { second: '2-digit' })
            });
        }
        
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Вчера ' + date.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        }) + ' ' + date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showNotification(title, message, type = 'info') {
        const container = document.getElementById('notifications');
        if (!container) return;
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-times-circle',
            info: 'fas fa-info-circle',
            warning: 'fas fa-exclamation-triangle'
        };
        
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="${icons[type] || icons.info}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
        `;
        
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }
    
    showModal(title, content, confirmText = 'OK') {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal');
            const modalTitle = document.getElementById('modal-title');
            const modalBody = document.getElementById('modal-body');
            const modalConfirm = document.getElementById('modal-confirm');
            
            modalTitle.textContent = title;
            modalBody.innerHTML = content;
            modalConfirm.textContent = confirmText;
            
            modal.classList.remove('hidden');
            
            const closeModal = () => {
                modal.classList.add('hidden');
                resolve();
            };
            
            document.querySelector('.close-modal').onclick = closeModal;
            document.getElementById('modal-cancel').onclick = closeModal;
            modalConfirm.onclick = closeModal;
        });
    }
    
    playNotificationSound() {
        const audio = document.getElementById('notification-sound');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
    }
    
    updateConnectionStatus(status) {
        const dot = document.getElementById('connection-dot');
        const text = document.getElementById('connection-status');
        
        if (!dot || !text) return;
        
        switch (status) {
            case 'online':
                dot.className = 'status-dot online';
                text.textContent = 'Подключен к серверу';
                break;
            case 'offline':
                dot.className = 'status-dot offline';
                text.textContent = 'Не подключен';
                break;
            case 'error':
                dot.className = 'status-dot offline';
                text.textContent = 'Ошибка подключения';
                break;
        }
    }
    
    updateP2PStatus(status) {
        const dot = document.getElementById('p2p-status-dot');
        const text = document.getElementById('p2p-status-text');
        
        if (!dot || !text) return;
        
        switch (status) {
            case 'connected':
                dot.className = 'status-dot online';
                text.textContent = 'P2P соединение активно';
                break;
            case 'connecting':
                dot.className = 'status-dot connecting';
                text.textContent = 'Установка P2P...';
                break;
            case 'disconnected':
                dot.className = 'status-dot offline';
                text.textContent = 'Нет P2P соединения';
                break;
        }
    }
    
    updateConnectionState(friendId, state) {
        if (this.activeChat && this.activeChat.friendId === friendId) {
            this.updateP2PStatus(state);
        }
    }
    
    handleServerMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('Получено сообщение от сервера:', message.type);
            
            switch (message.type) {
                case 'welcome':
                    console.log('✅ Получено приветственное сообщение');
                    break;
                    
                case 'registered':
                    console.log('✅ Зарегистрирован на сервере');
                    this.showNotification('Успех', 'Подключено к серверу', 'success');
                    break;
                    
                case 'offer':
                    console.log('Получен offer от:', message.sender);
                    this.handleOffer(message.sender, message.offer);
                    break;
                    
                case 'answer':
                    console.log('Получен answer от:', message.sender);
                    this.handleAnswer(message.sender, message.answer);
                    break;
                    
                case 'ice-candidate':
                    console.log('Получен ICE кандидат от:', message.sender);
                    this.handleIceCandidate(message.sender, message.candidate);
                    break;
                    
                case 'error':
                    console.error('Ошибка сервера:', message.message);
                    this.showNotification('Ошибка сервера', message.message, 'error');
                    break;
                    
                case 'pong':
                    // Keep-alive ответ
                    break;
                    
                default:
                    console.log('Неизвестный тип сообщения:', message.type);
            }
            
        } catch (error) {
            console.error('Ошибка обработки сообщения сервера:', error, data);
        }
    }
    
    generateEmojiList() {
        return {
            smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳'],
            gestures: ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏'],
            objects: ['💡', '📱', '📲', '💻', '⌨️', '🖥', '🖨', '🖱', '🖲', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽', '🎞', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙', '🎚', '🎛', '🧭']
        };
    }
    
    getUnreadCount(friendId) {
        const key = `yegram-unread-${friendId}`;
        return parseInt(localStorage.getItem(key) || '0');
    }
    
    markDialogAsUnread(friendId) {
        const key = `yegram-unread-${friendId}`;
        const count = this.getUnreadCount(friendId) + 1;
        localStorage.setItem(key, count.toString());
        this.updateDialogsList();
    }
    
    resetUnreadCount(friendId) {
        const key = `yegram-unread-${friendId}`;
        localStorage.setItem(key, '0');
        this.updateDialogsList();
    }
    
    // ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
    
    setupEventListeners() {
        // Выбор входа
        document.getElementById('new-account-btn').addEventListener('click', () => {
            this.showCreateAccount();
        });
        
        document.getElementById('existing-account-btn').addEventListener('click', () => {
            this.showLoginById();
        });
        
        // Назад к выбору
        document.getElementById('back-to-choice-btn').addEventListener('click', () => {
            this.showLoginChoice();
        });
        
        document.getElementById('back-to-choice-btn-2').addEventListener('click', () => {
            this.showLoginChoice();
        });
        
        // Выбор цвета
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => {
                document.querySelectorAll('.color-option').forEach(o => {
                    o.classList.remove('active');
                });
                e.target.classList.add('active');
            });
        });
        
        // Создание аккаунта
        document.getElementById('create-account-btn').addEventListener('click', () => {
            this.createNewAccount();
        });
        
        // Вход по ID
        document.getElementById('login-id-btn').addEventListener('click', () => {
            const userId = document.getElementById('user-id-input').value.trim();
            if (userId) {
                this.loginToAccount(userId);
            } else {
                this.showNotification('Ошибка', 'Введите ID аккаунта', 'error');
            }
        });
        
        // Подключение к другу
        document.getElementById('connect-btn').addEventListener('click', () => {
            const friendId = document.getElementById('friend-search-input').value.trim();
            this.connectToFriend(friendId);
            document.getElementById('friend-search-input').value = '';
        });
        
        // Копирование ID
        document.getElementById('copy-id-btn').addEventListener('click', () => {
            if (this.currentUser) {
                navigator.clipboard.writeText(this.currentUser.id)
                    .then(() => this.showNotification('Скопировано', 'ID скопирован в буфер', 'success'))
                    .catch(() => this.showNotification('Ошибка', 'Не удалось скопировать ID', 'error'));
            }
        });
        
        // Отправка сообщения
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        
        const sendMessage = () => {
            const content = messageInput.value.trim();
            if (content && this.activeChat) {
                this.sendMessage(this.activeChat.friendId, content);
                messageInput.value = '';
                messageInput.style.height = 'auto';
                
                // Скрываем индикатор набора
                if (this.activeChat) {
                    this.sendData(this.activeChat.friendId, {
                        type: 'typing',
                        typing: false
                    });
                }
            }
        };
        
        sendBtn.addEventListener('click', sendMessage);
        
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Автоматическое увеличение высоты textarea
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
            
            // Отправляем индикатор набора
            if (this.activeChat && messageInput.value.trim()) {
                this.sendData(this.activeChat.friendId, {
                    type: 'typing',
                    typing: true
                });
            }
        });
        
        // Эмодзи
        document.getElementById('emoji-btn').addEventListener('click', () => {
            const picker = document.getElementById('emoji-picker');
            picker.classList.toggle('hidden');
            this.loadEmojiGrid('smileys');
        });
        
        // Категории эмодзи
        document.querySelectorAll('.emoji-category').forEach(category => {
            category.addEventListener('click', (e) => {
                document.querySelectorAll('.emoji-category').forEach(c => {
                    c.classList.remove('active');
                });
                e.target.classList.add('active');
                this.loadEmojiGrid(e.target.dataset.category);
            });
        });
        
        // Назад к диалогам
        document.getElementById('back-to-dialogs-btn').addEventListener('click', () => {
            document.getElementById('active-chat').classList.add('hidden');
            document.getElementById('welcome-screen').classList.remove('hidden');
            this.activeChat = null;
        });
        
        // Меню пользователя
        const userMenuBtn = document.getElementById('user-menu-btn');
        const userMenu = document.getElementById('user-menu');
        
        userMenuBtn.addEventListener('click', () => {
            userMenu.classList.toggle('hidden');
        });
        
        document.addEventListener('click', (e) => {
            if (!userMenuBtn.contains(e.target) && !userMenu.contains(e.target)) {
                userMenu.classList.add('hidden');
            }
        });
        
        // Действия в меню
        document.getElementById('switch-account').addEventListener('click', () => {
            this.showLoginChoice();
            userMenu.classList.add('hidden');
        });
        
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
            userMenu.classList.add('hidden');
        });
        
        // Обновление диалогов
        document.getElementById('refresh-dialogs-btn').addEventListener('click', () => {
            this.updateDialogsList();
            this.showNotification('Обновлено', 'Список диалогов обновлен', 'success');
        });
    }
    
    loadEmojiGrid(category) {
        const grid = document.getElementById('emoji-grid');
        if (!grid || !this.emojiList[category]) return;
        
        grid.innerHTML = '';
        
        this.emojiList[category].forEach(emoji => {
            const emojiElement = document.createElement('div');
            emojiElement.className = 'emoji-item';
            emojiElement.textContent = emoji;
            emojiElement.title = emoji;
            
            emojiElement.addEventListener('click', () => {
                const messageInput = document.getElementById('message-input');
                messageInput.value += emoji;
                messageInput.focus();
                
                // Скрываем пикер после выбора
                document.getElementById('emoji-picker').classList.add('hidden');
            });
            
            grid.appendChild(emojiElement);
        });
    }
    
    logout() {
        console.log('Выход из аккаунта');
        
        // Закрываем все соединения
        this.connections.forEach((connection, friendId) => {
            connection.close();
        });
        
        this.dataChannels.forEach((channel, friendId) => {
            channel.close();
        });
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'disconnect' }));
            this.ws.close();
        }
        
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        
        this.connections.clear();
        this.dataChannels.clear();
        this.currentUser = null;
        this.activeChat = null;
        
        // Удаляем текущего пользователя
        localStorage.removeItem('yegram-current-user');
        
        this.showLoginChoice();
        this.showNotification('Выход', 'Вы вышли из аккаунта', 'info');
    }
    
    viewImage(src) {
        window.open(src, '_blank');
    }
}

// Инициализация приложения
let yegram;
document.addEventListener('DOMContentLoaded', () => {
    yegram = new Yegram();
    
    // Проверяем, есть ли сохраненный пользователь
    const savedUser = localStorage.getItem('yegram-current-user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            // Автоматический вход если прошло меньше суток
            const timeSinceLastLogin = Date.now() - (user.lastLogin || 0);
            if (timeSinceLastLogin < 24 * 60 * 60 * 1000) {
                yegram.currentUser = user;
                yegram.showMainApp();
            }
        } catch (error) {
            console.error('Ошибка загрузки сохраненного пользователя:', error);
        }
    }
});
[file content end]
