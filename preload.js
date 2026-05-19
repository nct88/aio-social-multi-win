const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // --- Profiles ---
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    getUrls: () => ipcRenderer.invoke('get-urls'),
    addProfile: (platform, name, phoneOrNick) => ipcRenderer.invoke('add-profile', platform, name, phoneOrNick),
    editProfile: (platform, id, newName, newPhoneOrNick) => ipcRenderer.invoke('edit-profile', platform, id, newName, newPhoneOrNick),
    deleteProfile: (platform, id) => ipcRenderer.invoke('delete-profile', platform, id),
    reorderProfiles: (platform, orderedIds) => ipcRenderer.invoke('reorder-profiles', platform, orderedIds),

    // --- HWID ---
    getHWID: () => ipcRenderer.invoke('get-hwid'),
    copyHWID: () => ipcRenderer.invoke('copy-hwid'),

    // --- Donate ---
    checkDonate: () => ipcRenderer.invoke('check-donate'),
    openDonate: () => ipcRenderer.invoke('open-donate'),
    openTelegram: () => ipcRenderer.invoke('open-telegram'),

    // --- Auto Update ---
    installUpdate: () => ipcRenderer.invoke('install-update'),
    checkUpdate: () => ipcRenderer.invoke('check-update'),
    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, v) => cb(v)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, v) => cb(v)),

    // --- Theme ---
    toggleDarkMode: () => ipcRenderer.invoke('toggle-dark-mode'),
    getDarkMode: () => ipcRenderer.invoke('get-dark-mode'),
    syncThemeToWebview: (wcId, platform) => ipcRenderer.invoke('sync-theme-to-webview', wcId, platform),

    // --- Zalo child window ---
    createZaloWindow: (profileId, profileUuid) => ipcRenderer.invoke('create-zalo-window', profileId, profileUuid),
    showZaloWindow: (profileId) => ipcRenderer.invoke('show-zalo-window', profileId),
    hideZaloWindows: () => ipcRenderer.invoke('hide-zalo-windows'),

    // --- Window ---
    setTitle: (title) => ipcRenderer.invoke('set-title', title),

    // --- Logout ---
    logoutProfile: (platform, id) => ipcRenderer.invoke('logout-profile', platform, id),

    // --- Download progress ---
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (e, data) => callback(data)),

    // --- Backup / Restore ---
    backupProfiles: () => ipcRenderer.invoke('backup-profiles'),
    restoreProfiles: () => ipcRenderer.invoke('restore-profiles'),

    // --- Per-profile Proxy ---
    setProxy: (platform, profileId, proxyConfig) => ipcRenderer.invoke('set-proxy', platform, profileId, proxyConfig),
    getProxy: (platform, profileId) => ipcRenderer.invoke('get-proxy', platform, profileId),

    // --- Session Export / Import ---
    exportSession: (platform, profileId) => ipcRenderer.invoke('export-session', platform, profileId),
    importSession: (platform) => ipcRenderer.invoke('import-session', platform),

    // --- App Lock (PIN) ---
    setPin: (pin) => ipcRenderer.invoke('set-pin', pin),
    verifyPin: (pin) => ipcRenderer.invoke('verify-pin', pin),
    hasPin: () => ipcRenderer.invoke('has-pin'),

    // --- Auto-start ---
    setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
    getAutoStart: () => ipcRenderer.invoke('get-auto-start'),

    // --- Global Mute ---
    setGlobalMute: (muted) => ipcRenderer.invoke('set-global-mute', muted),
    getGlobalMute: () => ipcRenderer.invoke('get-global-mute'),

    // --- Auto-lock ---
    setAutoLock: (minutes) => ipcRenderer.invoke('set-auto-lock', minutes),
    getAutoLock: () => ipcRenderer.invoke('get-auto-lock')
});
