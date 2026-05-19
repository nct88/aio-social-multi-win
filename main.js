const { app, BrowserWindow, ipcMain, session, nativeTheme, webContents, dialog, shell, safeStorage, Tray, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const http = require('http');

// --- Auto Updater ---
let autoUpdater;
try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
} catch(e) { /* dev mode — electron-updater chưa install */ }

// --- HWID Generation ---
function getHWID() {
    const raw = os.hostname() + '|' + os.userInfo().username + '|' + (os.cpus()[0]?.model || 'unknown');
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16).toUpperCase();
}
const HWID = getHWID();

// --- Donate check via api.truong.me ---
const DONATE_API = 'https://api.truong.me';

function checkDonateStatus(hwid) {
    return new Promise((resolve) => {
        https.get(`${DONATE_API}/donate_check?hwid=${encodeURIComponent(hwid)}`, { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.donated === true);
                } catch(e) { resolve(false); }
            });
        }).on('error', () => resolve(false)).on('timeout', function() { this.destroy(); resolve(false); });
    });
}

// --- Remote Logging (HWID-based, 2-day rotation on server) ---
const LOG_API = 'http://log.truong.me/aiosocial-log';

function sendLog(level, message, meta = {}) {
    try {
        const payload = JSON.stringify({
            hwid: HWID,
            level: level,
            message: message,
            meta: meta,
            timestamp: new Date().toISOString(),
            version: '1.2.0'
        });
        const url = new URL(`${LOG_API}/push`);
        const options = {
            hostname: 'log.truong.me',
            port: 80,
            path: '/aiosocial-log/push',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            timeout: 3000
        };
        const req = http.request(options, () => {});
        req.on('error', () => {}); // Silent fail — logging should never crash app
        req.on('timeout', () => req.destroy());
        req.write(payload);
        req.end();
    } catch(e) { /* silent */ }
}

// Thiết lập ngôn ngữ mặc định toàn cục là Tiếng Việt
app.commandLine.appendSwitch('lang', 'vi-VN');
app.commandLine.appendSwitch('accept-lang', 'vi-VN,vi');

// Sandbox: BẬT (mặc định Chromium) — KHÔNG dùng no-sandbox để đảm bảo bảo mật

// --- Tùy chỉnh App Data (Encrypted with safeStorage) ---
const SETTINGS_FILE = path.join(app.getPath('userData'), 'aio_settings_v4.enc');
const SETTINGS_FILE_LEGACY = path.join(app.getPath('userData'), 'aio_settings_v3.json');

function loadSettings() {
    // Migration: đọc file cũ (plaintext v3) nếu file mới chưa tồn tại
    if (!fs.existsSync(SETTINGS_FILE) && fs.existsSync(SETTINGS_FILE_LEGACY)) {
        try {
            const legacyData = JSON.parse(fs.readFileSync(SETTINGS_FILE_LEGACY, 'utf8'));
            console.log('[Security] Migrating plaintext settings → encrypted format...');
            saveSettings(legacyData);
            // Xóa file cũ sau khi migrate thành công
            fs.unlinkSync(SETTINGS_FILE_LEGACY);
            return legacyData;
        } catch(e) {
            console.error('[Settings] Legacy migration failed:', e.message);
        }
    }
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const raw = fs.readFileSync(SETTINGS_FILE);
            let jsonStr;
            if (safeStorage.isEncryptionAvailable()) {
                jsonStr = safeStorage.decryptString(raw);
            } else {
                jsonStr = raw.toString('utf8');
            }
            return JSON.parse(jsonStr);
        } catch(e) {
            console.error('[Settings] Load failed, resetting:', e.message);
        }
    }
    const defaultSettings = {
        profiles: {
            messenger: [],
            zalo: [],
            telegram: [],
            whatsapp: [],
            discord: [],
            x: []
        }
    };
    saveSettings(defaultSettings);
    return defaultSettings;
}

function saveSettings(data) {
    try {
        const jsonStr = JSON.stringify(data, null, 2);
        if (safeStorage.isEncryptionAvailable()) {
            fs.writeFileSync(SETTINGS_FILE, safeStorage.encryptString(jsonStr));
        } else {
            fs.writeFileSync(SETTINGS_FILE, jsonStr);
        }
    } catch(e) {
        console.error('[Settings] Save failed:', e.message);
    }
}

