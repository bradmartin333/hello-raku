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
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function savePrefs(prefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {}
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

function createUserRow(user, isOwn = false) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'user-row';
    rowDiv.id = `row-${user}`;

    const theme = userThemes[user] || { color: 'green', font: 'courier', bg: 'black' };
    const themeColor = normalizeColor(theme.color, NAMED_COLORS, '#00ff00');
    const themeBg = normalizeColor(theme.bg, NAMED_BGS, '#000000');

    const labelDiv = document.createElement('div');
    labelDiv.className = `user-label ${isOwn ? 'own' : ''} font-${theme.font}`;
    labelDiv.textContent = user;
    labelDiv.style.color = themeColor;
    labelDiv.style.backgroundColor = themeBg;

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

        if (label) {
            label.className = `user-label ${isOwn ? 'own' : ''} font-${theme.font}`;
            label.style.color = themeColor;
            label.style.backgroundColor = themeBg;
        }
        if (textarea) {
            textarea.className = `user-text font-${theme.font}`;
            textarea.readOnly = !isOwn;
            textarea.tabIndex = isOwn ? 0 : -1;
            textarea.style.color = themeColor;
            textarea.style.backgroundColor = themeBg;
        }
    }

    if (!isOwn && text !== undefined) {
        const textarea = document.getElementById(`text-${user}`);
        if (textarea && textarea.value !== text) {
            textarea.value = text;
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
        sendMessage({
            type: 'join',
            user: username,
            theme: userThemes[username]
        });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'join':
                    if (data.user !== username) {
                        if (data.theme) {
                            userThemes[data.user] = data.theme;
                        }
                        updateUser(data.user);
                    }
                    break;

                case 'leave':
                    removeUser(data.user);
                    break;

                case 'update':
                    if (data.user !== username) {
                        if (data.theme) {
                            userThemes[data.user] = data.theme;
                        }
                        updateUser(data.user, data.text);
                    }
                    break;

                case 'users':
                    // Initial user list (array of { user, theme, text })
                    data.users.forEach((entry) => {
                        const user = typeof entry === 'string' ? entry : entry.user;
                        if (!user || user === username) return;

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
    savePrefs({ ...prefs, username: name });

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

usernameInput.focus();
