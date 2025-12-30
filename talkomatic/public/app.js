let ws;
let username = '';
let userRows = {};
let users = [];
let userThemes = {}; // Store user theme preferences

const STORAGE_KEY = 'talkomatic.prefs.v1';

// DOM elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const colorSelect = document.getElementById('color-select');
const fontSelect = document.getElementById('font-select');
const bgSelect = document.getElementById('bg-select');
const previewText = document.getElementById('preview-text');
const userRowsDiv = document.getElementById('user-rows');
const userCountSpan = document.getElementById('user-count');
const exitBtn = document.getElementById('exit-btn');

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
    } catch {
        // ignore
    }
}

function getCurrentPrefs() {
    return {
        color: colorSelect?.value ?? 'green',
        font: fontSelect?.value ?? 'courier',
        bg: bgSelect?.value ?? 'black'
    };
}

// Update preview when theme changes
function updatePreview() {
    if (!previewText) return;

    const { color, font, bg } = getCurrentPrefs();
    previewText.className = `preview-text theme-${color} font-${font} bg-${bg}`;

    savePrefs({ color, font, bg });
}

// Initialize preview
updatePreview();

// Add event listeners for live preview
colorSelect?.addEventListener('change', updatePreview);
fontSelect?.addEventListener('change', updatePreview);
colorSelect?.addEventListener('input', updatePreview);
fontSelect?.addEventListener('input', updatePreview);
bgSelect?.addEventListener('change', updatePreview);
bgSelect?.addEventListener('input', updatePreview);

// Load stored selections into the UI
{
    const prefs = loadPrefs();
    if (prefs) {
        if (colorSelect && prefs.color) colorSelect.value = prefs.color;
        if (fontSelect && prefs.font) fontSelect.value = prefs.font;
        if (bgSelect && prefs.bg) bgSelect.value = prefs.bg;
        updatePreview();
    }
}

// Create a row for a user
function createUserRow(user, isOwn = false) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'user-row';
    rowDiv.id = `row-${user}`;
    
    const theme = userThemes[user] || { color: 'green', font: 'courier', bg: 'black' };
    
    const labelDiv = document.createElement('div');
    labelDiv.className = `user-label ${isOwn ? 'own' : ''} theme-${theme.color} font-${theme.font}`;
    labelDiv.textContent = user;
    
    const textarea = document.createElement('textarea');
    textarea.className = `user-text theme-${theme.color} font-${theme.font} bg-${theme.bg}`;
    textarea.id = `text-${user}`;
    textarea.disabled = !isOwn;
    
    if (isOwn) {
        // Send updates on input
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

// Add or update a user
function updateUser(user, text = '', isOwn = false) {
    if (!userRows[user]) {
        // Create new row
        userRows[user] = createUserRow(user, isOwn);
        userRowsDiv.appendChild(userRows[user]);
        users.push(user);
        
        // Update layout
        redistributeRows();
    } else {
        // Update existing row's theme
        const theme = userThemes[user] || { color: 'green', font: 'courier', bg: 'black' };
        const label = userRows[user].querySelector('.user-label');
        const textarea = userRows[user].querySelector('.user-text');
        
        if (label) {
            label.className = `user-label ${isOwn ? 'own' : ''} theme-${theme.color} font-${theme.font}`;
        }
        if (textarea) {
            textarea.className = `user-text theme-${theme.color} font-${theme.font} bg-${theme.bg}`;
        }
    }
    
    // Update text if not own (own is updated by typing)
    if (!isOwn && text !== undefined) {
        const textarea = document.getElementById(`text-${user}`);
        if (textarea && textarea.value !== text) {
            textarea.value = text;
        }
    }
}

// Remove a user
function removeUser(user) {
    if (userRows[user]) {
        userRowsDiv.removeChild(userRows[user]);
        delete userRows[user];
        users = users.filter(u => u !== user);
        redistributeRows();
    }
}

// Redistribute row heights
function redistributeRows() {
    const count = Object.keys(userRows).length;
    const height = count > 0 ? `${100 / count}%` : '100%';
    
    for (let user in userRows) {
        userRows[user].style.height = height;
    }
}

// Connect to WebSocket
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
            
            switch(data.type) {
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

// Send message via WebSocket
function sendMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Update user count
function updateUserCount(count) {
    userCountSpan.textContent = `${count} online`;
}

// Join chat
function joinChat() {
    const name = usernameInput.value.trim();
    
    if (!name) {
        alert('Please enter a username');
        return;
    }
    
    username = name;
    
    // Store own theme preferences
    userThemes[username] = getCurrentPrefs();
    
    loginScreen.classList.remove('active');
    chatScreen.classList.add('active');
    
    // Add own row first
    updateUser(username, '', true);
    
    connectWebSocket();
    
    // Focus on own textarea
    const ownTextarea = document.getElementById(`text-${username}`);
    if (ownTextarea) {
        ownTextarea.focus();
    }
}

function exitToLogin() {
    try {
        // As requested: clear local storage for this origin
        localStorage.clear();
    } catch {
        // ignore
    }

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

    if (colorSelect) colorSelect.value = 'green';
    if (fontSelect) fontSelect.value = 'courier';
    if (bgSelect) bgSelect.value = 'black';
    updatePreview();

    usernameInput.value = '';
    usernameInput.focus();
}

// Event listeners
joinBtn.addEventListener('click', joinChat);

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinChat();
    }
});

exitBtn?.addEventListener('click', exitToLogin);

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({ type: 'leave', user: username });
        ws.close();
    }
});

// Focus username input on load
usernameInput.focus();