let settings = null;
let mainWindow;
let tray = null;
let isQuitting = false;

const URLS = {
    metabiz: 'https://business.facebook.com/latest/inbox/all',
    messenger: 'https://www.messenger.com',
    zalo: 'https://chat.zalo.me',
    telegram: 'https://web.telegram.org/k/#?tgaddr=tg%3A%2F%2Fsetlanguage%3Flang%3Dvi-beta',
    whatsapp: 'https://web.whatsapp.com',
    discord: 'https://discord.com/app',
    x: 'https://twitter.com/messages',
    instagram: 'https://www.instagram.com/direct/inbox/',
    tiktok: 'https://www.tiktok.com',
    threads: 'https://www.threads.net',
    wechat: 'https://web.wechat.com',
    lotus: 'https://lotuschat.vn/'
};

// --- Session setup cho mỗi partition (hỗ trợ proxy) ---
let downloadCounter = 0;
function setupSession(platform, uuid, proxyConfig) {
    const partition = `persist:${platform}_${uuid}`;
    const ses = session.fromPartition(partition);
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    ses.setUserAgent(ua);
    // Xóa ServiceWorker cũ bị corrupt (fix InvalidStateError)
    ses.clearStorageData({ storages: ['serviceworkers'] }).catch(() => {});
    // Tính năng proxy đang phát triển
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['Accept-Language'] = 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7';
        callback({ requestHeaders: details.requestHeaders });
    });
    ses.setPermissionRequestHandler((wc, permission, callback) => {
        if (['notifications', 'media'].includes(permission)) return callback(true);
        callback(false);
    });
    // Download handler — track downloads and send progress to renderer
    ses.on('will-download', (event, item) => {
        const dlId = 'dl_' + (++downloadCounter);
        const filename = item.getFilename();
        const sendProgress = (state) => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.webContents.send('download-progress', {
                id: dlId,
                filename: filename,
                received: item.getReceivedBytes(),
                total: item.getTotalBytes(),
                state: state
            });
        };
        item.on('updated', (e, state) => sendProgress(state));
        item.once('done', (e, state) => sendProgress(state));
        sendProgress('progressing');
    });
}

// Setup sessions cho tất cả profiles hiện có (bao gồm proxy)
function initSessions() {
    const ALL_PLATFORMS = Object.keys(URLS);
    ALL_PLATFORMS.forEach(platform => {
        if (!settings.profiles[platform]) settings.profiles[platform] = [];
        settings.profiles[platform].forEach(p => setupSession(platform, p.uuid, p.proxy));
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 850,
        minWidth: 1000,
        minHeight: 600,
        title: `AIỎ — Mã hỗ trợ: ${HWID}`,
        icon: path.join(__dirname, 'assets', 'app-icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webviewTag: true
        },
        autoHideMenuBar: true
    });

    initSessions();
    mainWindow.loadFile('index.html');

    // Giữ HWID trong title bar — ngăn HTML <title> ghi đè
    mainWindow.on('page-title-updated', (e) => e.preventDefault());
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.setTitle(`AIỎ — Mã hỗ trợ: ${HWID}`);
    });

    // CSP cho main window — chống XSS injection
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        // Chỉ áp CSP cho file local (main renderer)
        if (details.url.startsWith('file://')) {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self';"]
                }
            });
        } else {
            callback({ responseHeaders: details.responseHeaders });
        }
    });

    mainWindow.on('ready-to-show', () => {
        // Kiểm tra PIN lock trước khi show
        mainWindow.show();
    });

    // === System Tray ===
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'app-icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('AIO Social Pro');
    const trayMenu = Menu.buildFromTemplate([
        { label: 'Mở AIO Social', click: () => { mainWindow.show(); mainWindow.focus(); } },
        { type: 'separator' },
        { label: 'Thoát', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(trayMenu);
    tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });

    // Minimize to tray thay vì đóng
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    // === DevTools Protection (production) ===
    if (!process.argv.includes('--dev')) {
        mainWindow.webContents.on('devtools-opened', () => {
            mainWindow.webContents.closeDevTools();
        });
    }
}

