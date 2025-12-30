let ws;
let username = '';
let userRows = {};
let users = [];
let userThemes = {};

const STORAGE_KEY = 'talkomatic.prefs.v1';

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const colorSelect = document.getElementById('color-select');
const fontSelect = document.getElementById('font-select');
const bgSelect = document.getElementById('bg-select');
const userRowsDiv = document.getElementById('user-rows');
const userCountSpan = document.getElementById('user-count');
const exitBtn = document.getElementById('exit-btn');

const NAMED_COLORS = {
    green: '#00ff00',
    amber: '#ffb000',
    cyan: '#00ffff',
    white: '#ffffff',
    magenta: '#ff00ff',
    blue: '#5555ff'
};

const NAMED_BGS = {
    black: '#000000',
    slate: '#0b0f14',
    navy: '#001326',
    maroon: '#240008',
    paper: '#f2f2f2'
};

function normalizeColor(value, table, fallback) {
    if (!value) return fallback;
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith('#')) return trimmed;
    return table[trimmed] ?? fallback;
}

function loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const prefs = JSON.parse(raw);
        if (!prefs.sessionId) {
            prefs.sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
            savePrefs(prefs);
        }
        return prefs;
    } catch {
        return null;
    }
}

function savePrefs(prefs) {
    try {
        if (!prefs.sessionId) {
            prefs.sessionId = sessionId || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch { }
}

function getCurrentPrefs() {
    return {
        color: normalizeColor(colorSelect?.value, NAMED_COLORS, '#00ff00'),
        font: fontSelect?.value ?? 'courier',
        bg: normalizeColor(bgSelect?.value, NAMED_BGS, '#000000')
    };
}

function updatePreview() {
    if (!usernameInput) return;

    const { color, font, bg } = getCurrentPrefs();
    usernameInput.className = `font-${font}`;
    usernameInput.style.color = color;
    usernameInput.style.backgroundColor = bg;

    savePrefs({ color, font, bg, username: usernameInput.value });
}

{
    const prefs = loadPrefs();
    if (prefs) {
        if (colorSelect && prefs.color) {
            colorSelect.value = normalizeColor(prefs.color, NAMED_COLORS, '#00ff00');
        }
        if (fontSelect && prefs.font) fontSelect.value = prefs.font;
        if (bgSelect && prefs.bg) {
            bgSelect.value = normalizeColor(prefs.bg, NAMED_BGS, '#000000');
        }
        if (usernameInput && prefs.username) {
            usernameInput.value = prefs.username;
        }
        if (prefs.sessionId) {
            sessionId = prefs.sessionId;
        }
    } else {
        // Initialize session ID if no prefs exist
        sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        savePrefs({ sessionId });
    }
}

updatePreview();

colorSelect?.addEventListener('change', updatePreview);
fontSelect?.addEventListener('change', updatePreview);
colorSelect?.addEventListener('input', updatePreview);
fontSelect?.addEventListener('input', updatePreview);
bgSelect?.addEventListener('change', updatePreview);
bgSelect?.addEventListener('input', updatePreview);
usernameInput?.addEventListener('input', updatePreview);

// Auto-join if username exists in localStorage and is non-empty
const savedPrefs = loadPrefs();
if (savedPrefs && savedPrefs.username && savedPrefs.username.trim()) {
    // Additional check to ensure username is not empty
    if (savedPrefs.username.trim().length > 0) {
        joinChat();
    }
}

function createUserRow(user, isOwn = false) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'user-row';
    rowDiv.id = `row-${user}`;

    const theme = userThemes[user] || { color: 'green', font: 'courier', bg: 'black' };
    const themeColor = normalizeColor(theme.color, NAMED_COLORS, '#00ff00');
    const themeBg = normalizeColor(theme.bg, NAMED_BGS, '#000000');

    const labelDiv = document.createElement('div');
    labelDiv.className = `user-label ${isOwn ? 'own' : ''} font-${theme.font}`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = user;
    labelDiv.appendChild(nameSpan);

    labelDiv.style.color = themeColor;
    labelDiv.style.backgroundColor = themeBg;
    labelDiv.style.display = 'flex';
    labelDiv.style.justifyContent = 'space-between';
    labelDiv.style.alignItems = 'center';

    if (!isOwn) {
        const fireworksBtn = document.createElement('button');
        fireworksBtn.className = 'fireworks-btn';
        fireworksBtn.textContent = '🎆';
        fireworksBtn.title = 'Send Fireworks';
        fireworksBtn.onclick = (e) => {
            e.stopPropagation();
            sendMessage({
                type: 'fireworks',
                target: user,
                from: username
            });
        };
        labelDiv.appendChild(fireworksBtn);
    }

    const textarea = document.createElement('textarea');
    textarea.className = `user-text font-${theme.font}`;
    textarea.id = `text-${user}`;
    textarea.readOnly = !isOwn;
    if (!isOwn) textarea.tabIndex = -1;
    textarea.style.color = themeColor;
    textarea.style.backgroundColor = themeBg;

    if (isOwn) {
        let timeout;
        textarea.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                sendMessage({
                    type: 'update',
                    user: username,
                    text: textarea.value,
                    theme: userThemes[username]
                });
            }, 100); // Debounce by 100ms
        });
    }

    rowDiv.appendChild(labelDiv);
    rowDiv.appendChild(textarea);

    return rowDiv;
}

