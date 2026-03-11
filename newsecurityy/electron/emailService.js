const nodemailer = require('nodemailer');

let database = null;
function getDatabase() {
  if (!database) {
    database = require('./database');
  }
  return database;
}

const REPORT_STATE_KEY = 'email_report_state';

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  return Math.max(min, Math.min(max, intValue));
}

function normalizeRecipients(input) {
  if (Array.isArray(input)) {
    return input.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[,\n]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function toLocalDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnlyString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function parseTargetDate(targetDate) {
  if (!targetDate) {
    const dt = new Date();
    dt.setDate(dt.getDate() - 1);
    return {
      dateObj: dt,
      dateISO: toLocalDateISO(dt),
      dateLabel: dt.toLocaleDateString('tr-TR')
    };
  }

  const parsedDateOnly = parseDateOnlyString(targetDate);
  if (parsedDateOnly) {
    return {
      dateObj: parsedDateOnly,
      dateISO: String(targetDate).trim(),
      dateLabel: parsedDateOnly.toLocaleDateString('tr-TR')
    };
  }

  const dt = new Date(targetDate);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Gecersiz tarih: ${targetDate}`);
  }

  return {
    dateObj: dt,
    dateISO: toLocalDateISO(dt),
    dateLabel: dt.toLocaleDateString('tr-TR')
  };
}

const DEFAULT_SMTP_SETTINGS = {
  host: process.env.SMTP_HOST || '',
  port: clampInteger(process.env.SMTP_PORT, 587, 1, 65535),
  secure: toBoolean(process.env.SMTP_SECURE, false),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.SMTP_FROM_NAME || 'Guvenlik Paneli',
  recipients: normalizeRecipients(process.env.SMTP_RECIPIENTS || ''),
  scheduleHour: clampInteger(process.env.SMTP_SCHEDULE_HOUR, 18, 0, 23),
  scheduleMinute: clampInteger(process.env.SMTP_SCHEDULE_MINUTE, 0, 0, 59),
  allowInvalidCerts: toBoolean(process.env.SMTP_ALLOW_INVALID_CERTS, false),
  enabled: toBoolean(process.env.SMTP_ENABLED, false),
  catchUpOnStart: toBoolean(process.env.SMTP_CATCHUP_ON_START, true),
  dryRun: toBoolean(process.env.SMTP_DRY_RUN, false)
};

function normalizeEmailSettings(raw = {}) {
  const merged = { ...DEFAULT_SMTP_SETTINGS, ...(raw || {}) };
  return {
    host: String(merged.host || '').trim(),
    port: clampInteger(merged.port, DEFAULT_SMTP_SETTINGS.port, 1, 65535),
    secure: !!merged.secure,
    user: String(merged.user || '').trim(),
    pass: String(merged.pass || ''),
    fromName: String(merged.fromName || DEFAULT_SMTP_SETTINGS.fromName).trim(),
    recipients: normalizeRecipients(merged.recipients),
    scheduleHour: clampInteger(merged.scheduleHour, DEFAULT_SMTP_SETTINGS.scheduleHour, 0, 23),
    scheduleMinute: clampInteger(merged.scheduleMinute, DEFAULT_SMTP_SETTINGS.scheduleMinute, 0, 59),
    allowInvalidCerts: !!merged.allowInvalidCerts,
    enabled: !!merged.enabled,
    catchUpOnStart: merged.catchUpOnStart !== false,
    dryRun: !!merged.dryRun
  };
}

function getEmailSettings() {
  try {
    const saved = getDatabase().getSetting('email_settings');
    return normalizeEmailSettings(saved || {});
  } catch (error) {
    console.error('Error reading email settings:', error);
    return normalizeEmailSettings();
  }
}

function saveEmailSettings(settings) {
  try {
    const normalized = normalizeEmailSettings(settings || {});
    getDatabase().setSetting('email_settings', normalized);
    return { success: true, settings: normalized };
  } catch (error) {
    console.error('Error saving email settings:', error);
    return { success: false, error: error.message };
  }
}

function getReportState() {
  try {
    return getDatabase().getSetting(REPORT_STATE_KEY) || {};
  } catch (error) {
    console.error('Error reading report state:', error);
    return {};
  }
}

function updateReportState(patch = {}) {
  try {
    const current = getReportState();
    const next = { ...current, ...patch };
    getDatabase().setSetting(REPORT_STATE_KEY, next);
    return next;
  } catch (error) {
    console.error('Error saving report state:', error);
    return null;
  }
}

function createTransporter(settings) {
  const config = normalizeEmailSettings(settings || getEmailSettings());
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    },
    ...(config.allowInvalidCerts ? { tls: { rejectUnauthorized: false } } : {})
  });
}

function isDryRunEnabled(settings, options = {}) {
  if (typeof options.dryRun === 'boolean') return options.dryRun;
  if (settings.dryRun) return true;
  return toBoolean(process.env.SMTP_DRY_RUN, false);
}

function validateSendSettings(settings, options = {}) {
  const dryRun = isDryRunEnabled(settings, options);
  if (!Array.isArray(settings.recipients) || settings.recipients.length === 0) {
    return 'Alici listesi bos';
  }
  if (dryRun) return null;
  if (!settings.host) return 'SMTP host bos';
  if (!settings.user) return 'SMTP user bos';
  if (!settings.pass) return 'SMTP sifre bos';
  return null;
}

async function testSmtpConnection() {
  try {
    const settings = getEmailSettings();
    const validationError = validateSendSettings(settings, { dryRun: false });
    if (validationError) {
      return { success: false, error: validationError };
    }
    const transporter = createTransporter(settings);
    await transporter.verify();
    return { success: true, message: 'SMTP baglantisi basarili.' };
  } catch (error) {
    console.error('SMTP test failed:', error);
    return { success: false, error: error.message };
  }
}

function formatTime(dateStr) {
  if (!dateStr) return '-';
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function calcDuration(entry, exit) {
  if (!exit) return 'Iceride';
  const entryDate = new Date(entry);
  const exitDate = new Date(exit);
  if (Number.isNaN(entryDate.getTime()) || Number.isNaN(exitDate.getTime())) return '-';
  const diff = Math.max(0, exitDate.getTime() - entryDate.getTime());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}s ${m}dk` : `${m}dk`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateReportHTML(logs, dateLabel, stats) {
  const rows = logs.map((log) => `
    <tr>
      <td>${escapeHtml(log.sub_category || '-')}</td>
      <td><b>${escapeHtml(log.plate || log.name || '-')}</b></td>
      <td>${escapeHtml(log.driver || '-')}</td>
      <td>${escapeHtml(log.host || '-')}</td>
      <td>${escapeHtml(formatTime(log.created_at))}</td>
      <td>${escapeHtml(log.exit_at ? formatTime(log.exit_at) : '-')}</td>
      <td>${escapeHtml(calcDuration(log.created_at, log.exit_at))}</td>
    </tr>
  `).join('');

  const insideLogs = logs.filter((log) => !log.exit_at);
  const insideHtml = insideLogs.length > 0
    ? `
      <h3>Hala Iceride (${insideLogs.length})</h3>
      <ul>
        ${insideLogs.map((log) => `<li>${escapeHtml(log.plate || log.name || '-')} - ${escapeHtml(log.sub_category || '-')}</li>`).join('')}
      </ul>
    `
    : '';

  return `
<!DOCTYPE html>
<html>
  <body style="font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px">
    <div style="max-width:920px;margin:auto;background:#1e293b;padding:16px;border-radius:10px">
      <h2 style="margin:0 0 8px 0">Malhotra Guvenlik Raporu</h2>
      <p style="margin:0 0 16px 0;color:#94a3b8">Tarih: ${escapeHtml(dateLabel)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <div style="padding:8px 10px;background:#0f172a;border-radius:8px">Toplam: <b>${stats.total}</b></div>
        <div style="padding:8px 10px;background:#0f172a;border-radius:8px">Cikis yapan: <b>${stats.exited}</b></div>
        <div style="padding:8px 10px;background:#0f172a;border-radius:8px">Iceride: <b>${stats.inside}</b></div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#0f172a">
            <th style="text-align:left;padding:8px">Kategori</th>
            <th style="text-align:left;padding:8px">Plaka/Isim</th>
            <th style="text-align:left;padding:8px">Surucu</th>
            <th style="text-align:left;padding:8px">Ilgili</th>
            <th style="text-align:left;padding:8px">Giris</th>
            <th style="text-align:left;padding:8px">Cikis</th>
            <th style="text-align:left;padding:8px">Sure</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="7" style="padding:12px">Kayit yok</td></tr>'}
        </tbody>
      </table>
      ${insideHtml}
      <p style="margin-top:16px;color:#94a3b8;font-size:12px">Bu e-posta sistem tarafindan otomatik olusturulmustur.</p>
    </div>
  </body>
</html>
`;
}

function loadLogsForDate(dateISO) {
  const db = getDatabase();
  const fromRange = db.getLogsByDateRange(dateISO, dateISO) || [];
  if (fromRange.length > 0) return fromRange;

  const scanLimit = clampInteger(process.env.EMAIL_REPORT_SCAN_LIMIT, 50000, 1000, 500000);
  const all = db.getAllLogs(scanLimit) || [];
  return all.filter((log) => {
    if (!log?.created_at) return false;
    const dt = new Date(log.created_at);
    if (Number.isNaN(dt.getTime())) return false;
    return toLocalDateISO(dt) === dateISO;
  });
}

function buildStats(logs) {
  return {
    total: logs.length,
    exited: logs.filter((log) => !!log.exit_at).length,
    inside: logs.filter((log) => !log.exit_at).length
  };
}

function resolveSendArguments(targetDateOrOptions = null, maybeOptions = {}) {
  let targetDate = targetDateOrOptions;
  let options = maybeOptions || {};

  if (
    targetDateOrOptions &&
    typeof targetDateOrOptions === 'object' &&
    !Array.isArray(targetDateOrOptions)
  ) {
    options = { ...targetDateOrOptions };
    targetDate = targetDateOrOptions.targetDate || null;
  }

  return { targetDate, options };
}

function firstErrorFromResults(results) {
  const failed = (results || []).find((x) => x.status === 'error');
  return failed ? (failed.error || 'E-posta gonderilemedi') : null;
}

async function sendDailyReport(targetDateOrOptions = null, maybeOptions = {}) {
  let targetDate = null;
  let options = {};
  try {
    ({ targetDate, options } = resolveSendArguments(targetDateOrOptions, maybeOptions));
    const settings = getEmailSettings();
    const reason = String(options.reason || 'manual');
    const force = options.force === true;
    const dryRun = isDryRunEnabled(settings, options);

    const validationError = validateSendSettings(settings, { dryRun });
    if (validationError) {
      return { success: false, error: validationError };
    }

    const { dateISO, dateLabel } = parseTargetDate(targetDate);
    const currentState = getReportState();

    if (!force && reason !== 'manual' && currentState.lastSuccessDateISO === dateISO) {
      return {
        success: true,
        skipped: true,
        reason: 'already_sent',
        date: dateLabel,
        dateISO,
        stats: currentState.lastStats || null,
        results: currentState.lastResults || []
      };
    }

    const logs = loadLogsForDate(dateISO);
    const stats = buildStats(logs);
    const html = generateReportHTML(logs, dateLabel, stats);
    const subject = `Guvenlik Raporu - ${dateLabel}`;

    const results = [];
    if (dryRun) {
      settings.recipients.forEach((to) => {
        results.push({ email: to, status: 'dry-run' });
      });
    } else {
      const transporter = createTransporter(settings);
      const fromAddress = settings.user || 'noreply@localhost';
      for (const to of settings.recipients) {
        try {
          await transporter.sendMail({
            from: `"${settings.fromName}" <${fromAddress}>`,
            to,
            subject,
            html
          });
          results.push({ email: to, status: 'ok' });
        } catch (error) {
          results.push({ email: to, status: 'error', error: error.message });
        }
      }
    }

    const successCount = results.filter((x) => x.status === 'ok' || x.status === 'dry-run').length;
    const success = successCount > 0;
    const errorMessage = success ? null : (firstErrorFromResults(results) || 'E-posta gonderilemedi');
    const nowISO = new Date().toISOString();

    const reportPatch = {
      lastAttemptAt: nowISO,
      lastAttemptDateISO: dateISO,
      lastReason: reason,
      lastDryRun: dryRun,
      lastStats: stats,
      lastResults: results,
      lastError: errorMessage
    };
    if (success) {
      reportPatch.lastSuccessAt = nowISO;
      reportPatch.lastSuccessDateISO = dateISO;
    }
    updateReportState(reportPatch);

    return {
      success,
      skipped: false,
      reason,
      dryRun,
      date: dateLabel,
      dateISO,
      stats,
      results,
      error: errorMessage
    };
  } catch (error) {
    console.error('Send daily report error:', error);
    const nowISO = new Date().toISOString();
    updateReportState({
      lastAttemptAt: nowISO,
      lastReason: (options && options.reason) || 'manual',
      lastError: error.message
    });
    return { success: false, error: error.message };
  }
}

async function sendTestEmail() {
  try {
    const settings = getEmailSettings();
    const dryRun = isDryRunEnabled(settings);
    const validationError = validateSendSettings(settings, { dryRun });
    if (validationError) {
      return { success: false, error: validationError };
    }

    if (dryRun) {
      return { success: true, message: 'Dry-run aktif. SMTP test e-postasi simule edildi.' };
    }

    const transporter = createTransporter(settings);
    const to = settings.recipients[0] || settings.user;
    await transporter.sendMail({
      from: `"${settings.fromName}" <${settings.user}>`,
      to,
      subject: 'Guvenlik Paneli SMTP Test',
      html: `
        <div style="font-family:Arial,sans-serif;padding:12px">
          <h3>SMTP Test Basarili</h3>
          <p>Zaman: ${new Date().toLocaleString('tr-TR')}</p>
        </div>
      `
    });
    return { success: true, message: 'Test e-postasi gonderildi.' };
  } catch (error) {
    console.error('Test email error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getEmailSettings,
  saveEmailSettings,
  getReportState,
  testSmtpConnection,
  sendDailyReport,
  sendTestEmail
};
