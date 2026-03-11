const { contextBridge, ipcRenderer } = require('electron');

// API'yi renderer process'e expose et
contextBridge.exposeInMainWorld('electronAPI', {
    // Veritabanı işlemleri
    db: {
        getActiveLogs: () => ipcRenderer.invoke('db:getActiveLogs'),
        getAllLogs: (limit) => ipcRenderer.invoke('db:getAllLogs', limit),
        getLogById: (id) => ipcRenderer.invoke('db:getLogById', id),
        getLogsCount: () => ipcRenderer.invoke('db:getLogsCount'),
        getLogsPage: (limit, offset) => ipcRenderer.invoke('db:getLogsPage', limit, offset),
        getLogsByDateRange: (dateFrom, dateTo) => ipcRenderer.invoke('db:getLogsByDateRange', dateFrom, dateTo),
        insertLog: (logData) => ipcRenderer.invoke('db:insertLog', logData),
        updateLog: (id, updateData) => ipcRenderer.invoke('db:updateLog', id, updateData),
        exitLog: (id, exitData) => ipcRenderer.invoke('db:exitLog', id, exitData),
        deleteLog: (id) => ipcRenderer.invoke('db:deleteLog', id),
        upsertLogByCreatedAt: (logData) => ipcRenderer.invoke('db:upsertLogByCreatedAt', logData),
        importLogs: (logs) => ipcRenderer.invoke('db:importLogs', logs),
        searchLogs: (searchTerm, limit) => ipcRenderer.invoke('db:searchLogs', searchTerm, limit),
        getStats: () => ipcRenderer.invoke('db:getStats'),
        setSetting: (key, value) => ipcRenderer.invoke('db:setSetting', key, value),
        getSetting: (key) => ipcRenderer.invoke('db:getSetting', key),
        getDbPath: () => ipcRenderer.invoke('db:getDbPath')
    },

    // Uygulama bilgileri
    app: {
        getVersion: () => ipcRenderer.invoke('app:getVersion'),
        getPlatform: () => process.platform,
        quit: () => ipcRenderer.invoke('app:quit'),
        isElectron: true
    },

    // Güncelleme (electron-updater)
    updater: {
        getUpdateUrl: () => ipcRenderer.invoke('updater:getUpdateUrl'),
        setUpdateUrl: (url) => ipcRenderer.invoke('updater:setUpdateUrl', url),
        getState: () => ipcRenderer.invoke('updater:getState'),
        check: () => ipcRenderer.invoke('updater:check'),
        quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
        onEvent: (callback) => {
            const listener = (_event, payload) => callback(payload);
            ipcRenderer.on('updater:event', listener);
            return () => ipcRenderer.removeListener('updater:event', listener);
        }
    },

    // Dosya işlemleri
    file: {
        saveFile: (fileName, data) => ipcRenderer.invoke('file:saveFile', fileName, data),
        openFolder: (folderPath) => ipcRenderer.invoke('file:openFolder', folderPath)
    },

    // E-posta işlemleri
    email: {
        getSettings: () => ipcRenderer.invoke('email:getSettings'),
        saveSettings: (settings) => ipcRenderer.invoke('email:saveSettings', settings),
        testSmtp: () => ipcRenderer.invoke('email:testSmtp'),
        sendDailyReport: (date) => ipcRenderer.invoke('email:sendDailyReport', date),
        sendTestEmail: () => ipcRenderer.invoke('email:sendTestEmail')
    },

    // Zamanlayıcı işlemleri
    scheduler: {
        start: () => ipcRenderer.invoke('scheduler:start'),
        stop: () => ipcRenderer.invoke('scheduler:stop'),
        restart: () => ipcRenderer.invoke('scheduler:restart'),
        runNow: (date) => ipcRenderer.invoke('scheduler:runNow', date),
        getStatus: () => ipcRenderer.invoke('scheduler:getStatus')
    },

    // Yedekleme islemleri
    backup: {
        getStatus: () => ipcRenderer.invoke('backup:getStatus'),
        runNow: () => ipcRenderer.invoke('backup:runNow'),
        setSettings: (settings) => ipcRenderer.invoke('backup:setSettings', settings),
        openFolder: () => ipcRenderer.invoke('backup:openFolder')
    }
});