app.whenReady().then(() => {
    // Load settings SAU khi app ready (safeStorage cần app ready)
    settings = loadSettings();
    appDarkMode = settings.darkMode === true;
    nativeTheme.themeSource = appDarkMode ? 'dark' : 'light';
    createWindow();
    sendLog('info', 'app_started', { platform: process.platform, electron: process.versions.electron });

    // Auto-update check
    if (autoUpdater) {
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
        autoUpdater.on('update-available', (info) => {
            sendLog('info', 'update_available', { version: info.version });
            if (mainWindow) mainWindow.webContents.send('update-available', info.version);
        });
        autoUpdater.on('update-downloaded', (info) => {
            sendLog('info', 'update_downloaded', { version: info.version });
            if (mainWindow) mainWindow.webContents.send('update-downloaded', info.version);
        });
    }

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { isQuitting = true; sendLog('info', 'app_quit'); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- Auto-update IPC ---
ipcMain.handle('install-update', () => {
    if (autoUpdater) autoUpdater.quitAndInstall(false, true);
});
ipcMain.handle('check-update', async () => {
    if (autoUpdater) return autoUpdater.checkForUpdates().catch(() => null);
    return null;
});

// ============================================================
//  BẢO MẬT: Navigation Guard + New-Window Handler
// ============================================================

// Whitelist domain — bao gồm 12 platforms + OAuth + CDN
const ALLOWED_DOMAINS = [
    // Meta ecosystem
    'facebook.com', 'messenger.com', 'fbcdn.net', 'fbsbx.com', 'fb.com',
    // Zalo
    'zalo.me', 'zalo.vn', 'zadn.vn', 'zaloapp.com',
    // Telegram
    'telegram.org', 'telegram.me', 't.me',
    // WhatsApp
    'whatsapp.com', 'whatsapp.net',
    // Discord
    'discord.com', 'discordapp.com', 'discord.gg', 'discord.media',
    // X (Twitter)
    'twitter.com', 'x.com', 'twimg.com',
    // Instagram
    'instagram.com', 'cdninstagram.com',
    // TikTok
    'tiktok.com', 'tiktokcdn.com', 'byteoversea.com', 'byteimg.com',
    // Threads
    'threads.net',
    // WeChat
    'wechat.com', 'qq.com', 'weixin.qq.com',
    // Lotus
    'lotuschat.vn',
    // OAuth providers (cần cho đăng nhập)
    'google.com', 'accounts.google.com', 'gstatic.com', 'googleapis.com',
    'apple.com', 'appleid.apple.com',
    'microsoft.com', 'microsoftonline.com', 'live.com',
    // CDN phổ biến
    'cloudflare.com', 'cloudfront.net', 'akamaihd.net', 'akamaized.net',
    'googleapis.com', 'gstatic.com', 'googleusercontent.com'
];

// Kiểm tra URL có thuộc whitelist không
function isAllowedUrl(urlString) {
    try {
        const url = new URL(urlString);
        // Cho phép file:// (local), about:blank, data:
        if (['file:', 'about:', 'data:', 'blob:'].includes(url.protocol)) return true;
        // Kiểm tra domain
        const hostname = url.hostname.toLowerCase();
        return ALLOWED_DOMAINS.some(domain => {
            return hostname === domain || hostname.endsWith('.' + domain);
        });
    } catch(e) { return false; }
}

// Áp dụng guard cho TẤT CẢ webContents (webview, BrowserWindow)
app.on('web-contents-created', (event, contents) => {
    // Guard 1: Chặn navigation đến domain không tin cậy
    contents.on('will-navigate', (navEvent, navUrl) => {
        if (!isAllowedUrl(navUrl)) {
            navEvent.preventDefault();
            console.log('[Security] Blocked navigation to:', navUrl);
        }
    });

    // Guard 2: Kiểm soát popup/new-window — KHÔNG tạo Electron window mới
    contents.setWindowOpenHandler(({ url }) => {
        if (isAllowedUrl(url)) {
            // Mở URL tin cậy trong trình duyệt hệ thống
            shell.openExternal(url).catch(() => {});
        } else {
            console.log('[Security] Blocked popup:', url);
        }
        return { action: 'deny' };
    });
});

// ============================================================
//  ZALO CHILD WINDOW — separate BrowserWindow to avoid crashes
// ============================================================
let zaloWindows = {}; // key -> BrowserWindow
let activeZaloKey = null;

const SIDEBAR_W = 290;

function getZaloBounds() {
    if (!mainWindow) return { x: 0, y: 0, width: 800, height: 600 };
    const cb = mainWindow.getContentBounds();
    return {
        x: cb.x + SIDEBAR_W,
        y: cb.y,
        width: cb.width - SIDEBAR_W,
        height: cb.height
    };
}

function createZaloWindow(profileId, profileUuid) {
    const key = 'zalo_' + profileId;
    if (zaloWindows[key]) return zaloWindows[key];
    
    const partition = 'persist:zalo_' + profileUuid;
    const bounds = getZaloBounds();
    
    const win = new BrowserWindow({
        parent: mainWindow,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        hasShadow: false,
        roundedCorners: false,
        thickFrame: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        show: false,
        webPreferences: {
            partition: partition,
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    win.webContents.setUserAgent(ua);
    win.webContents.loadURL('https://chat.zalo.me');
    
    win.webContents.on('dom-ready', () => {
        if (appDarkMode) {
            win.webContents.executeJavaScript(DARK_STYLE_JS).catch(() => {});
        }
    });
    
    // Auto-recover from crash
    win.webContents.on('render-process-gone', (event, details) => {
        setTimeout(() => {
            try { if (!win.isDestroyed()) win.webContents.reload(); } catch(e) {}
        }, 2000);
    });
    
    zaloWindows[key] = win;
    return win;
}

function showZaloWindow(key) {
    // Hide all zalo windows
    Object.keys(zaloWindows).forEach(k => {
        if (zaloWindows[k] && !zaloWindows[k].isDestroyed()) {
            zaloWindows[k].hide();
        }
    });
    activeZaloKey = key;
    if (zaloWindows[key] && !zaloWindows[key].isDestroyed()) {
        const bounds = getZaloBounds();
        zaloWindows[key].setBounds(bounds);
        zaloWindows[key].show();
    }
}

function hideAllZaloWindows() {
    Object.keys(zaloWindows).forEach(k => {
        if (zaloWindows[k] && !zaloWindows[k].isDestroyed()) {
            zaloWindows[k].hide();
        }
    });
    activeZaloKey = null;
}

function updateZaloBounds() {
    if (activeZaloKey && zaloWindows[activeZaloKey] && !zaloWindows[activeZaloKey].isDestroyed()) {
        zaloWindows[activeZaloKey].setBounds(getZaloBounds());
    }
}

// Keep zalo window synced with main window position/size
let _zaloSyncSetup = false;
function setupZaloSync() {
    if (_zaloSyncSetup) return;
    _zaloSyncSetup = true;
    mainWindow.on('resize', updateZaloBounds);
    mainWindow.on('move', updateZaloBounds);
    mainWindow.on('maximize', () => setTimeout(updateZaloBounds, 100));
    mainWindow.on('unmaximize', () => setTimeout(updateZaloBounds, 100));
    mainWindow.on('minimize', () => {
        Object.values(zaloWindows).forEach(w => { if (w && !w.isDestroyed()) w.hide(); });
    });
    mainWindow.on('restore', () => {
        setTimeout(updateZaloBounds, 100);
        if (activeZaloKey && zaloWindows[activeZaloKey] && !zaloWindows[activeZaloKey].isDestroyed()) {
            zaloWindows[activeZaloKey].show();
        }
    });
    mainWindow.on('focus', () => {
        if (activeZaloKey && zaloWindows[activeZaloKey] && !zaloWindows[activeZaloKey].isDestroyed()) {
            zaloWindows[activeZaloKey].show();
        }
    });
}

// IPC for Zalo child windows
ipcMain.handle('create-zalo-window', (event, profileId, profileUuid) => {
    const win = createZaloWindow(profileId, profileUuid);
    setupZaloSync();
    return true;
});

ipcMain.handle('show-zalo-window', (event, profileId) => {
    showZaloWindow('zalo_' + profileId);
    return true;
});

ipcMain.handle('hide-zalo-windows', () => {
    Object.keys(zaloWindows).forEach(k => {
        if (zaloWindows[k] && !zaloWindows[k].isDestroyed()) {
            zaloWindows[k].hide();
        }
    });
    activeZaloKey = null;
    return true;
});



// ============================================================
//  IPC HANDLERS
// ============================================================

ipcMain.handle('get-profiles', () => settings.profiles);
ipcMain.handle('get-urls', () => URLS);

// ---------- HWID ----------
ipcMain.handle('get-hwid', () => HWID);
ipcMain.handle('copy-hwid', () => {
    clipboard.writeText(HWID);
    return HWID;
});

// ---------- Donate ----------
ipcMain.handle('check-donate', async () => {
    // Kiểm tra local cache trước
    if (settings.donated === true) return true;
    // Kiểm tra server
    const donated = await checkDonateStatus(HWID);
    if (donated) {
        settings.donated = true;
        saveSettings(settings);
    }
    return donated;
});

ipcMain.handle('open-donate', () => {
    shell.openExternal(`https://truong.me/donate?hwid=${HWID}`);
    return true;
});

ipcMain.handle('open-telegram', () => {
    shell.openExternal('https://t.me/congtruongit');
    return true;
});

// ---------- Toggle Dark Mode ----------
// Trạng thái theme — khởi tạo thực tế trong app.whenReady()
let appDarkMode = false;

const DARK_STYLE_JS = `
(function(){
    let el = document.getElementById('__aio_dark__');
    if (el) el.remove();
    el = document.createElement('style');
    el.id = '__aio_dark__';
    el.textContent = 'html{filter:invert(0.9) hue-rotate(180deg)!important;background:#111!important}img,video,canvas,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}';
    document.head.appendChild(el);
})();
`;

const LIGHT_STYLE_JS = `
(function(){
    let el = document.getElementById('__aio_dark__');
    if (el) el.remove();
})();
`;

// Platforms đã có dark mode riêng → KHÔNG inject CSS filter
const SELF_DARK_PLATFORMS = ['messenger', 'telegram', 'discord', 'metabiz'];

ipcMain.handle('toggle-dark-mode', () => {
    appDarkMode = !appDarkMode;
    nativeTheme.themeSource = appDarkMode ? 'dark' : 'light';
    settings.darkMode = appDarkMode;
    saveSettings(settings);
    return appDarkMode ? 'dark' : 'light';
});

ipcMain.handle('get-dark-mode', () => appDarkMode ? 'dark' : 'light');

// Inject dark/light vào webview qua webContentsId (có validate)
// Platforms tự có dark mode: chỉ inject nếu KHÔNG nằm trong danh sách SELF_DARK
ipcMain.handle('sync-theme-to-webview', (event, wcId, platform) => {
    try {
        if (typeof wcId !== 'number' || wcId < 1) return appDarkMode;
        const wc = webContents.fromId(wcId);
        if (!wc) return appDarkMode;
        // BẢO MẬT: Không cho inject vào main window
        if (mainWindow && !mainWindow.isDestroyed() && wc.id === mainWindow.webContents.id) {
            console.log('[Security] Blocked theme injection to main window');
            return appDarkMode;
        }
        // Platform tự có dark mode → KHÔNG inject CSS filter
        if (platform && SELF_DARK_PLATFORMS.includes(platform)) {
            // Chỉ xóa style cũ nếu có
            wc.executeJavaScript(LIGHT_STYLE_JS);
            return appDarkMode;
        }
        wc.executeJavaScript(appDarkMode ? DARK_STYLE_JS : LIGHT_STYLE_JS);
    } catch(e) {}
    return appDarkMode;
});



// ---------- Profile CRUD ----------
ipcMain.handle('add-profile', (event, platform, name, phoneOrNick) => {
    const newProfile = { id: crypto.randomUUID(), name: name, phoneOrNick: phoneOrNick || '', uuid: crypto.randomUUID() };
    if(!settings.profiles[platform]) settings.profiles[platform] = [];
    settings.profiles[platform].push(newProfile);
    saveSettings(settings);
    setupSession(platform, newProfile.uuid);
    return settings.profiles;
});

ipcMain.handle('edit-profile', (event, platform, id, newName, newPhoneOrNick) => {
    const profile = settings.profiles[platform].find(p => p.id === id);
    if (profile) {
        profile.name = newName;
        profile.phoneOrNick = newPhoneOrNick || '';
        saveSettings(settings);
    }
    return settings.profiles;
});

ipcMain.handle('delete-profile', async (event, platform, id) => {
    const profile = settings.profiles[platform].find(p => p.id === id);
    if (profile) {
        const ses = session.fromPartition(`persist:${platform}_${profile.uuid}`);
        await ses.clearStorageData();
        await ses.clearAuthCache();
        // Destroy Zalo child window if exists
        if (platform === 'zalo') {
            const key = 'zalo_' + id;
            if (zaloWindows[key] && !zaloWindows[key].isDestroyed()) {
                zaloWindows[key].destroy();
            }
            delete zaloWindows[key];
            if (activeZaloKey === key) activeZaloKey = null;
        }
    }
    settings.profiles[platform] = settings.profiles[platform].filter(p => p.id !== id);
    saveSettings(settings);
    return settings.profiles;
});



// ---------- Window title ----------
ipcMain.handle('set-title', (event, title) => {
    if (mainWindow) mainWindow.setTitle(title);
});

// ---------- Logout (clear session, keep profile) ----------
ipcMain.handle('logout-profile', async (event, platform, id) => {
    const profile = settings.profiles[platform].find(p => p.id === id);
    if (!profile) return false;
    const ses = session.fromPartition(`persist:${platform}_${profile.uuid}`);
    await ses.clearStorageData();
    await ses.clearAuthCache();
    // Destroy Zalo child window if exists
    if (platform === 'zalo') {
        const key = 'zalo_' + id;
        if (zaloWindows[key] && !zaloWindows[key].isDestroyed()) {
            zaloWindows[key].destroy();
        }
        delete zaloWindows[key];
        if (activeZaloKey === key) activeZaloKey = null;
    }
    return true;
});

// ---------- Backup / Restore profiles (Encrypted) ----------
ipcMain.handle('backup-profiles', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Sao lưu dữ liệu',
        defaultPath: 'aio-social-backup.aio',
        filters: [{ name: 'AIO Backup (Encrypted)', extensions: ['aio'] }]
    });
    if (result.canceled) return null;
    try {
        // Backup mã hóa — bảo vệ thông tin cá nhân
        const jsonStr = JSON.stringify(settings, null, 2);
        if (safeStorage.isEncryptionAvailable()) {
            fs.writeFileSync(result.filePath, safeStorage.encryptString(jsonStr));
        } else {
            fs.writeFileSync(result.filePath, jsonStr);
        }
        return result.filePath;
    } catch(e) {
        console.error('[Backup] Failed:', e.message);
        return null;
    }
});

ipcMain.handle('restore-profiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Khôi phục dữ liệu',
        filters: [
            { name: 'AIO Backup (Encrypted)', extensions: ['aio'] },
            { name: 'Legacy JSON', extensions: ['json'] }
        ],
        properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return false;
    try {
        const raw = fs.readFileSync(result.filePaths[0]);
        let data;
        // Hỗ trợ cả file encrypted (.aio) và legacy plaintext (.json)
        if (result.filePaths[0].endsWith('.json')) {
            data = JSON.parse(raw.toString('utf8'));
        } else if (safeStorage.isEncryptionAvailable()) {
            data = JSON.parse(safeStorage.decryptString(raw));
        } else {
            data = JSON.parse(raw.toString('utf8'));
        }
        // Validate cấu trúc dữ liệu
        if (data && typeof data.profiles === 'object' && !Array.isArray(data.profiles)) {
            settings = data;
            saveSettings(settings);
            initSessions();
            return true;
        }
        console.error('[Restore] Invalid backup structure');
        return false;
    } catch(e) {
        console.error('[Restore] Failed:', e.message);
        return false;
    }
});

// ============================================================
//  NEW FEATURES — v1.2.0
// ============================================================

// ---------- Profile Reorder ----------
ipcMain.handle('reorder-profiles', (event, platform, orderedIds) => {
    if (!settings.profiles[platform]) return settings.profiles;
    const reordered = orderedIds.map(id =>
        settings.profiles[platform].find(p => p.id === id)
    ).filter(Boolean);
    settings.profiles[platform] = reordered;
    saveSettings(settings);
    return settings.profiles;
});

// ---------- Per-profile Proxy ----------
ipcMain.handle('set-proxy', async (event, platform, profileId, proxyConfig) => {
    return false; // Đang phát triển
});

ipcMain.handle('get-proxy', (event, platform, profileId) => {
    return null; // Đang phát triển
});

// ---------- Session Export / Import ----------
ipcMain.handle('export-session', async (event, platform, profileId) => {
    const profile = settings.profiles[platform]?.find(p => p.id === profileId);
    if (!profile) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Xuất dữ liệu phiên',
        defaultPath: `${platform}_${profile.name}.aio-session`,
        filters: [{ name: 'AIO Session', extensions: ['aio-session'] }]
    });
    if (result.canceled) return null;
    try {
        const ses = session.fromPartition(`persist:${platform}_${profile.uuid}`);
        const cookies = await ses.cookies.get({});
        const exportData = { profile: { name: profile.name, phoneOrNick: profile.phoneOrNick }, platform, cookies };
        const jsonStr = JSON.stringify(exportData);
        if (safeStorage.isEncryptionAvailable()) {
            fs.writeFileSync(result.filePath, safeStorage.encryptString(jsonStr));
        } else {
            fs.writeFileSync(result.filePath, jsonStr);
        }
        return result.filePath;
    } catch(e) {
        console.error('[Export] Failed:', e.message);
        return null;
    }
});

