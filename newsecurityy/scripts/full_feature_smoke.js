const path = require('path');
const { app } = require('electron');

app.setName('newsecurityy');

const database = require(path.resolve(__dirname, '..', 'electron', 'database'));
const backupScheduler = require(path.resolve(__dirname, '..', 'electron', 'backupScheduler'));
const scheduler = require(path.resolve(__dirname, '..', 'electron', 'scheduler'));
const emailService = require(path.resolve(__dirname, '..', 'electron', 'emailService'));

function isoNow() {
  return new Date().toISOString();
}

function toLocalDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function run() {
  const output = { ok: false, steps: [] };
  let insertedId = null;
  let oldEmailSettings = null;
  let oldReportState = null;

  try {
    await database.initDatabase();
    output.steps.push({ step: 'init_db', ok: true });

    const createdAt = isoNow();
    const inserted = database.insertLog({
      event_type: 'ENTRY',
      type: 'vehicle',
      sub_category: 'Smoke',
      shift: 'Vardiya 1 (08:00-16:00)',
      plate: '34FULL001',
      driver: 'Smoke Driver',
      host: 'QA',
      note: 'full feature smoke',
      created_at: createdAt,
      exit_at: null
    });
    insertedId = inserted.id;
    output.steps.push({ step: 'db_insert', ok: !!insertedId, id: insertedId });

    const updated = database.updateLog(insertedId, { note: 'full feature smoke updated' });
    output.steps.push({ step: 'db_update', ok: !!updated });

    const exited = database.exitLog(insertedId, { note: 'full feature smoke exited' });
    output.steps.push({ step: 'db_exit', ok: !!exited });

    const searchRows = database.searchLogs('34FULL001', 10);
    output.steps.push({ step: 'db_search', ok: Array.isArray(searchRows) && searchRows.length > 0, count: searchRows.length });

    const stats = database.getStats();
    output.steps.push({ step: 'db_stats', ok: !!stats && typeof stats.today === 'number', stats });

    const backup = backupScheduler.runNow();
    output.steps.push({ step: 'backup_now', ok: !!backup?.success, backup });

    oldEmailSettings = database.getSetting('email_settings');
    oldReportState = database.getSetting('email_report_state');

    emailService.saveEmailSettings({
      host: 'smtp.test.local',
      port: 587,
      secure: false,
      user: 'smoke@test.local',
      pass: 'smoke-pass',
      fromName: 'Smoke',
      recipients: ['dry-run@example.com'],
      enabled: true,
      scheduleHour: 18,
      scheduleMinute: 0,
      catchUpOnStart: false,
      dryRun: true
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = toLocalDateISO(yesterday);
    const emailResult = await scheduler.runNow(targetDate);
    output.steps.push({ step: 'email_scheduler_run_now', ok: !!emailResult?.success, emailResult });

    output.steps.push({ step: 'scheduler_status', ok: true, status: scheduler.getStatus() });

    output.ok = output.steps.every((x) => x.ok);
  } catch (error) {
    output.error = error.message;
  } finally {
    try {
      if (insertedId) {
        database.deleteLog(insertedId);
      }
    } catch (e) {
      output.cleanupError = `deleteLog failed: ${e.message}`;
    }

    try {
      database.setSetting('email_settings', oldEmailSettings);
      database.setSetting('email_report_state', oldReportState);
    } catch (e) {
      output.cleanupError = output.cleanupError
        ? `${output.cleanupError}; restore settings failed: ${e.message}`
        : `restore settings failed: ${e.message}`;
    }

    try {
      scheduler.restart();
    } catch (e) {
      output.cleanupError = output.cleanupError
        ? `${output.cleanupError}; scheduler restart failed: ${e.message}`
        : `scheduler restart failed: ${e.message}`;
    }

    try {
      database.closeDatabase();
    } catch (e) {
      output.cleanupError = output.cleanupError
        ? `${output.cleanupError}; db close failed: ${e.message}`
        : `db close failed: ${e.message}`;
    }

    console.log('FULL_FEATURE_SMOKE_START');
    console.log(JSON.stringify(output, null, 2));
    console.log('FULL_FEATURE_SMOKE_END');
    process.exitCode = output.ok ? 0 : 1;
    app.quit();
  }
}

app.whenReady().then(run);