function updateUser(user, text = '', isOwn = false) {
    if (!userRows[user]) {
        userRows[user] = createUserRow(user, isOwn);
        userRowsDiv.appendChild(userRows[user]);
        users.push(user);
        redistributeRows();
    } else {
        const theme = userThemes[user] || { color: 'green', font: 'courier', bg: 'black' };
        const themeColor = normalizeColor(theme.color, NAMED_COLORS, '#00ff00');
        const themeBg = normalizeColor(theme.bg, NAMED_BGS, '#000000');
        const label = userRows[user].querySelector('.user-label');
        const textarea = userRows[user].querySelector('.user-text');
        const isCurrentUser = isOwn || (user === username);

        if (label) {
            label.className = `user-label ${isCurrentUser ? 'own' : ''} font-${theme.font}`;
            label.style.color = themeColor;
            label.style.backgroundColor = themeBg;
        }
        if (textarea) {
            textarea.className = `user-text font-${theme.font}`;
            textarea.readOnly = !isCurrentUser;
            textarea.tabIndex = isCurrentUser ? 0 : -1;
            textarea.style.color = themeColor;
            textarea.style.backgroundColor = themeBg;
        }
    }

    const isActuallyOwn = isOwn || (user === username);
    if (!isActuallyOwn && text !== undefined) {
        const textarea = document.getElementById(`text-${user}`);
        if (textarea && textarea.value !== text) {
            textarea.value = text;
        }
    } else if (isActuallyOwn && text !== undefined) {
        const textarea = document.getElementById(`text-${user}`);
        if (textarea && textarea.value !== text) {
            if (document.activeElement !== textarea) {
                textarea.value = text;
            } else {
                textarea.value = text;
            }
        }
    }
}

function removeUser(user) {
    if (userRows[user]) {
        userRowsDiv.removeChild(userRows[user]);
        delete userRows[user];
        users = users.filter(u => u !== user);
        redistributeRows();
    }
}

function redistributeRows() {
    const count = Object.keys(userRows).length;
    const height = count > 0 ? `${100 / count}%` : '100%';

    for (let user in userRows) {
        userRows[user].style.height = height;
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/chat`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to chat server');
        // Double-check username is not empty before sending join
        if (!username || !username.trim()) {
            console.error('Cannot join with empty username');
            ws.close();
            return;
        }
        sendMessage({
            type: 'join',
            user: username,
            theme: userThemes[username],
            sessionId: sessionId
        });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'join':
                    if (data.theme) {
                        userThemes[data.user] = data.theme;
                    }
                    updateUser(data.user);
                    break;

                case 'leave':
                    removeUser(data.user);
                    break;

                case 'update':
                    if (data.theme) {
                        userThemes[data.user] = data.theme;
                    }
                    updateUser(data.user, data.text);
                    break;

                case 'users':
                    // Initial user list (array of { user, theme, text })
                    data.users.forEach((entry) => {
                        const user = typeof entry === 'string' ? entry : entry.user;
                        if (!user) return;

                        if (typeof entry === 'object' && entry.theme) {
                            userThemes[user] = entry.theme;
                        }

                        const text = typeof entry === 'object' ? (entry.text ?? '') : '';
                        updateUser(user, text);
                    });
                    break;

                case 'user-count':
                    updateUserCount(data.count);
                    break;

                case 'fireworks':
                    showFireworks();
                    break;

                case 'error':
                    alert(data.message || 'An error occurred');
                    exitToLogin();
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('Disconnected from chat server');
        setTimeout(connectWebSocket, 3000);
    };
}

function sendMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function updateUserCount(count) {
    userCountSpan.textContent = `${count} online`;
}

function joinChat() {
    const name = usernameInput.value.trim();

    if (!name) {
        alert('Please enter a username');
        return;
    }

    username = name;

    const prefs = getCurrentPrefs();
    userThemes[username] = prefs;
    savePrefs({ ...prefs, username: name, sessionId: sessionId });

    loginScreen.classList.remove('active');
    chatScreen.classList.add('active');

    updateUser(username, '', true);
    connectWebSocket();

    const ownTextarea = document.getElementById(`text-${username}`);
    if (ownTextarea) {
        ownTextarea.focus();
    }
}

function exitToLogin() {
    if (ws && ws.readyState === WebSocket.OPEN && username) {
        sendMessage({ type: 'leave', user: username });
        ws.close();
    }

    username = '';
    users = [];
    userRows = {};
    userThemes = {};

    if (userRowsDiv) userRowsDiv.innerHTML = '';
    updateUserCount(0);

    chatScreen.classList.remove('active');
    loginScreen.classList.add('active');

    usernameInput.value = '';
    if (colorSelect) colorSelect.value = '#00ff00';
    if (fontSelect) fontSelect.value = 'courier';
    if (bgSelect) bgSelect.value = '#000000';
    updatePreview();

    usernameInput.focus();
}

joinBtn.addEventListener('click', joinChat);

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinChat();
    }
});

exitBtn?.addEventListener('click', exitToLogin);

window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({ type: 'leave', user: username });
        ws.close();
    }
});

function showFireworks() {
    const container = document.createElement('div');
    container.className = 'fireworks-container';
    document.body.appendChild(container);

    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.className = 'firework-particle';

        const startX = window.innerWidth / 2;
        const startY = window.innerHeight / 2;

        const angle = Math.random() * Math.PI * 2;
        const velocity = 2 + Math.random() * 5;
        const tx = Math.cos(angle) * velocity * 100;
        const ty = Math.sin(angle) * velocity * 100;

        particle.style.left = startX + 'px';
        particle.style.top = startY + 'px';
        particle.style.setProperty('--tx', tx + 'px');
        particle.style.setProperty('--ty', ty + 'px');

        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

        container.appendChild(particle);
    }

    setTimeout(() => {
        document.body.removeChild(container);
    }, 2000);
}

usernameInput.focus();
