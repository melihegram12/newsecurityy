const path = require('path');
const { app } = require('electron');

const database = require(path.resolve(__dirname, '..', 'electron', 'database'));
const emailService = require(path.resolve(__dirname, '..', 'electron', 'emailService'));
const scheduler = require(path.resolve(__dirname, '..', 'electron', 'scheduler'));

// Use the same profile folder as the real application.
app.setName('newsecurityy');

function toLocalDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateISO(dateISO) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || '').trim());
  if (!match) {
    throw new Error(`Invalid dateISO: ${dateISO}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function toISOAt(dateISO, hour, minute) {
  const { year, month, day } = parseDateISO(dateISO);
  const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
  return dt.toISOString();
}

function seedYesterdayLogs(dateISO) {
  const existing = database.getLogsByDateRange(dateISO, dateISO) || [];
  const staleSeedIds = existing
    .filter((row) => String(row?.note || '').startsWith('Smoke test seed log'))
    .map((row) => row.id)
    .filter(Boolean);

  staleSeedIds.forEach((id) => {
    try {
      database.deleteLog(id);
    } catch (cleanupError) {
      console.error('EMAIL_SMOKE_STALE_SEED_CLEANUP_FAILED:', cleanupError);
    }
  });

  const freshExisting = database.getLogsByDateRange(dateISO, dateISO) || [];
  if (freshExisting.length > 0) {
    return { inserted: 0, existing: freshExisting.length, insertedIds: [] };
  }

  const samples = [
    {
      event_type: 'ENTRY',
      type: 'vehicle',
      sub_category: 'Misafir Araci',
      shift: 'Vardiya 1 (08:00-16:00)',
      plate: '34SMOKE01',
      driver: 'Smoke Driver',
      host: 'QA',
      note: 'Smoke test seed log 1',
      created_at: toISOAt(dateISO, 9, 10),
      exit_at: toISOAt(dateISO, 10, 5),
      user_email: 'smoke@test.local'
    },
    {
      event_type: 'ENTRY',
      type: 'visitor',
      sub_category: 'Misafir',
      name: 'Smoke Visitor',
      host: 'QA',
      note: 'Smoke test seed log 2',
      created_at: toISOAt(dateISO, 14, 20),
      exit_at: null,
      user_email: 'smoke@test.local'
    }
  ];

  const insertedIds = [];
  samples.forEach((row) => {
    const inserted = database.insertLog(row);
    if (inserted?.id) insertedIds.push(inserted.id);
  });
  return { inserted: samples.length, existing: 0, insertedIds };
}

async function runSmoke() {
  let previousSettings = null;
  let previousReportState = null;
  let seedInfo = { inserted: 0, existing: 0, insertedIds: [] };
  let shouldRestore = false;

  try {
    await database.initDatabase();
    previousSettings = database.getSetting('email_settings');
    previousReportState = database.getSetting('email_report_state');
    shouldRestore = true;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = toLocalDateISO(yesterday);
    seedInfo = seedYesterdayLogs(targetDate);

    const smokeSettings = {
      ...emailService.getEmailSettings(),
      host: 'smtp.test.local',
      port: 587,
      secure: false,
      user: 'smoke@test.local',
      pass: 'smoke-pass',
      fromName: 'NewSecurityy Smoke Test',
      recipients: ['dry-run@example.com'],
      enabled: true,
      scheduleHour: 18,
      scheduleMinute: 0,
      catchUpOnStart: false,
      dryRun: true
    };
    emailService.saveEmailSettings(smokeSettings);

    scheduler.restart();
    const runResult = await scheduler.runNow(targetDate);
    const status = scheduler.getStatus();

    const output = {
      targetDate,
      seedInfo,
      runResult,
      status
    };

    console.log('EMAIL_SMOKE_RESULT_START');
    console.log(JSON.stringify(output, null, 2));
    console.log('EMAIL_SMOKE_RESULT_END');

    process.exitCode = runResult?.success ? 0 : 1;
  } catch (error) {
    console.error('EMAIL_SMOKE_FAILED:', error);
    process.exitCode = 1;
  } finally {
    try {
      if (Array.isArray(seedInfo?.insertedIds) && seedInfo.insertedIds.length > 0) {
        seedInfo.insertedIds.forEach((id) => {
          try {
            database.deleteLog(id);
          } catch (cleanupError) {
            console.error('EMAIL_SMOKE_SEED_CLEANUP_FAILED:', cleanupError);
          }
        });
      }

      if (shouldRestore) {
        database.setSetting('email_settings', previousSettings);
        database.setSetting('email_report_state', previousReportState);
      }
    } catch (restoreError) {
      console.error('EMAIL_SMOKE_RESTORE_FAILED:', restoreError);
    }

    try {
      scheduler.restart();
    } catch (schedulerError) {
      console.error('EMAIL_SMOKE_SCHEDULER_RESTART_FAILED:', schedulerError);
    }

    try {
      database.closeDatabase();
    } catch (closeError) {
      console.error('EMAIL_SMOKE_DB_CLOSE_FAILED:', closeError);
    }

    app.quit();
  }
}

app.whenReady().then(runSmoke);