ipcMain.handle('import-session', async (event, platform) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Nhập dữ liệu phiên',
        filters: [{ name: 'AIO Session', extensions: ['aio-session'] }],
        properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return false;
    try {
        const raw = fs.readFileSync(result.filePaths[0]);
        let data;
        if (safeStorage.isEncryptionAvailable()) {
            data = JSON.parse(safeStorage.decryptString(raw));
        } else {
            data = JSON.parse(raw.toString('utf8'));
        }
        if (!data || !data.cookies || !data.profile) return false;
        const newProfile = {
            id: crypto.randomUUID(),
            name: data.profile.name + ' (đã nhập)',
            phoneOrNick: data.profile.phoneOrNick || '',
            uuid: crypto.randomUUID()
        };
        if (!settings.profiles[platform]) settings.profiles[platform] = [];
        settings.profiles[platform].push(newProfile);
        saveSettings(settings);
        setupSession(platform, newProfile.uuid);
        const ses = session.fromPartition(`persist:${platform}_${newProfile.uuid}`);
        for (const c of data.cookies) {
            try {
                await ses.cookies.set({
                    url: `https://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`,
                    name: c.name, value: c.value, domain: c.domain, path: c.path,
                    secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate
                });
            } catch(e) {}
        }
        return settings.profiles;
    } catch(e) {
        console.error('[Import] Failed:', e.message);
        return false;
    }
});

