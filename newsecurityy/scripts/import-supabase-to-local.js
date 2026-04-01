#!/usr/bin/env node
/**
 * Supabase → Local SQLite aktarım scripti
 * Tüm security_logs kayıtlarını Supabase'den çekip local DB'ye upsert eder.
 *
 * Kullanım: node scripts/import-supabase-to-local.js
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const initSqlJs = require('sql.js');
const { createClient } = require('@supabase/supabase-js');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return acc;

      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      acc[key] = value;
      return acc;
    }, {});
}

const fileEnv = readEnvFile(path.join(process.cwd(), '.env'));

// --- Config ---
const DB_PATH = path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  'newsecurityy',
  'security_panel.db'
);

const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  fileEnv.REACT_APP_SUPABASE_URL ||
  fileEnv.VITE_SUPABASE_URL ||
  '';

const SUPABASE_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  fileEnv.REACT_APP_SUPABASE_ANON_KEY ||
  fileEnv.VITE_SUPABASE_ANON_KEY ||
  '';

const PAGE_SIZE = 1000;

const COLUMNS = [
  'event_type', 'type', 'sub_category', 'shift', 'plate', 'driver',
  'name', 'host', 'note', 'location', 'entry_location', 'exit_location',
  'seal_number', 'seal_number_entry', 'seal_number_exit',
  'tc_no', 'phone', 'user_email', 'created_at', 'exit_at'
];

const SELECT_COLUMNS = COLUMNS.join(', ');
const UPDATE_COLUMNS = COLUMNS.filter(c => c !== 'created_at');

// --- Helpers ---
function normalizeIsoDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return str;
  return parsed.toISOString();
}

function getChronologyIssue(createdAt, exitAt) {
  if (!exitAt) return null;
  const createdTime = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  const exitTime = exitAt ? new Date(exitAt).getTime() : Number.NaN;
  if (Number.isNaN(createdTime) || Number.isNaN(exitTime)) return 'invalid_timestamp';
  if (exitTime < createdTime) return 'exit_before_entry';
  return null;
}

function isDesktopAppRunning() {
  if (process.platform !== 'win32') return false;

  try {
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "(Get-Process | Where-Object { $_.ProcessName -like 'NewSecurityy*' }).Count"
      ],
      { encoding: 'utf8' }
    ).trim();

    return Number(output) > 0;
  } catch (e) {
    return false;
  }
}

// --- Main ---
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase env eksik. .env icinde REACT_APP_SUPABASE_URL ve REACT_APP_SUPABASE_ANON_KEY (veya VITE_ varyantlari) gerekli.');
  }
  if (isDesktopAppRunning()) {
    throw new Error('NewSecurityy masaustu uygulamasi acik. Once uygulamayi kapatip tekrar deneyin.');
  }

  console.log('=== Supabase → Local SQLite Aktarim ===\n');

  // 1. Supabase bağlantısı
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { count, error: countErr } = await supabase
    .from('security_logs')
    .select('id', { count: 'exact', head: true });

  if (countErr) {
    console.error('Supabase baglanti hatasi:', countErr.message);
    process.exit(1);
  }
  console.log(`Supabase'de ${count} kayit bulundu.`);

  // 2. Tüm kayıtları paginated olarak çek
  const allRows = [];
  let cursor = null;
  let page = 0;

  // Supabase kolon uyumu: event_type/entry_location/exit_location olmayabilir
  const selectCandidates = [
    SELECT_COLUMNS,
    COLUMNS.filter(c => c !== 'event_type').join(', '),
    COLUMNS.filter(c => !['event_type', 'entry_location', 'exit_location'].includes(c)).join(', '),
  ];

  let workingSelect = null;

  while (true) {
    page++;
    let data = null;
    let error = null;

    const candidates = workingSelect ? [workingSelect] : selectCandidates;
    for (const sel of candidates) {
      let qb = supabase
        .from('security_logs')
        .select(sel)
        .order('created_at', { ascending: true })
        .limit(PAGE_SIZE);

      if (cursor) qb = qb.gt('created_at', cursor);

      ({ data, error } = await qb);
      if (!error) {
        workingSelect = sel;
        break;
      }
    }

    if (error) {
      console.error(`Sayfa ${page} hatasi:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allRows.push(...data);
    cursor = data[data.length - 1].created_at;
    process.stdout.write(`  Sayfa ${page}: ${data.length} kayit (toplam: ${allRows.length})\r`);

    if (data.length < PAGE_SIZE) break;
  }

  console.log(`\nSupabase'den toplam ${allRows.length} kayit cekildi.\n`);

  if (allRows.length === 0) {
    console.log('Aktarilacak kayit yok.');
    process.exit(0);
  }

  // 3. Local SQLite'ı aç
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Local DB bulunamadi: ${DB_PATH}`);
    console.error('Exe\'yi en az bir kez calistirip kapatmalisiniz.');
    process.exit(1);
  }

  // Yedek al
  const backupPath = DB_PATH + `.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`Yedek alindi: ${path.basename(backupPath)}`);

  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  // Tablo ve kolonlar
  db.run(`CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${COLUMNS.map(c => `${c} TEXT${c === 'created_at' ? ' NOT NULL UNIQUE' : ''}`).join(',\n    ')}
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

  // Mevcut kolonları kontrol et, eksik varsa ekle
  const existingCols = new Set();
  try {
    const info = db.exec("PRAGMA table_info('security_logs')");
    if (info.length > 0) {
      const nameIdx = info[0].columns.indexOf('name');
      info[0].values.forEach(row => { if (row[nameIdx]) existingCols.add(row[nameIdx]); });
    }
  } catch (e) {}

  for (const col of COLUMNS) {
    if (!existingCols.has(col)) {
      try { db.run(`ALTER TABLE security_logs ADD COLUMN ${col} TEXT`); } catch (e) {}
    }
  }

  // 4. Upsert: created_at ile eşleştir
  const selectStmt = db.prepare('SELECT id FROM security_logs WHERE created_at = ? LIMIT 1');
  const insertStmt = db.prepare(`INSERT INTO security_logs (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`);
  const updateStmt = db.prepare(`UPDATE security_logs SET ${UPDATE_COLUMNS.map(c => `${c} = ?`).join(', ')} WHERE created_at = ?`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let chronologyWarnings = 0;

  for (const row of allRows) {
    const createdAt = normalizeIsoDate(row.created_at);
    if (!createdAt) { skipped++; continue; }
    const exitAt = normalizeIsoDate(row.exit_at);
    const chronologyIssue = getChronologyIssue(createdAt, exitAt);
    if (chronologyIssue) {
      chronologyWarnings++;
      console.warn(`[WARN] Kronoloji anomalisi: ${chronologyIssue} | ${row.plate || row.name || createdAt}`);
      skipped++;
      continue;
    }

    const values = COLUMNS.map(c => {
      if (c === 'created_at') return createdAt;
      if (c === 'exit_at') return exitAt;
      return row[c] !== undefined ? row[c] : null;
    });

    selectStmt.bind([createdAt]);
    const exists = selectStmt.step();
    selectStmt.reset();

    if (exists) {
      // Update mevcut kayıt
      const updateValues = UPDATE_COLUMNS.map(c => {
        if (c === 'exit_at') return exitAt;
        return row[c] !== undefined ? row[c] : null;
      });
      updateValues.push(createdAt); // WHERE created_at = ?
      updateStmt.run(updateValues);
      updated++;
    } else {
      try {
        insertStmt.run(values);
        inserted++;
      } catch (e) {
        if (String(e).includes('UNIQUE')) { updated++; } else { skipped++; }
      }
    }
  }

  selectStmt.free();
  insertStmt.free();
  updateStmt.free();

  // 5. Kaydet
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log(`\n=== Aktarim Tamamlandi ===`);
  console.log(`  Yeni eklenen : ${inserted}`);
  console.log(`  Guncellenen  : ${updated}`);
  console.log(`  Atlanan      : ${skipped}`);
  console.log(`  Kronoloji Uyarisi : ${chronologyWarnings}`);
  console.log(`  Toplam       : ${allRows.length}`);
  console.log(`\nDB: ${DB_PATH}`);
}

main().catch(e => {
  console.error('Hata:', e);
  process.exit(1);
});
