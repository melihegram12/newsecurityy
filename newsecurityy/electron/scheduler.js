const schedule = require('node-schedule');

let emailService = null;
function getEmailService() {
  if (!emailService) {
    emailService = require('./emailService');
  }
  return emailService;
}

let scheduledJob = null;
let runInProgress = false;
let lastRunTime = null;
let lastRunStatus = null;
let lastRunError = null;
let lastRunResult = null;
let startupCatchUpState = null;

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  return Math.max(min, Math.min(max, intValue));
}

function toLocalDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getScheduleParts(settings) {
  return {
    hour: clampInteger(settings?.scheduleHour, 18, 0, 23),
    minute: clampInteger(settings?.scheduleMinute, 0, 0, 59)
  };
}

async function runJob({
  reason = 'scheduled',
  targetDate = null,
  force = false,
  dryRun = undefined
} = {}) {
  if (runInProgress) {
    return { success: false, skipped: true, error: 'Scheduler job zaten calisiyor.' };
  }

  runInProgress = true;
  try {
    const payload = { reason, force };
    if (targetDate) payload.targetDate = targetDate;
    if (typeof dryRun === 'boolean') payload.dryRun = dryRun;

    const result = await getEmailService().sendDailyReport(payload);
    lastRunTime = new Date().toISOString();
    lastRunResult = result || null;
    if (result?.success) {
      lastRunStatus = result?.skipped ? 'skipped' : 'success';
      lastRunError = null;
    } else {
      lastRunStatus = 'error';
      lastRunError = result?.error || 'Bilinmeyen hata';
    }
    return result;
  } catch (error) {
    lastRunTime = new Date().toISOString();
    lastRunStatus = 'error';
    lastRunError = error.message;
    lastRunResult = null;
    return { success: false, error: error.message };
  } finally {
    runInProgress = false;
  }
}

async function runStartupCatchUp(settings) {
  if (!settings?.enabled) {
    startupCatchUpState = 'disabled';
    return { success: true, skipped: true, reason: 'disabled' };
  }
  if (settings.catchUpOnStart === false) {
    startupCatchUpState = 'off';
    return { success: true, skipped: true, reason: 'catchup_off' };
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDateISO = toLocalDateISO(yesterday);

  const reportState = typeof getEmailService().getReportState === 'function'
    ? (getEmailService().getReportState() || {})
    : {};

  if (reportState.lastSuccessDateISO === targetDateISO) {
    startupCatchUpState = 'already_sent';
    return { success: true, skipped: true, reason: 'already_sent' };
  }

  startupCatchUpState = 'running';
  const result = await runJob({
    reason: 'startup-catchup',
    targetDate: targetDateISO,
    force: false
  });
  startupCatchUpState = result?.success ? 'done' : 'error';
  return result;
}

function start() {
  try {
    stop();
    const settings = getEmailService().getEmailSettings();
    if (!settings.enabled) {
      startupCatchUpState = 'disabled';
      console.log('Email scheduler is disabled');
      return { success: true, status: 'disabled' };
    }

    const { hour, minute } = getScheduleParts(settings);
    const rule = new schedule.RecurrenceRule();
    rule.hour = hour;
    rule.minute = minute;
    rule.tz = 'Europe/Istanbul';

    scheduledJob = schedule.scheduleJob(rule, async () => {
      try {
        const result = await runJob({ reason: 'scheduled' });
        console.log('Scheduled email result:', result);
      } catch (e) {
        console.error('Scheduled email job error:', e?.message || e);
      }
    });

    console.log(`Email scheduler started: Daily at ${hour}:${String(minute).padStart(2, '0')}`);
    runStartupCatchUp(settings).catch((error) => {
      startupCatchUpState = 'error';
      lastRunTime = new Date().toISOString();
      lastRunStatus = 'error';
      lastRunError = error.message;
    });

    return {
      success: true,
      status: 'running',
      schedule: `Her gun saat ${hour}:${String(minute).padStart(2, '0')}`
    };
  } catch (error) {
    console.error('Scheduler start error:', error);
    return { success: false, error: error.message };
  }
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
    scheduledJob = null;
    console.log('Email scheduler stopped');
  }
  return { success: true, status: 'stopped' };
}

function restart() {
  stop();
  return start();
}

async function runNow(targetDate = null) {
  return runJob({
    reason: 'manual',
    targetDate: targetDate || null,
    force: true
  });
}

function getStatus() {
  const settings = getEmailService().getEmailSettings();
  const { hour, minute } = getScheduleParts(settings);
  const reportState = typeof getEmailService().getReportState === 'function'
    ? (getEmailService().getReportState() || {})
    : {};

  return {
    enabled: settings.enabled,
    running: scheduledJob !== null,
    runInProgress,
    schedule: `${hour}:${String(minute).padStart(2, '0')}`,
    catchUpOnStart: settings.catchUpOnStart !== false,
    startupCatchUpState,
    lastRunTime,
    lastRunStatus,
    lastRunError,
    lastRunResult,
    nextRun: scheduledJob ? scheduledJob.nextInvocation()?.toISOString() : null,
    lastSuccessAt: reportState.lastSuccessAt || null,
    lastSuccessDateISO: reportState.lastSuccessDateISO || null,
    lastAttemptAt: reportState.lastAttemptAt || null,
    lastAttemptDateISO: reportState.lastAttemptDateISO || null,
    lastReason: reportState.lastReason || null
  };
}

module.exports = {
  start,
  stop,
  restart,
  runNow,
  getStatus
};
