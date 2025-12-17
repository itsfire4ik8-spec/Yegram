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
        this.reconnectionAttempts = new Map(); // Для отслеживания попыток переподключения
        this.maxReconnectionAttempts = 5; // Максимальное количество попыток переподключения
        
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
        return `${protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`;
    }

    async init() {
        console.log('🚀 Yegram инициализируется...');
        console.log('Server URL:', this.serverURL);
        
        // Проверяем WebRTC поддержку
        if (!this.checkWebRTCSupport()) {
            this.showNotification('Ошибка', 'Ваш браузер не поддерживает WebRTC. Пожалуйста, используйте современный браузер.', 'error');
            return;
        }
        
        this.setupEventListeners();
        this.testServerConnection();
        this.loadSavedAccounts();
        
        // Определяем платформу
        this.detectPlatform();
        
        // Обработка видимости страницы
        this.setupPageVisibility();
        
        // Автоматическое подключение при возвращении на страницу
        this.setupAutoReconnect();
    }
    
    detectPlatform() {
        const userAgent = navigator.userAgent.toLowerCase();
        const isMobile = /mobile|android|iphone|ipad|ipod|windows phone/i.test(userAgent);
        const isTablet = /tablet|ipad|android(?!.*mobile)/i.test(userAgent);
        
        if (isMobile) {
            document.body.classList.add('mobile');
            document.body.classList.add('telegram-style');
        }
        if (isTablet) {
            document.body.classList.add('tablet');
        }
        
        console.log('Платформа:', { isMobile, isTablet });
    }
    
    checkWebRTCSupport() {
        // Проверяем основные WebRTC API
        const requiredAPIs = [
            'RTCPeerConnection',
            'RTCSessionDescription',
            'RTCIceCandidate'
        ];
        
        for (const api of requiredAPIs) {
            if (!window[api]) {
                console.error(`Отсутствует ${api}`);
                return false;
            }
        }
        
        return true;
    }
    
    setupPageVisibility() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.currentUser) {
                console.log('Страница стала видимой, переподключаемся...');
                this.connectToServer();
                
                // Переподключаемся ко всем друзьям
                setTimeout(() => {
                    this.reconnectToAllFriends();
                }, 1000);
            }
        });
    }
    
    setupAutoReconnect() {
        // Автоматический реконнект каждые 30 секунд если соединение потеряно
        setInterval(() => {
            if (this.currentUser) {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    console.log('Автоматическое переподключение к серверу...');
                    this.connectToServer();
                }
                
                // Проверяем P2P соединения
                this.checkAndReconnectP2P();
            }
        }, 30000);
    }
    
    async testServerConnection() {
        const statusDot = document.getElementById('server-status');
        const statusText = document.getElementById('status-text');
        
        if (!statusDot || !statusText) return;
        
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
            };
            
            setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    console.log('Таймаут подключения к серверу');
                    statusDot.className = 'status-dot offline';
                    statusText.textContent = 'Сервер недоступен';
                    ws.close();
                }
            }, 5000);
            
        } catch (error) {
            console.error('Ошибка создания WebSocket:', error);
            if (statusDot && statusText) {
                statusDot.className = 'status-dot offline';
                statusText.textContent = 'Ошибка подключения';
            }
        }
    }
    
    // ==================== УПРАВЛЕНИЕ АККАУНТАМИ ====================
    
    loadSavedAccounts() {
        const accounts = JSON.parse(localStorage.getItem('yegram-accounts') || '[]');
        const container = document.getElementById('saved-accounts-list');
        
        if (!container) return;
        
        container.innerHTML = '';
        
        if (accounts.length === 0) {
            container.innerHTML = '<p class="no-accounts">Нет сохраненных аккаунтов</p>';
            return;
        }
        
        container.innerHTML = '<h4>Сохраненные аккаунты</h4>';
        
        accounts.forEach(account => {
            const accountElement = this.createAccountElement(account);
            container.appendChild(accountElement);
        });
    }
    
    createAccountElement(account) {
        const accountElement = document.createElement('div');
        accountElement.className = 'account-item';
        accountElement.dataset.userId = account.id;
        
        const displayName = account.username && account.username.trim() !== '' ? 
            `@${account.username}` : account.name;
        
        accountElement.innerHTML = `
            <div class="account-avatar" style="background: ${account.avatarColor || '#667eea'}">
                ${account.name.charAt(0).toUpperCase()}
            </div>
            <div class="account-info">
                <div class="account-name">${displayName}</div>
                <div class="account-realname">${account.name}</div>
            </div>
        `;
        
        accountElement.addEventListener('click', () => {
            this.loginToAccount(account.id);
        });
        
        return accountElement;
    }
    
    async createNewAccount() {
        const username = document.getElementById('new-username').value.trim();
        const colorOption = document.querySelector('.color-option.active');
        const avatarColor = colorOption ? colorOption.dataset.color : '#667eea';
        
        if (!username) {
            this.showNotification('Ошибка', 'Введите имя пользователя', 'error');
            return;
        }
        
        // Генерируем полностью новый ID
        const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12);
        
        // Создаем новый аккаунт с чистым состоянием
        this.currentUser = {
            id: userId,
            name: username,
            username: '',
            avatarColor: avatarColor,
            created: Date.now(),
            lastLogin: Date.now(),
            isNew: true // Флаг нового аккаунта
        };
        
        // Сохраняем аккаунт (старые данные не трогаем, сохраняем только новый аккаунт)
        this.saveAccount(this.currentUser, true);
        
        // Очищаем данные старого пользователя из текущей сессии
        this.cleanupOldUserData();
        
        // Показываем уведомление с ID
        this.showModal(
            'Аккаунт создан!',
            `<div class="success-modal">
                <div class="success-icon">✓</div>
                <p><strong>Ваш аккаунт успешно создан!</strong></p>
                <p><strong>Имя:</strong> ${username}</p>
                <p><strong>Ваш ID:</strong></p>
                <div class="id-display">
                    <code>${userId}</code>
                    <button class="btn-icon copy-btn" onclick="navigator.clipboard.writeText('${userId}')">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
                <p class="hint">Сохраните этот ID для входа в будущем!</p>
                <p class="hint">Вы можете установить юзернейм в настройках профиля</p>
            </div>`,
            'Начать общение'
        ).then(() => {
            this.showMainApp();
        });
    }
    
    cleanupOldUserData() {
        // Очищаем только сессионные данные, но не удаляем сохраненные аккаунты
        this.connections.clear();
        this.dataChannels.clear();
        this.friends.clear();
        this.activeChat = null;
        
        // Очищаем текущего пользователя из localStorage
        localStorage.removeItem('yegram-current-user');
    }
    
    saveAccount(account, isNew = false) {
        let accounts = JSON.parse(localStorage.getItem('yegram-accounts') || '[]');
        
        if (isNew) {
            // Для нового аккаунта просто добавляем
            accounts.push(account);
        } else {
            // Для существующего - обновляем
            accounts = accounts.filter(acc => acc.id !== account.id);
            accounts.push(account);
        }
        
        // Сортируем по дате последнего входа
        accounts.sort((a, b) => b.lastLogin - a.lastLogin);
        
        // Ограничиваем 20 аккаунтами
        if (accounts.length > 20) {
            accounts = accounts.slice(0, 20);
        }
        
        localStorage.setItem('yegram-accounts', JSON.stringify(accounts));
        
        // Сохраняем текущего пользователя отдельно
        localStorage.setItem('yegram-current-user', JSON.stringify(account));
    }
    
    async loginToAccount(userId) {
        const accounts = JSON.parse(localStorage.getItem('yegram-accounts') || '[]');
        const account = accounts.find(acc => acc.id === userId);
        
        if (!account) {
            this.showNotification('Ошибка', 'Аккаунт не найден', 'error');
            return;
        }
        
        // Очищаем текущие соединения
        this.connections.clear();
        this.dataChannels.clear();
        this.activeChat = null;
        
        this.currentUser = account;
        this.currentUser.lastLogin = Date.now();
        
        // Обновляем дату последнего входа
        this.saveAccount(this.currentUser);
        
        // Подключаемся к серверу
        await this.connectToServer();
        
        this.showMainApp();
        this.showNotification('Успешно', `Добро пожаловать, ${account.name}!`, 'success');
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
                            userId: this.currentUser.id,
                            userInfo: {
                                name: this.currentUser.name,
                                username: this.currentUser.username,
                                avatarColor: this.currentUser.avatarColor
                            }
                        }));
                    }
                    
                    // Keep-alive для Render.com
                    if (this.keepAliveInterval) {
                        clearInterval(this.keepAliveInterval);
                    }
                    
                    this.keepAliveInterval = setInterval(() => {
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.ws.send(JSON.stringify({ 
                                type: 'ping',
                                timestamp: Date.now()
                            }));
                        }
                    }, 25000); // 25 секунд
                    
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
                    
                    // Пробуем переподключиться через 3 секунды
                    setTimeout(() => {
                        if (this.currentUser) {
                            console.log('Попытка переподключения к серверу...');
                            this.connectToServer();
                        }
                    }, 3000);
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
        // Поддержка поиска по юзернейму
        const input = friendId.trim();
        let actualFriendId = friendId;
        
        // Если начинается с @, ищем по юзернейму
        if (input.startsWith('@')) {
            const username = input.substring(1);
            const foundFriend = this.findFriendByUsername(username);
            
            if (foundFriend) {
                actualFriendId = foundFriend.id;
                console.log('Найден друг по юзернейму:', username, 'ID:', actualFriendId);
            } else {
                this.showNotification('Ошибка', `Пользователь @${username} не найден`, 'error');
                return;
            }
        }
        
        if (!actualFriendId) {
            this.showNotification('Ошибка', 'Введите ID или юзернейм друга', 'error');
            return;
        }
        
        if (actualFriendId === this.currentUser.id) {
            this.showNotification('Ошибка', 'Нельзя подключиться к самому себе', 'error');
            return;
        }
        
        if (this.connections.has(actualFriendId)) {
            const connection = this.connections.get(actualFriendId);
            if (connection.connectionState === 'connected') {
                this.showNotification('Информация', 
                    'Соединение с этим пользователем уже установлено', 
                    'info');
                return;
            }
        }
        
        // Сбрасываем счетчик попыток
        this.reconnectionAttempts.set(actualFriendId, 0);
        
        this.showNotification('Подключение', 
            'Устанавливаем P2P соединение...', 
            'info');
        
        await this.createP2PConnection(actualFriendId);
    }
    
    async createP2PConnection(friendId) {
        try {
            // Оптимизированные ICE серверы для всех устройств
            const iceServers = [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.stunprotocol.org:3478' },
                // Для мобильных и сложных сетей
                { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
            ];
            
            const connection = new RTCPeerConnection({ 
                iceServers,
                iceCandidatePoolSize: 10,
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require'
            });
            
            this.connections.set(friendId, connection);
            
            // Настройка DataChannel с оптимизациями
            const dataChannel = connection.createDataChannel('yegram-chat', {
                ordered: true,
                maxPacketLifeTime: 10000,
                negotiated: true,
                id: 0,
                protocol: 'json'
            });
            
            this.setupDataChannel(dataChannel, friendId);
            
            connection.onicecandidate = (event) => {
                if (event.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'ice-candidate',
                        target: friendId,
                        candidate: event.candidate,
                        timestamp: Date.now()
                    }));
                }
            };
            
            connection.oniceconnectionstatechange = () => {
                const state = connection.iceConnectionState;
                console.log(`ICE соединение с ${friendId}: ${state}`);
                
                if (state === 'connected' || state === 'completed') {
                    this.updateConnectionState(friendId, 'connected');
                    this.showNotification('Успех', 'P2P соединение установлено!', 'success');
                } else if (state === 'failed' || state === 'disconnected') {
                    this.handleConnectionFailure(friendId);
                }
            };
            
            connection.onconnectionstatechange = () => {
                const state = connection.connectionState;
                console.log(`Соединение с ${friendId}: ${state}`);
                this.updateConnectionState(friendId, state);
            };
            
            connection.onsignalingstatechange = () => {
                console.log(`Signaling состояние с ${friendId}: ${connection.signalingState}`);
            };
            
            // Создаем offer с оптимизациями
            const offer = await connection.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false,
                iceRestart: false
            });
            
            await connection.setLocalDescription(offer);
            
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'offer',
                    target: friendId,
                    offer: offer,
                    timestamp: Date.now()
                }));
                
                console.log('Offer отправлен для:', friendId);
            } else {
                throw new Error('WebSocket не подключен');
            }
            
            // Таймаут для установки соединения
            setTimeout(() => {
                if (connection.iceConnectionState !== 'connected' && 
                    connection.iceConnectionState !== 'completed') {
                    console.log('Таймаут установки P2P соединения');
                    this.handleConnectionTimeout(friendId);
                }
            }, 15000);
            
        } catch (error) {
            console.error('Ошибка создания P2P соединения:', error);
            this.showNotification('Ошибка', 
                `Не удалось установить соединение: ${error.message}`, 
                'error');
            this.connections.delete(friendId);
        }
    }
    
    handleConnectionFailure(friendId) {
        const attempts = this.reconnectionAttempts.get(friendId) || 0;
        
        if (attempts < this.maxReconnectionAttempts) {
            this.reconnectionAttempts.set(friendId, attempts + 1);
            
            console.log(`Попытка переподключения ${attempts + 1}/${this.maxReconnectionAttempts} к ${friendId}`);
            
            setTimeout(() => {
                this.reconnectToFriend(friendId);
            }, 2000 * (attempts + 1)); // Экспоненциальная задержка
        } else {
            this.showNotification('Ошибка', 
                'Не удалось установить P2P соединение. Проверьте интернет и попробуйте позже.', 
                'error');
            this.connections.delete(friendId);
        }
    }
    
    handleConnectionTimeout(friendId) {
        const connection = this.connections.get(friendId);
        if (connection) {
            connection.close();
            this.connections.delete(friendId);
            this.dataChannels.delete(friendId);
        }
        
        this.showNotification('Таймаут', 
            'Время установки соединения истекло. Попробуйте снова.', 
            'warning');
    }
    
    async reconnectToFriend(friendId) {
        console.log('Пробуем переподключиться к:', friendId);
        
        // Закрываем старое соединение
        const oldConnection = this.connections.get(friendId);
        if (oldConnection) {
            oldConnection.close();
        }
        
        this.connections.delete(friendId);
        this.dataChannels.delete(friendId);
        
        // Ждем перед повторной попыткой
        setTimeout(() => {
            this.connectToFriend(friendId);
        }, 1000);
    }
    
    reconnectToAllFriends() {
        const friends = JSON.parse(localStorage.getItem('yegram-friends') || '{}');
        Object.keys(friends).forEach(friendId => {
            const dc = this.dataChannels.get(friendId);
            if (!dc || dc.readyState !== 'open') {
                console.log('Пробуем переподключиться к другу:', friendId);
                setTimeout(() => {
                    this.connectToFriend(friendId);
                }, Math.random() * 3000); // Случайная задержка чтобы не перегружать
            }
        });
    }
    
    checkAndReconnectP2P() {
        this.dataChannels.forEach((dc, friendId) => {
            if (dc.readyState !== 'open') {
                console.log('Проверка соединения с', friendId, 'статус:', dc.readyState);
                this.reconnectToFriend(friendId);
            }
        });
    }
    
    findFriendByUsername(username) {
        const friends = JSON.parse(localStorage.getItem('yegram-friends') || '{}');
        return Object.values(friends).find(friend => 
            friend.username && friend.username.toLowerCase() === username.toLowerCase()
        );
    }
    
    async handleOffer(friendId, offer) {
        try {
            console.log('Получен offer от:', friendId);
            
            const iceServers = [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.stunprotocol.org:3478' }
            ];
            
            const connection = new RTCPeerConnection({ 
                iceServers,
                iceCandidatePoolSize: 10
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
                    answer: answer,
                    timestamp: Date.now()
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
                
                // Отправляем информацию о себе
                setTimeout(() => {
                    this.sendData(friendId, {
                        type: 'user-info',
                        user: this.currentUser,
                        timestamp: Date.now()
                    });
                }, 500);
                
                this.showNotification('Успешно', 
                    `P2P соединение установлено!`, 
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
            
            // Сбрасываем счетчик попыток
            this.reconnectionAttempts.delete(friendId);
            
            // Отправляем информацию о себе
            setTimeout(() => {
                this.sendData(friendId, {
                    type: 'user-info',
                    user: this.currentUser,
                    timestamp: Date.now()
                });
            }, 300);
            
            // Обновляем список диалогов
            this.updateDialogsList();
            
            // Обновляем UI если это активный чат
            if (this.activeChat && this.activeChat.friendId === friendId) {
                this.updateChatHeader();
            }
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
        
        // Keep-alive для DataChannel
        const keepAliveInterval = setInterval(() => {
            if (dataChannel.readyState === 'open') {
                try {
                    dataChannel.send(JSON.stringify({ 
                        type: 'ping',
                        timestamp: Date.now()
                    }));
                } catch (error) {
                    console.error('Ошибка keep-alive:', error);
                    clearInterval(keepAliveInterval);
                }
            } else {
                clearInterval(keepAliveInterval);
            }
        }, 20000);
        
        dataChannel._keepAliveInterval = keepAliveInterval;
    }
    
    sendData(friendId, data) {
        const dataChannel = this.dataChannels.get(friendId);
        if (dataChannel && dataChannel.readyState === 'open') {
            try {
                dataChannel.send(JSON.stringify(data));
                return true;
            } catch (error) {
                console.error('Ошибка отправки данных:', error);
                
                // Пробуем переподключиться
                setTimeout(() => {
                    this.reconnectToFriend(friendId);
                }, 1000);
                
                return false;
            }
        }
        return false;
    }
    
    // ==================== СООБЩЕНИЯ ====================
    
    async sendMessage(friendId, content, type = 'text') {
        if (!content || !friendId) return false;
        
        // Проверяем соединение
        const dc = this.dataChannels.get(friendId);
        if (!dc || dc.readyState !== 'open') {
            this.showNotification('Ошибка', 
                'Нет P2P соединения. Пробуем переподключиться...', 
                'error');
            
            // Пробуем переподключиться
            this.reconnectToFriend(friendId);
            return false;
        }
        
        const message = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12),
            senderId: this.currentUser.id,
            content: content,
            type: type,
            timestamp: Date.now(),
            status: 'sending',
            reactions: []
        };
        
        const sent = this.sendData(friendId, {
            type: 'message',
            message: message,
            timestamp: Date.now()
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
                'Не удалось отправить сообщение', 
                'error');
            return false;
        }
    }
    
    handlePeerMessage(friendId, data) {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'user-info':
                    this.saveFriendInfo(friendId, message.user);
                    this.updateDialogsList();
                    
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
                            let preview = msg.type === 'text' ? msg.content : '📷 Изображение';
                            if (preview.length > 50) preview = preview.substring(0, 47) + '...';
                            
                            this.showNotification(friend.name, preview, 'info');
                            this.playNotificationSound();
                        }
                        
                        this.markDialogAsUnread(friendId);
                    }
                    
                    // Отправляем подтверждение доставки
                    this.sendData(friendId, {
                        type: 'message-delivered',
                        messageId: msg.id,
                        timestamp: Date.now()
                    });
                    break;
                    
                case 'typing':
                    this.showTypingIndicator(friendId, message.typing);
                    break;
                    
                case 'ping':
                    this.sendData(friendId, { 
                        type: 'pong',
                        timestamp: Date.now()
                    });
                    break;
                    
                case 'message-delivered':
                    // Обновляем статус сообщения
                    if (this.activeChat && this.activeChat.friendId === friendId) {
                        const msgElement = document.querySelector(`[data-message-id="${message.messageId}"]`);
                        if (msgElement) {
                            const statusElement = msgElement.querySelector('.message-status');
                            if (statusElement) {
                                statusElement.textContent = '✓✓';
                            }
                        }
                    }
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
            lastSeen: Date.now(),
            lastUpdated: Date.now()
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
    
    // ==================== НАСТРОЙКИ ПРОФИЛЯ ====================
    
    showProfileSettings() {
        this.closeAllModals();
        
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        const modalConfirm = document.getElementById('modal-confirm');
        const modalCancel = document.getElementById('modal-cancel');
        
        modalTitle.textContent = 'Настройки профиля';
        modalBody.innerHTML = `
            <div class="profile-settings">
                <div class="profile-header">
                    <div class="profile-avatar-large" style="background: ${this.currentUser.avatarColor}">
                        ${this.currentUser.name.charAt(0).toUpperCase()}
                    </div>
                    <h3>${this.currentUser.name}</h3>
                    ${this.currentUser.username ? `<p class="profile-username">@${this.currentUser.username}</p>` : ''}
                </div>
                
                <div class="settings-form">
                    <div class="form-group">
                        <label for="profile-name">Имя</label>
                        <input type="text" id="profile-name" value="${this.currentUser.name}" placeholder="Введите ваше имя" maxlength="20">
                    </div>
                    
                    <div class="form-group">
                        <label for="profile-username">Юзернейм</label>
                        <div class="username-input">
                            <span class="username-prefix">@</span>
                            <input type="text" id="profile-username" value="${this.currentUser.username || ''}" placeholder="username" maxlength="30">
                        </div>
                        <p class="hint">По юзернейму вас смогут найти друзья</p>
                    </div>
                    
                    <div class="form-group">
                        <label>Цвет аватарки</label>
                        <div class="color-picker">
                            <div class="color-option ${this.currentUser.avatarColor === '#667eea' ? 'active' : ''}" data-color="#667eea" style="background-color: #667eea;"></div>
                            <div class="color-option ${this.currentUser.avatarColor === '#764ba2' ? 'active' : ''}" data-color="#764ba2" style="background-color: #764ba2;"></div>
                            <div class="color-option ${this.currentUser.avatarColor === '#f093fb' ? 'active' : ''}" data-color="#f093fb" style="background-color: #f093fb;"></div>
                            <div class="color-option ${this.currentUser.avatarColor === '#4CAF50' ? 'active' : ''}" data-color="#4CAF50" style="background-color: #4CAF50;"></div>
                            <div class="color-option ${this.currentUser.avatarColor === '#2196F3' ? 'active' : ''}" data-color="#2196F3" style="background-color: #2196F3;"></div>
                            <div class="color-option ${this.currentUser.avatarColor === '#FF9800' ? 'active' : ''}" data-color="#FF9800" style="background-color: #FF9800;"></div>
                            <div class="color-option ${this.currentUser.avatarColor === '#FF5252' ? 'active' : ''}" data-color="#FF5252" style="background-color: #FF5252;"></div>
                            <div class="color-option ${this.currentUser.avatarColor === '#9C27B0' ? 'active' : ''}" data-color="#9C27B0" style="background-color: #9C27B0;"></div>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Ваш ID</label>
                        <div class="id-display">
                            <code>${this.currentUser.id}</code>
                            <button class="btn-icon copy-btn" onclick="navigator.clipboard.writeText('${this.currentUser.id}')">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                        <p class="hint">Используйте этот ID для подключения</p>
                    </div>
                </div>
            </div>
        `;
        modalConfirm.textContent = 'Сохранить';
        modalCancel.textContent = 'Отмена';
        
        modal.classList.remove('hidden');
        
        // Инициализация выбора цвета
        setTimeout(() => {
            const colorOptions = modalBody.querySelectorAll('.color-option');
            colorOptions.forEach(option => {
                option.addEventListener('click', (e) => {
                    colorOptions.forEach(o => o.classList.remove('active'));
                    e.target.classList.add('active');
                });
            });
        }, 100);
        
        const closeModal = () => {
            modal.classList.add('hidden');
        };
        
        document.querySelector('.close-modal').onclick = closeModal;
        modalCancel.onclick = closeModal;
        
        modalConfirm.onclick = () => {
            const newName = document.getElementById('profile-name').value.trim();
            const newUsername = document.getElementById('profile-username').value.trim().replace(/^@/, '');
            const colorOption = modalBody.querySelector('.color-option.active');
            const newColor = colorOption ? colorOption.dataset.color : this.currentUser.avatarColor;
            
            if (!newName) {
                this.showNotification('Ошибка', 'Имя не может быть пустым', 'error');
                return;
            }
            
            // Проверяем уникальность юзернейма
            if (newUsername) {
                const friends = JSON.parse(localStorage.getItem('yegram-friends') || '{}');
                const isUsernameTaken = Object.values(friends).some(friend => 
                    friend.username && 
                    friend.username.toLowerCase() === newUsername.toLowerCase() &&
                    friend.id !== this.currentUser.id
                );
                
                if (isUsernameTaken) {
                    this.showNotification('Ошибка', 'Этот юзернейм уже используется', 'error');
                    return;
                }
            }
            
            // Обновляем профиль
            const oldName = this.currentUser.name;
            const oldColor = this.currentUser.avatarColor;
            
            this.currentUser.name = newName;
            this.currentUser.username = newUsername;
            this.currentUser.avatarColor = newColor;
            
            // Сохраняем изменения
            this.saveAccount(this.currentUser);
            
            // Обновляем интерфейс
            this.updateUserInterface();
            
            // Отправляем обновленную информацию всем подключенным друзьям
            this.dataChannels.forEach((dc, friendId) => {
                if (dc.readyState === 'open') {
                    this.sendData(friendId, {
                        type: 'user-info',
                        user: this.currentUser
                    });
                }
            });
            
            this.showNotification('Успех', 'Профиль обновлен', 'success');
            closeModal();
        };
    }
    
    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });
        document.querySelectorAll('.user-menu').forEach(menu => {
            menu.classList.add('hidden');
        });
    }
    
    updateUserInterface() {
        // Обновляем имя и аватарку в интерфейсе
        document.getElementById('current-username').textContent = this.currentUser.name;
        document.getElementById('avatar-letter').textContent = this.currentUser.name.charAt(0).toUpperCase();
        document.getElementById('user-avatar').style.background = this.currentUser.avatarColor;
        
        // Обновляем ID/юзернейм в боковой панели
        const displayText = this.currentUser.username && this.currentUser.username.trim() !== '' ? 
            `@${this.currentUser.username}` : this.currentUser.id;
        document.getElementById('user-id-text').textContent = displayText;
        
        // Обновляем информацию в активном чате
        if (this.activeChat) {
            const chatAvatarLetter = document.getElementById('chat-avatar-letter');
            const chatAvatar = document.getElementById('chat-avatar');
            if (chatAvatarLetter && chatAvatar) {
                chatAvatarLetter.textContent = this.currentUser.name.charAt(0).toUpperCase();
                chatAvatar.style.background = this.currentUser.avatarColor;
            }
        }
        
        // Обновляем список диалогов
        this.updateDialogsList();
    }
    
    // ==================== ТЕЛЕГРАМ-СТИЛЬ ИНТЕРФЕЙС ====================
    
    showLoginChoice() {
        this.closeAllModals();
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
        this.closeAllModals();
        document.getElementById('login-choice-screen').classList.add('hidden');
        document.getElementById('create-account-screen').classList.add('hidden');
        document.getElementById('login-id-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        
        // Обновляем информацию о пользователе
        this.updateUserInterface();
        
        // Загружаем диалоги
        this.updateDialogsList();
        
        // На мобильных устройствах показываем список диалогов
        if (this.isMobile()) {
            this.showDialogsView();
        }
        
        // Подключаемся к серверу
        this.connectToServer();
    }
    
    isMobile() {
        return window.innerWidth <= 768 || document.body.classList.contains('mobile');
    }
    
    showDialogsView() {
        document.getElementById('dialogs-view').classList.remove('hidden');
        document.getElementById('chat-view').classList.add('hidden');
        document.getElementById('welcome-screen').classList.add('hidden');
        document.querySelector('.mobile-header .menu-btn').style.display = 'flex';
        document.querySelector('.mobile-header .back-btn').style.display = 'none';
        document.querySelector('.mobile-header .chat-title').textContent = 'Yegram';
    }
    
    showChatView() {
        document.getElementById('dialogs-view').classList.add('hidden');
        document.getElementById('chat-view').classList.remove('hidden');
        document.querySelector('.mobile-header .menu-btn').style.display = 'none';
        document.querySelector('.mobile-header .back-btn').style.display = 'flex';
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
                    <div class="empty-icon">👋</div>
                    <p>Нет диалогов</p>
                    <p class="hint">Подключитесь к другу чтобы начать общение</p>
                    <button class="btn-primary" onclick="document.getElementById('friend-search-input').focus()">
                        <i class="fas fa-user-plus"></i> Найти друга
                    </button>
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
                unread: this.getUnreadCount(friendId),
                lastActivity: lastMessage ? lastMessage.timestamp : friends[friendId].lastSeen || 0
            };
        }).sort((a, b) => b.lastActivity - a.lastActivity);
        
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
        
        // Определяем отображение имени
        const displayName = friend.username && friend.username.trim() !== '' ? 
            `@${friend.username}` : friend.name;
        
        // Определяем превью сообщения
        let preview = 'Нет сообщений';
        let time = '';
        
        if (lastMessage) {
            preview = lastMessage.type === 'image' ? '📷 Изображение' : lastMessage.content;
            if (preview.length > 35) preview = preview.substring(0, 32) + '...';
            time = this.formatTime(lastMessage.timestamp, true);
        } else if (friend.lastSeen) {
            time = this.formatTime(friend.lastSeen, true);
        }
        
        div.innerHTML = `
            <div class="dialog-avatar" style="background: ${friend.avatarColor || '#667eea'}">
                ${friend.name.charAt(0).toUpperCase()}
                ${this.dataChannels.has(dialog.friendId) ? '<span class="online-dot"></span>' : ''}
            </div>
            <div class="dialog-info">
                <div class="dialog-header">
                    <div class="dialog-name">${displayName}</div>
                    ${time ? `<div class="dialog-time">${time}</div>` : ''}
                </div>
                <div class="dialog-preview">${preview}</div>
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
        
        // На мобильных устройствах переключаем вид
        if (this.isMobile()) {
            this.showChatView();
            this.updateMobileChatHeader();
        } else {
            this.showChat();
        }
        
        // Загружаем сообщения
        this.loadChatMessages(friendId);
        
        // Сбрасываем счетчик непрочитанных
        this.resetUnreadCount(friendId);
        
        // Обновляем статус соединения
        this.updateChatHeader();
    }
    
    updateMobileChatHeader() {
        if (!this.activeChat) return;
        
        const { friendId, friendInfo } = this.activeChat;
        const displayName = friendInfo.username && friendInfo.username.trim() !== '' ? 
            `@${friendInfo.username}` : friendInfo.name;
        
        document.querySelector('.mobile-header .chat-title').textContent = displayName;
        
        // Обновляем статус соединения
        const connection = this.connections.get(friendId);
        const statusElement = document.getElementById('mobile-chat-status');
        if (statusElement) {
            if (connection && connection.connectionState === 'connected') {
                statusElement.textContent = 'онлайн';
                statusElement.className = 'online';
            } else {
                statusElement.textContent = 'оффлайн';
                statusElement.className = 'offline';
            }
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
        const displayName = friendInfo.username && friendInfo.username.trim() !== '' ? 
            `@${friendInfo.username}` : friendInfo.name;
        
        document.getElementById('chat-title').textContent = displayName;
        document.getElementById('chat-avatar-letter').textContent = friendInfo.name.charAt(0).toUpperCase();
        document.getElementById('chat-avatar').style.background = friendInfo.avatarColor || '#667eea';
        
        // Обновляем статус соединения
        const connection = this.connections.get(friendId);
        if (connection && connection.connectionState === 'connected') {
            this.updateP2PStatus('connected');
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
        if (!container) return;
        
        container.innerHTML = '';
        
        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-messages">
                    <div class="empty-icon">💬</div>
                    <p>Пока нет сообщений</p>
                    <p class="hint">Начните общение первым!</p>
                </div>
            `;
            return;
        }
        
        let lastDate = null;
        
        messages.forEach(message => {
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
                <div class="message-footer">
                    <div class="message-time">${time}</div>
                    ${isOutgoing ? `<div class="message-status">${statusIcon}</div>` : ''}
                </div>
            </div>
        `;
        
        return div;
    }
    
    scrollToBottom(instant = false) {
        const container = document.getElementById('messages-container');
        if (!container) return;
        
        if (instant) {
            container.scrollTop = container.scrollHeight;
        } else {
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
            
            if (isNearBottom) {
                container.scrollTop = container.scrollHeight;
            } else {
                const indicator = document.getElementById('scroll-indicator');
                if (indicator) {
                    indicator.classList.remove('hidden');
                    
                    indicator.onclick = () => {
                        container.scrollTop = container.scrollHeight;
                        indicator.classList.add('hidden');
                    };
                }
            }
        }
    }
    
    showTypingIndicator(friendId, isTyping) {
        const indicator = document.getElementById('typing-indicator');
        
        if (this.activeChat && this.activeChat.friendId === friendId && indicator) {
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
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) {
            return 'только что';
        } else if (diffMins < 60) {
            return `${diffMins} мин назад`;
        } else if (diffHours < 24) {
            return date.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } else if (diffDays < 7) {
            const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
            return days[date.getDay()];
        } else {
            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit'
            });
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showNotification(title, message, type = 'info') {
        const container = document.getElementById('notifications');
        if (!container) return;
        
        // Удаляем старые уведомления того же типа
        const oldNotifications = container.querySelectorAll('.notification');
        oldNotifications.forEach(notification => {
            if (notification.querySelector('.notification-title')?.textContent === title) {
                notification.remove();
            }
        });
        
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
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        container.appendChild(notification);
        
        // Закрытие по клику
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });
        
        // Автоматическое закрытие
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => notification.remove(), 300);
            }
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
            case 'failed':
                dot.className = 'status-dot offline';
                text.textContent = 'Ошибка P2P соединения';
                break;
        }
    }
    
    updateConnectionState(friendId, state) {
        if (this.activeChat && this.activeChat.friendId === friendId) {
            this.updateP2PStatus(state);
            
            // Обновляем мобильный статус
            if (this.isMobile()) {
                const statusElement = document.getElementById('mobile-chat-status');
                if (statusElement) {
                    if (state === 'connected') {
                        statusElement.textContent = 'онлайн';
                        statusElement.className = 'online';
                    } else {
                        statusElement.textContent = 'оффлайн';
                        statusElement.className = 'offline';
                    }
                }
            }
        }
    }
    
    handleServerMessage(data) {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'welcome':
                    console.log('✅ Получено приветственное сообщение');
                    break;
                    
                case 'registered':
                    console.log('✅ Зарегистрирован на сервере');
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
                    this.handleIceCandidate(message.sender, message.candidate);
                    break;
                    
                case 'error':
                    console.error('Ошибка сервера:', message.message);
                    this.showNotification('Ошибка сервера', message.message, 'error');
                    break;
                    
                case 'pong':
                    break;
            }
            
        } catch (error) {
            console.error('Ошибка обработки сообщения сервера:', error);
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
        
        // Ввод в поле поиска с поддержкой @
        const friendSearchInput = document.getElementById('friend-search-input');
        friendSearchInput.addEventListener('input', () => {
            const value = friendSearchInput.value.trim();
            if (value.startsWith('@')) {
                friendSearchInput.placeholder = 'Введите юзернейм друга';
            } else {
                friendSearchInput.placeholder = 'ID друга или @юзернейм';
            }
        });
        
        friendSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const friendId = friendSearchInput.value.trim();
                this.connectToFriend(friendId);
                friendSearchInput.value = '';
            }
        });
        
        // Копирование ID
        document.getElementById('copy-id-btn').addEventListener('click', () => {
            if (this.currentUser) {
                const textToCopy = this.currentUser.username && this.currentUser.username.trim() !== '' ? 
                    `@${this.currentUser.username}` : this.currentUser.id;
                navigator.clipboard.writeText(textToCopy)
                    .then(() => this.showNotification('Скопировано', 'ID/юзернейм скопирован', 'success'))
                    .catch(() => this.showNotification('Ошибка', 'Не удалось скопировать', 'error'));
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
                
                // Скрываем через 2 секунды
                setTimeout(() => {
                    if (messageInput.value.trim()) {
                        this.sendData(this.activeChat.friendId, {
                            type: 'typing',
                            typing: false
                        });
                    }
                }, 2000);
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
        
        // Назад к диалогам (десктоп)
        document.getElementById('back-to-dialogs-btn').addEventListener('click', () => {
            document.getElementById('active-chat').classList.add('hidden');
            document.getElementById('welcome-screen').classList.remove('hidden');
            this.activeChat = null;
        });
        
        // Меню пользователя (десктоп)
        const userMenuBtn = document.getElementById('user-menu-btn');
        const userMenu = document.getElementById('user-menu');
        
        if (userMenuBtn) {
            userMenuBtn.addEventListener('click', () => {
                userMenu.classList.toggle('hidden');
            });
        }
        
        document.addEventListener('click', (e) => {
            if (userMenuBtn && userMenu && !userMenuBtn.contains(e.target) && !userMenu.contains(e.target)) {
                userMenu.classList.add('hidden');
            }
        });
        
        // Настройки профиля
        document.getElementById('profile-settings').addEventListener('click', () => {
            this.showProfileSettings();
            if (userMenu) userMenu.classList.add('hidden');
        });
        
        // Экспорт данных
        document.getElementById('export-data').addEventListener('click', () => {
            this.exportData();
            if (userMenu) userMenu.classList.add('hidden');
        });
        
        // Действия в меню
        document.getElementById('switch-account').addEventListener('click', () => {
            this.showLoginChoice();
            if (userMenu) userMenu.classList.add('hidden');
        });
        
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
            if (userMenu) userMenu.classList.add('hidden');
        });
        
        // Обновление диалогов
        document.getElementById('refresh-dialogs-btn').addEventListener('click', () => {
            this.updateDialogsList();
            this.showNotification('Обновлено', 'Список диалогов обновлен', 'success');
        });
        
        // Мобильные обработчики
        this.setupMobileEventListeners();
    }
    
    setupMobileEventListeners() {
        // Мобильное меню (три точки)
        const mobileMenuBtn = document.querySelector('.mobile-header .menu-btn');
        const mobileMenu = document.getElementById('mobile-user-menu');
        const mobileBackBtn = document.querySelector('.mobile-header .back-btn');
        
        if (mobileMenuBtn && mobileMenu) {
            mobileMenuBtn.addEventListener('click', () => {
                mobileMenu.classList.toggle('hidden');
            });
            
            // Закрытие меню при клике вне его
            document.addEventListener('click', (e) => {
                if (!mobileMenuBtn.contains(e.target) && !mobileMenu.contains(e.target)) {
                    mobileMenu.classList.add('hidden');
                }
            });
        }
        
        // Кнопка назад в чате
        if (mobileBackBtn) {
            mobileBackBtn.addEventListener('click', () => {
                this.showDialogsView();
                this.activeChat = null;
            });
        }
        
        // Мобильные пункты меню
        document.getElementById('mobile-profile-settings').addEventListener('click', () => {
            this.showProfileSettings();
            if (mobileMenu) mobileMenu.classList.add('hidden');
        });
        
        document.getElementById('mobile-switch-account').addEventListener('click', () => {
            this.showLoginChoice();
            if (mobileMenu) mobileMenu.classList.add('hidden');
        });
        
        document.getElementById('mobile-logout').addEventListener('click', () => {
            this.logout();
            if (mobileMenu) mobileMenu.classList.add('hidden');
        });
        
        // Адаптация для мобильной клавиатуры
        let viewportHeight = window.innerHeight;
        window.addEventListener('resize', () => {
            if (window.innerHeight < viewportHeight) {
                // Клавиатура открыта
                document.body.classList.add('keyboard-open');
            } else {
                // Клавиатура закрыта
                document.body.classList.remove('keyboard-open');
            }
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
                
                document.getElementById('emoji-picker').classList.add('hidden');
            });
            
            grid.appendChild(emojiElement);
        });
    }
    
    exportData() {
        try {
            const data = {
                accounts: JSON.parse(localStorage.getItem('yegram-accounts') || '[]'),
                friends: JSON.parse(localStorage.getItem('yegram-friends') || '{}'),
                currentUser: JSON.parse(localStorage.getItem('yegram-current-user') || '{}'),
                exportDate: new Date().toISOString()
            };
            
            const messages = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('yegram-messages-')) {
                    messages[key] = JSON.parse(localStorage.getItem(key) || '[]');
                }
            }
            
            data.messages = messages;
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `yegram-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showNotification('Экспорт', 'Данные успешно экспортированы', 'success');
        } catch (error) {
            console.error('Ошибка экспорта:', error);
            this.showNotification('Ошибка', 'Не удалось экспортировать данные', 'error');
        }
    }
    
    logout() {
        console.log('Выход из аккаунта');
        
        // Закрываем все соединения
        this.connections.forEach((connection, friendId) => {
            if (connection._keepAliveInterval) {
                clearInterval(connection._keepAliveInterval);
            }
            connection.close();
        });
        
        this.dataChannels.forEach((channel, friendId) => {
            if (channel._keepAliveInterval) {
                clearInterval(channel._keepAliveInterval);
            }
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
        this.friends.clear();
        this.currentUser = null;
        this.activeChat = null;
        this.reconnectionAttempts.clear();
        
        // Удаляем текущего пользователя
        localStorage.removeItem('yegram-current-user');
        
        this.showLoginChoice();
        this.showNotification('Выход', 'Вы вышли из аккаунта', 'info');
    }
    
    viewImage(src) {
        const modal = document.getElementById('image-modal');
        const modalImg = document.getElementById('modal-image');
        
        if (modal && modalImg) {
            modalImg.src = src;
            modal.classList.remove('hidden');
            
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            };
        } else {
            window.open(src, '_blank');
        }
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
            const timeSinceLastLogin = Date.now() - (user.lastLogin || 0);
            if (timeSinceLastLogin < 24 * 60 * 60 * 1000) {
                yegram.currentUser = user;
                yegram.showMainApp();
            }
        } catch (error) {
            console.error('Ошибка загрузки сохраненного пользователя:', error);
        }
    }
    
    // Глобальные обработчики
    window.addEventListener('error', (event) => {
        console.error('Глобальная ошибка:', event.error);
    });
    
    window.addEventListener('offline', () => {
        yegram.showNotification('Соединение', 'Интернет отключен', 'error');
    });
    
    window.addEventListener('online', () => {
        yegram.showNotification('Соединение', 'Интернет подключен', 'success');
        setTimeout(() => {
            if (yegram.currentUser) {
                yegram.connectToServer();
            }
        }, 1000);
    });
});

// Глобальные функции
function closeImageModal() {
    document.getElementById('image-modal').classList.add('hidden');
}
