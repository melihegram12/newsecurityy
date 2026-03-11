const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Database modülünü import et
const database = require('./database');

// Email ve Scheduler modüllerini import et
const emailService = require('./emailService');
const scheduler = require('./scheduler');
const backupScheduler = require('./backupScheduler');

let mainWindow;
let isQuitting = false;
const isDebug = process.env.ELECTRON_DEBUG === 'true' || process.argv.includes('--debug');

// --- AUTO UPDATE (electron-updater) ---
let updaterInitialized = false;
let updaterIntervalId = null;
let updaterState = {
  status: 'idle', // idle|checking|available|not-available|downloading|downloaded|error|disabled
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
    const value = database.getSetting('update_url');
    return normalizeUpdateUrl(typeof value === 'string' ? value : '');
  } catch (e) {
    return '';
  }
}

function setUpdateUrlToSettings(value) {
  const normalized = normalizeUpdateUrl(value);
  try {
    database.setSetting('update_url', normalized);
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
    // Events will update the UI; return something useful for callers.
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
          click: () => {
            const dbPath = database.getDbPath();
            shell.showItemInFolder(dbPath);
          }
        },
        {
          label: 'Yedek Al (Simdi)',
          click: () => {
            const result = backupScheduler.runNow();
            if (!result || !result.success) {
              dialog.showErrorBox('Yedek Hatasi', result?.error || 'Yedek alinmadi');
            }
          }
        },
        {
          label: 'Yedek Klasorunu Ac',
          click: () => {
            shell.openPath(backupScheduler.getBackupFolder());
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
            const dbPath = database.getDbPath();
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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

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

// Veritabanı IPC Handler'ları
function setupDatabaseHandlers() {
  ipcMain.handle('db:getActiveLogs', () => database.getActiveLogs());
  ipcMain.handle('db:getAllLogs', (_, limit) => database.getAllLogs(limit));
  ipcMain.handle('db:getLogById', (_, id) => database.getLogById(id));
  ipcMain.handle('db:getLogsCount', () => database.getLogsCount());
  ipcMain.handle('db:getLogsPage', (_, limit, offset) => database.getLogsPage(limit, offset));
  ipcMain.handle('db:getLogsByDateRange', (_, dateFrom, dateTo) => database.getLogsByDateRange(dateFrom, dateTo));
  ipcMain.handle('db:insertLog', (_, logData) => database.insertLog(logData));
  ipcMain.handle('db:updateLog', (_, id, updateData) => database.updateLog(id, updateData));
  ipcMain.handle('db:exitLog', (_, id, exitData) => database.exitLog(id, exitData));
  ipcMain.handle('db:deleteLog', (_, id) => database.deleteLog(id));
  ipcMain.handle('db:upsertLogByCreatedAt', (_, logData) => database.upsertLogByCreatedAt(logData));
  ipcMain.handle('db:importLogs', (_, logs) => database.importLogs(logs));
  ipcMain.handle('db:searchLogs', (_, searchTerm, limit) => database.searchLogs(searchTerm, limit));
  ipcMain.handle('db:getStats', () => database.getStats());
  ipcMain.handle('db:setSetting', (_, key, value) => database.setSetting(key, value));
  ipcMain.handle('db:getSetting', (_, key) => database.getSetting(key));
  ipcMain.handle('db:getDbPath', () => database.getDbPath());

  // Uygulama bilgileri
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:quit', () => {
    isQuitting = true;
    app.quit();
  });

  // Updater (electron-updater)
  ipcMain.handle('updater:getUpdateUrl', () => getUpdateUrlFromSettings());
  ipcMain.handle('updater:setUpdateUrl', (_, url) => setUpdateUrlToSettings(url));
  ipcMain.handle('updater:getState', () => updaterState);
  ipcMain.handle('updater:check', () => checkForUpdates('manual'));
  ipcMain.handle('updater:quitAndInstall', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

  // Dosya işlemleri
  ipcMain.handle('file:saveFile', async (_, fileName, data) => {
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

  ipcMain.handle('file:openFolder', (_, folderPath) => {
    shell.openPath(folderPath);
  });

  // E-posta işlemleri
  ipcMain.handle('email:getSettings', () => emailService.getEmailSettings());
  ipcMain.handle('email:saveSettings', (_, settings) => emailService.saveEmailSettings(settings));
  ipcMain.handle('email:testSmtp', () => emailService.testSmtpConnection());
  ipcMain.handle('email:sendDailyReport', (_, date) => emailService.sendDailyReport(date));
  ipcMain.handle('email:sendTestEmail', () => emailService.sendTestEmail());

  // Zamanlayıcı işlemleri
  ipcMain.handle('scheduler:start', () => scheduler.start());
  ipcMain.handle('scheduler:stop', () => scheduler.stop());
  ipcMain.handle('scheduler:restart', () => scheduler.restart());
  ipcMain.handle('scheduler:runNow', (_, date) => scheduler.runNow(date));
  ipcMain.handle('scheduler:getStatus', () => scheduler.getStatus());

  // Yedekleme islemleri
  ipcMain.handle('backup:getStatus', () => backupScheduler.getStatus());
  ipcMain.handle('backup:runNow', () => backupScheduler.runNow());
  ipcMain.handle('backup:setSettings', (_, settings) => backupScheduler.saveSettings(settings));
  ipcMain.handle('backup:openFolder', () => shell.openPath(backupScheduler.getBackupFolder()));
}

app.whenReady().then(async () => {
  // Veritabanını başlat (async)
  await database.initDatabase();

  // IPC handler'ları kur
  setupDatabaseHandlers();

  // Zamanlayıcıyı başlat
  scheduler.start();

  // Yedekleme zamanlayıcısı
  backupScheduler.start();

  // Pencereyi oluştur
  createWindow();

  // Auto update
  initAutoUpdater();
  startAutoUpdateScheduler();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (updaterIntervalId) {
    clearInterval(updaterIntervalId);
    updaterIntervalId = null;
  }
});

app.on('window-all-closed', () => {
  scheduler.stop(); // Zamanlayıcıyı durdur
  backupScheduler.stop();
  database.closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Beklenmedik hatalarda veritabanını kapat
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  database.closeDatabase();
});
