const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- Heavy modules lazy-loaded for fast startup ----------
let _database, _scheduler, _backupScheduler, _autoUpdater;

function getDatabase() {
  if (!_database) _database = require('./database');
  return _database;
}
function getAutoUpdater() {
  if (!_autoUpdater) _autoUpdater = require('electron-updater').autoUpdater;
  return _autoUpdater;
}

let mainWindow;
let isQuitting = false;
const isDebug = process.env.ELECTRON_DEBUG === 'true' || process.argv.includes('--debug');
let delayedServicesTimerId = null;

// ---------- DB readiness gate — IPC handlers await this ----------
let _dbReadyResolve;
const dbReady = new Promise(resolve => { _dbReadyResolve = resolve; });

function getDesktopProfile() {
  try {
    const packageJsonPath = path.join(app.getAppPath(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof pkg?.desktopProfile === 'string' ? pkg.desktopProfile.trim().toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

function isLiteDesktopBuild() {
  return getDesktopProfile() === 'lite';
}

// --- AUTO UPDATE (electron-updater) ---
let updaterInitialized = false;
let updaterIntervalId = null;
let updaterState = {
  status: 'idle',
  feedUrl: '',
  info: null,
  progress: null,
  error: null,
  updatedAt: null,
};

function normalizeUpdateUrl(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function sendUpdaterEvent(type, payload = {}) {
  updaterState = {
    ...updaterState,
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:event', { type, ...payload, at: updaterState.updatedAt });
  }
}

function getUpdateUrlFromSettings() {
  try {
    const value = getDatabase().getSetting('update_url');
    return normalizeUpdateUrl(typeof value === 'string' ? value : '');
  } catch (e) {
    return '';
  }
}

function setUpdateUrlToSettings(value) {
  const normalized = normalizeUpdateUrl(value);
  try {
    getDatabase().setSetting('update_url', normalized);
  } catch (e) {
    // ignore
  }
  return normalized;
}

async function checkForUpdates(trigger = 'auto') {
  // electron-updater only works for packaged apps by default.
  if (!app.isPackaged) {
    sendUpdaterEvent('disabled', { status: 'disabled', feedUrl: '', error: null });
    return { ok: false, disabled: true, reason: 'not_packaged' };
  }

  const autoUpdater = getAutoUpdater();
  const feedUrl = getUpdateUrlFromSettings();
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL(feedUrl);
    } catch (e) {
      const message = e?.message || String(e);
      sendUpdaterEvent('error', { status: 'error', feedUrl, error: message });
      return { ok: false, error: message };
    }
  }

  sendUpdaterEvent('checking', { status: 'checking', feedUrl, error: null });

  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      result: result
        ? {
          version: result.updateInfo?.version || null,
          releaseName: result.updateInfo?.releaseName || null,
          releaseNotes: result.updateInfo?.releaseNotes || null,
        }
        : null,
      trigger,
    };
  } catch (e) {
    const message = e?.message || String(e);
    sendUpdaterEvent('error', { status: 'error', feedUrl, error: message });
    return { ok: false, error: message };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'NewSecurityy Guvenlik Paneli',
    icon: path.join(__dirname, '../public/logo512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    backgroundColor: '#08090e'
  });

  // Development veya Production URL
  const isDev = process.env.ELECTRON_DEV === 'true';
  const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000';

  if (isDev) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  }

  if (isDebug && !mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    dialog.showErrorBox(
      'Sayfa Yuklenemedi',
      `Kod: ${errorCode}\nAciklama: ${errorDescription}\nURL: ${validatedURL}`
    );
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    // Renderer çöktüğünde DB'yi güvenli kaydet
    try { if (_database) _database.saveDatabase(); } catch (e) { /* ignore */ }
    dialog.showErrorBox(
      'Render Procesi Kapandi',
      `Sebep: ${details.reason}\nCikis Kodu: ${details.exitCode}`
    );
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', () => {
    if (isQuitting) return;
    isQuitting = true;
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Menü oluştur
  const template = [
    {
      label: 'Dosya',
      submenu: [
        { role: 'reload', label: 'Yenile' },
        { role: 'forceReload', label: 'Zorla Yenile' },
        { type: 'separator' },
        {
          label: 'Veritabanı Konumu',
          click: async () => {
            await dbReady;
            const dbPath = getDatabase().getDbPath();
            shell.showItemInFolder(dbPath);
          }
        },
        {
          label: 'Yedek Al (Simdi)',
          click: async () => {
            await dbReady;
            const result = require('./backupScheduler').runNow();
            if (!result || !result.success) {
              dialog.showErrorBox('Yedek Hatasi', result?.error || 'Yedek alinmadi');
            }
          }
        },
        {
          label: 'Yedek Klasorunu Ac',
          click: async () => {
            await dbReady;
            shell.openPath(require('./backupScheduler').getBackupFolder());
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'resetZoom', label: 'Gerçek Boyut' },
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam Ekran' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları' }
      ]
    },
    {
      label: 'Yardım',
      submenu: [
        {
          label: 'Hakkında',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Hakkında',
              message: 'NewSecurityy Guvenlik Paneli',
              detail: `Surum: ${app.getVersion()}\nVeritabani: SQLite (Lokal)\n\nNewSecurityy`
            });
          }
        },
        {
          label: 'Veritabanı Yedekle',
          click: async () => {
            await dbReady;
            const dbPath = getDatabase().getDbPath();
            const { filePath } = await dialog.showSaveDialog(mainWindow, {
              title: 'Veritabanı Yedeği Kaydet',
              defaultPath: `guvenlik_yedek_${new Date().toISOString().split('T')[0]}.db`,
              filters: [{ name: 'SQLite Database', extensions: ['db'] }]
            });

            if (filePath) {
              try {
                fs.copyFileSync(dbPath, filePath);
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Başarılı',
                  message: 'Veritabanı yedeği alındı!'
                });
              } catch (error) {
                dialog.showErrorBox('Hata', 'Yedek alınamadı: ' + error.message);
              }
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function initAutoUpdater() {
  if (updaterInitialized) return;
  updaterInitialized = true;

  const autoUpdater = getAutoUpdater();

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.forceDevUpdateConfig = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdaterEvent('checking-for-update', {
      status: 'checking',
      feedUrl: getUpdateUrlFromSettings(),
      error: null,
      progress: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdaterEvent('update-available', {
      status: 'available',
      feedUrl: getUpdateUrlFromSettings(),
      info: info || null,
      error: null,
      progress: null,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdaterEvent('update-not-available', {
      status: 'not-available',
      feedUrl: getUpdateUrlFromSettings(),
      info: info || null,
      error: null,
      progress: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterEvent('download-progress', {
      status: 'downloading',
      feedUrl: getUpdateUrlFromSettings(),
      progress: progress || null,
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    sendUpdaterEvent('update-downloaded', {
      status: 'downloaded',
      feedUrl: getUpdateUrlFromSettings(),
      info: info || null,
      progress: null,
      error: null,
    });

    if (!mainWindow || mainWindow.isDestroyed()) return;

    const version = info?.version ? `v${info.version}` : 'yeni surum';
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Guncelleme Hazir',
      message: `Guncelleme indirildi (${version}).`,
      detail: 'Simdi yeniden baslatip yuklemek ister misiniz?',
      buttons: ['Simdi Yukle', 'Sonra'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on('error', (err) => {
    const message = err?.message || String(err);
    sendUpdaterEvent('error', {
      status: 'error',
      feedUrl: getUpdateUrlFromSettings(),
      error: message,
    });
  });
}

function startAutoUpdateScheduler() {
  if (updaterIntervalId) return;

  const maybeCheck = () => {
    void checkForUpdates('interval');
  };

  // Initial delayed check to let the UI come up first.
  setTimeout(maybeCheck, 20000);
  updaterIntervalId = setInterval(maybeCheck, 2 * 60 * 60 * 1000); // 2 hours
}

function startBackgroundServices() {
  initAutoUpdater();
  startAutoUpdateScheduler();
}

function formatProcessError(error) {
  return error?.message || String(error);
}

function reportProcessError(context, error) {
  const message = formatProcessError(error);
  console.error(`${context}:`, error);
  return message;
}

// IPC Handler'ları — her biri dbReady bekler
// Tüm handler'ları try-catch ile sararak renderer crash'ini önle
function safeHandle(channel, handler) {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await handler(...args);
    } catch (e) {
      const message = reportProcessError(`IPC error [${channel}]`, e);
      return { __ipcError: true, channel, error: message };
    }
  });
}

function setupDatabaseHandlers() {
  safeHandle('db:getActiveLogs', async () => { await dbReady; return getDatabase().getActiveLogs(); });
  safeHandle('db:getAllLogs', async (_, limit) => { await dbReady; return getDatabase().getAllLogs(limit); });
  safeHandle('db:getLogById', async (_, id) => { await dbReady; return getDatabase().getLogById(id); });
  safeHandle('db:getLogsCount', async () => { await dbReady; return getDatabase().getLogsCount(); });
  safeHandle('db:getLogsPage', async (_, limit, offset) => { await dbReady; return getDatabase().getLogsPage(limit, offset); });
  safeHandle('db:getLogsByDateRange', async (_, dateFrom, dateTo) => { await dbReady; return getDatabase().getLogsByDateRange(dateFrom, dateTo); });
  safeHandle('db:insertLog', async (_, logData) => { await dbReady; return getDatabase().insertLog(logData); });
  safeHandle('db:updateLog', async (_, id, updateData) => { await dbReady; return getDatabase().updateLog(id, updateData); });
  safeHandle('db:exitLog', async (_, id, exitData) => { await dbReady; return getDatabase().exitLog(id, exitData); });
  safeHandle('db:deleteLog', async (_, id) => { await dbReady; return getDatabase().deleteLog(id); });
  safeHandle('db:upsertLogByCreatedAt', async (_, logData) => { await dbReady; return getDatabase().upsertLogByCreatedAt(logData); });
  safeHandle('db:importLogs', async (_, logs) => { await dbReady; return getDatabase().importLogs(logs); });
  safeHandle('db:searchLogs', async (_, searchTerm, limit) => { await dbReady; return getDatabase().searchLogs(searchTerm, limit); });
  safeHandle('db:getStats', async () => { await dbReady; return getDatabase().getStats(); });
  safeHandle('db:setSetting', async (_, key, value) => { await dbReady; return getDatabase().setSetting(key, value); });
  safeHandle('db:getSetting', async (_, key) => { await dbReady; return getDatabase().getSetting(key); });
  safeHandle('db:getDbPath', () => getDatabase().getDbPath());

  // Uygulama bilgileri
  safeHandle('app:getVersion', () => app.getVersion());
  safeHandle('app:quit', () => {
    isQuitting = true;
    app.quit();
  });

  // Updater (electron-updater)
  safeHandle('updater:getUpdateUrl', async () => { await dbReady; return getUpdateUrlFromSettings(); });
  safeHandle('updater:setUpdateUrl', async (_, url) => { await dbReady; return setUpdateUrlToSettings(url); });
  safeHandle('updater:getState', () => updaterState);
  safeHandle('updater:check', () => checkForUpdates('manual'));
  safeHandle('updater:quitAndInstall', () => {
    isQuitting = true;
    getAutoUpdater().quitAndInstall(false, true);
    return true;
  });

  // Dosya işlemleri
  safeHandle('file:saveFile', async (_, fileName, data) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Dosyayı Kaydet',
      defaultPath: fileName,
      filters: [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (filePath) {
      fs.writeFileSync(filePath, Buffer.from(data));
      return filePath;
    }
    return null;
  });

  safeHandle('file:openFolder', (_, folderPath) => {
    shell.openPath(folderPath);
  });

  // E-posta işlemleri (lazy-load emailService)
  safeHandle('email:getSettings', async () => { await dbReady; return require('./emailService').getEmailSettings(); });
  safeHandle('email:saveSettings', async (_, settings) => { await dbReady; return require('./emailService').saveEmailSettings(settings); });
  safeHandle('email:testSmtp', async () => { await dbReady; return require('./emailService').testSmtpConnection(); });
  safeHandle('email:sendDailyReport', async (_, date) => { await dbReady; return require('./emailService').sendDailyReport(date); });
  safeHandle('email:sendTestEmail', async () => { await dbReady; return require('./emailService').sendTestEmail(); });

  // Zamanlayıcı işlemleri (lazy-load scheduler)
  safeHandle('scheduler:start', async () => { await dbReady; return require('./scheduler').start(); });
  safeHandle('scheduler:stop', () => require('./scheduler').stop());
  safeHandle('scheduler:restart', async () => { await dbReady; return require('./scheduler').restart(); });
  safeHandle('scheduler:runNow', async (_, date) => { await dbReady; return require('./scheduler').runNow(date); });
  safeHandle('scheduler:getStatus', () => require('./scheduler').getStatus());

  // Yedekleme islemleri (lazy-load backupScheduler)
  safeHandle('backup:getStatus', async () => { await dbReady; return require('./backupScheduler').getStatus(); });
  safeHandle('backup:runNow', async () => { await dbReady; return require('./backupScheduler').runNow(); });
  safeHandle('backup:setSettings', async (_, settings) => { await dbReady; return require('./backupScheduler').saveSettings(settings); });
  ipcMain.handle('backup:openFolder', async () => { await dbReady; return shell.openPath(require('./backupScheduler').getBackupFolder()); });
}

// ===================== STARTUP =====================
app.whenReady().then(async () => {
  // 1. IPC handler'ları kur (dbReady ile gate'li, pencere açılmadan önce hazır olmalı)
  setupDatabaseHandlers();

  // 2. Pencereyi HEMEN oluştur — kullanıcı anında görür
  createWindow();

  // 3. Veritabanını başlat (React bundle yüklenirken paralel çalışır) — 15s timeout
  try {
    const db = getDatabase();
    const DB_INIT_TIMEOUT_MS = 15000;
    await Promise.race([
      db.initDatabase(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB init timeout (15s)')), DB_INIT_TIMEOUT_MS))
    ]);
    _dbReadyResolve();
  } catch (e) {
    console.error('Database init failed:', e);
    _dbReadyResolve(); // IPC handler'lar asılı kalmasın
    dialog.showErrorBox('Veritabani Hatasi', `Veritabani baslatilamadi:\n${e.message || e}`);
  }

  // 4. Ağır servisleri ertele
  const serviceDelay = isLiteDesktopBuild() ? 5000 : 2000;
  delayedServicesTimerId = setTimeout(() => {
    delayedServicesTimerId = null;
    _scheduler = require('./scheduler');
    _scheduler.start();
    _backupScheduler = require('./backupScheduler');
    _backupScheduler.start();
    startBackgroundServices();
  }, serviceDelay);
}).catch((e) => {
  console.error('Startup error:', e);
});

app.on('before-quit', () => {
  isQuitting = true;
  if (delayedServicesTimerId) {
    clearTimeout(delayedServicesTimerId);
    delayedServicesTimerId = null;
  }
  if (updaterIntervalId) {
    clearInterval(updaterIntervalId);
    updaterIntervalId = null;
  }
});

app.on('window-all-closed', () => {
  if (_scheduler) _scheduler.stop();
  if (_backupScheduler) _backupScheduler.stop();
  if (_database) _database.closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Beklenmedik hatalarda logla; ana süreci zorla sonlandırma.
process.on('uncaughtException', (error) => {
  reportProcessError('Uncaught Exception', error);
});

process.on('unhandledRejection', (reason) => {
  reportProcessError('Unhandled Rejection', reason);
});