// ---------- App Lock (PIN) ----------
ipcMain.handle('set-pin', (event, pin) => {
    if (pin) {
        settings.pinHash = crypto.createHash('sha256').update(String(pin)).digest('hex');
    } else {
        delete settings.pinHash;
    }
    saveSettings(settings);
    return true;
});

ipcMain.handle('verify-pin', (event, pin) => {
    if (!settings.pinHash) return true;
    return crypto.createHash('sha256').update(String(pin)).digest('hex') === settings.pinHash;
});

ipcMain.handle('has-pin', () => !!settings?.pinHash);

// ---------- Auto-start ----------
ipcMain.handle('set-auto-start', (event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    settings.autoStart = !!enabled;
    saveSettings(settings);
    return settings.autoStart;
});

ipcMain.handle('get-auto-start', () => settings?.autoStart || false);

// ---------- Notification sound control ----------
ipcMain.handle('set-global-mute', (event, muted) => {
    settings.globalMute = !!muted;
    saveSettings(settings);
    return settings.globalMute;
});

ipcMain.handle('get-global-mute', () => settings?.globalMute || false);

// ---------- Auto-lock timer ----------
ipcMain.handle('set-auto-lock', (event, minutes) => {
    settings.autoLockMinutes = parseInt(minutes) || 0;
    saveSettings(settings);
    return settings.autoLockMinutes;
});

ipcMain.handle('get-auto-lock', () => settings?.autoLockMinutes || 0);
