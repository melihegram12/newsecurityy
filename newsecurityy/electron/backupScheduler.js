const schedule = require('node-schedule');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const database = require('./database');

const DEFAULT_BACKUP_SETTINGS = {
  enabled: true,
  scheduleHour: 2,
  scheduleMinute: 0,
  retention: 30,
  folder: ''
};

let scheduledJob = null;
let lastRunTime = null;
let lastRunStatus = null;
let lastRunError = null;
let lastBackupPath = null;

function getSettings() {
  try {
    const saved = database.getSetting('backup_settings');
    return { ...DEFAULT_BACKUP_SETTINGS, ...(saved || {}) };
  } catch (e) {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}

function saveSettings(settings) {
  const next = { ...getSettings(), ...(settings || {}) };
  database.setSetting('backup_settings', next);
  restart();
  return next;
}

function getBackupFolder() {
  const settings = getSettings();
  if (settings.folder) return settings.folder;
  return path.join(app.getPath('userData'), 'backups');
}

function ensureFolder(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function pruneOldBackups(dir, retention) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('security_panel_') && f.endsWith('.db'));
    if (files.length <= retention) return;
    files.sort();
    const toRemove = files.slice(0, Math.max(0, files.length - retention));
    toRemove.forEach((file) => {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch (e) {
        // ignore delete errors
      }
    });
  } catch (e) {
    // ignore
  }
}

function createBackup(reason = 'scheduled', force = false) {
  const settings = getSettings();
  if (!settings.enabled && !force) {
    return { success: false, status: 'disabled' };
  }

  const dbPath = database.getDbPath();
  if (!dbPath) return { success: false, status: 'no_db_path' };

  try {
    database.saveDatabase();
    const dir = getBackupFolder();
    ensureFolder(dir);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `security_panel_${stamp}.db`;
    const dest = path.join(dir, fileName);

    fs.copyFileSync(dbPath, dest);
    pruneOldBackups(dir, settings.retention);

    lastRunTime = new Date().toISOString();
    lastRunStatus = 'success';
    lastRunError = null;
    lastBackupPath = dest;

    return { success: true, path: dest, reason };
  } catch (e) {
    lastRunTime = new Date().toISOString();
    lastRunStatus = 'error';
    lastRunError = e?.message || String(e);
    return { success: false, error: lastRunError };
  }
}

function start() {
  stop();
  const settings = getSettings();
  if (!settings.enabled) {
    return { success: true, status: 'disabled' };
  }

  const hour = Number.isFinite(Number(settings.scheduleHour)) ? Number(settings.scheduleHour) : 2;
  const minute = Number.isFinite(Number(settings.scheduleMinute)) ? Number(settings.scheduleMinute) : 0;

  const rule = new schedule.RecurrenceRule();
  rule.hour = hour;
  rule.minute = minute;
  rule.tz = 'Europe/Istanbul';

  scheduledJob = schedule.scheduleJob(rule, () => {
    try {
      createBackup('scheduled', false);
    } catch (e) {
      console.error('Scheduled backup job error:', e?.message || e);
    }
  });

  return {
    success: true,
    status: 'running',
    schedule: `Her gun saat ${hour}:${String(minute).padStart(2, '0')}`
  };
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
    scheduledJob = null;
  }
  return { success: true, status: 'stopped' };
}

function restart() {
  stop();
  return start();
}

function runNow() {
  return createBackup('manual', true);
}

function getStatus() {
  const settings = getSettings();
  return {
    enabled: settings.enabled,
    running: scheduledJob !== null,
    schedule: `${settings.scheduleHour || 2}:${String(settings.scheduleMinute || 0).padStart(2, '0')}`,
    retention: settings.retention,
    folder: getBackupFolder(),
    lastRunTime,
    lastRunStatus,
    lastRunError,
    lastBackupPath,
    nextRun: scheduledJob ? scheduledJob.nextInvocation()?.toISOString() : null
  };
}

module.exports = {
  start,
  stop,
  restart,
  runNow,
  getStatus,
  saveSettings,
  getBackupFolder
};
