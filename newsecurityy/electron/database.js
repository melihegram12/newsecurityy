const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let SQL = null;

// Lokalde tutulan kolonlar
const LOG_COLUMNS = new Set([
  'event_type',
  'type',
  'sub_category',
  'shift',
  'plate',
  'driver',
  'name',
  'host',
  'note',
  'location',
  'entry_location',
  'exit_location',
  'seal_number',
  'seal_number_entry',
  'seal_number_exit',
  'tc_no',
  'phone',
  'user_email',
  'created_at',
  'exit_at'
]);

const LOG_COLUMN_DEFS = {
  event_type: 'TEXT',
  type: 'TEXT',
  sub_category: 'TEXT',
  shift: 'TEXT',
  plate: 'TEXT',
  driver: 'TEXT',
  name: 'TEXT',
  host: 'TEXT',
  note: 'TEXT',
  location: 'TEXT',
  entry_location: 'TEXT',
  exit_location: 'TEXT',
  seal_number: 'TEXT',
  seal_number_entry: 'TEXT',
  seal_number_exit: 'TEXT',
  tc_no: 'TEXT',
  phone: 'TEXT',
  user_email: 'TEXT',
  created_at: 'TEXT',
  exit_at: 'TEXT'
};

const LOG_COLUMN_LIST = Object.keys(LOG_COLUMN_DEFS);
const LOG_UPDATE_COLUMNS = LOG_COLUMN_LIST.filter((col) => col !== 'created_at');
const LOCAL_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function normalizeIsoDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();

  const localMatch = LOCAL_DATE_RE.exec(str);
  let dt = null;

  if (localMatch) {
    const day = Number(localMatch[1]);
    const month = Number(localMatch[2]);
    const year = Number(localMatch[3]);
    const hour = Number(localMatch[4]);
    const minute = Number(localMatch[5]);
    const second = Number(localMatch[6] || '0');
    dt = new Date(year, month - 1, day, hour, minute, second);
  } else {
    // 2026-02-20T11:30:45+0000 -> 2026-02-20T11:30:45+00:00
    const normalizedOffset = str.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const parsed = new Date(normalizedOffset);
    if (!Number.isNaN(parsed.getTime())) {
      dt = parsed;
    }
  }

  if (!dt || Number.isNaN(dt.getTime())) return str;
  return dt.toISOString();
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  return String(value).trim() === '';
}

function normalizeForCompare(value) {
  return value === undefined ? null : value;
}

function pickLatestIsoDate(a, b) {
  const na = normalizeIsoDate(a);
  const nb = normalizeIsoDate(b);

  if (!na && !nb) return null;
  if (!na) return nb;
  if (!nb) return na;

  const ta = new Date(na).getTime();
  const tb = new Date(nb).getTime();
  if (Number.isNaN(ta)) return nb;
  if (Number.isNaN(tb)) return na;
  return tb > ta ? nb : na;
}

function hasRowChanged(a, b) {
  return LOG_COLUMN_LIST.some((col) => normalizeForCompare(a[col]) !== normalizeForCompare(b[col]));
}

function mergeRows(primary, secondary) {
  const merged = { ...primary };

  LOG_UPDATE_COLUMNS.forEach((col) => {
    if (col === 'exit_at') {
      merged.exit_at = pickLatestIsoDate(primary.exit_at, secondary.exit_at);
      return;
    }
    if (isBlank(merged[col]) && !isBlank(secondary[col])) {
      merged[col] = secondary[col];
    }
  });

  return merged;
}

function findLogIdByCreatedAt(createdAt) {
  const normalizedCreatedAt = normalizeIsoDate(createdAt);
  if (!normalizedCreatedAt) return null;

  const stmt = db.prepare(`SELECT id FROM security_logs WHERE created_at = ? LIMIT 1`);
  stmt.bind([normalizedCreatedAt]);
  let existingId = null;
  if (stmt.step()) {
    existingId = stmt.getAsObject().id;
  }
  stmt.free();
  return existingId;
}

function normalizeAndDeduplicateLogs() {
  const stmt = db.prepare(`SELECT id, ${LOG_COLUMN_LIST.join(', ')} FROM security_logs ORDER BY id ASC`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  if (rows.length === 0) return { updated: 0, deleted: 0 };

  const updateStmt = db.prepare(`UPDATE security_logs SET ${LOG_COLUMN_LIST.map((col) => `${col} = ?`).join(', ')} WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM security_logs WHERE id = ?`);

  const canonicalMap = new Map(); // created_at -> keeperRow
  let updated = 0;
  let deleted = 0;

  rows.forEach((row) => {
    const normalizedCreatedAt = normalizeIsoDate(row.created_at);
    if (!normalizedCreatedAt) return;

    const normalizedRow = {
      ...row,
      created_at: normalizedCreatedAt,
      exit_at: normalizeIsoDate(row.exit_at)
    };

    const keeper = canonicalMap.get(normalizedCreatedAt);

    // First row for this created_at key
    if (!keeper) {
      canonicalMap.set(normalizedCreatedAt, normalizedRow);
      if (hasRowChanged(row, normalizedRow)) {
        updateStmt.run([
          ...LOG_COLUMN_LIST.map((col) => (normalizedRow[col] !== undefined ? normalizedRow[col] : null)),
          row.id
        ]);
        updated += 1;
      }
      return;
    }

    // Merge duplicate row into keeper and remove duplicate
    const mergedKeeper = mergeRows(keeper, normalizedRow);
    if (hasRowChanged(keeper, mergedKeeper)) {
      updateStmt.run([
        ...LOG_COLUMN_LIST.map((col) => (mergedKeeper[col] !== undefined ? mergedKeeper[col] : null)),
        keeper.id
      ]);
      updated += 1;
      canonicalMap.set(normalizedCreatedAt, mergedKeeper);
    }

    deleteStmt.run([row.id]);
    deleted += 1;
  });

  updateStmt.free();
  deleteStmt.free();
  return { updated, deleted };
}

function ensureLogColumns() {
  if (!db) return;

  let existing = new Set();
  try {
    const result = db.exec(`PRAGMA table_info('security_logs')`);
    if (result && result.length > 0) {
      const columns = result[0].columns || [];
      const values = result[0].values || [];
      const nameIdx = columns.indexOf('name');
      if (nameIdx >= 0) {
        values.forEach((row) => {
          const name = row[nameIdx];
          if (name) existing.add(name);
        });
      }
    }
  } catch (e) {
    console.error('Error reading security_logs schema:', e);
    return;
  }

  Object.keys(LOG_COLUMN_DEFS).forEach((col) => {
    if (existing.has(col)) return;
    try {
      db.run(`ALTER TABLE security_logs ADD COLUMN ${col} ${LOG_COLUMN_DEFS[col]}`);
      console.log(`Added missing column: ${col}`);
    } catch (e) {
      console.error(`Failed to add column ${col}:`, e);
    }
  });
}

function filterLogData(input = {}) {
  const output = {};
  Object.keys(input || {}).forEach((key) => {
    if (LOG_COLUMNS.has(key)) {
      if (input[key] === undefined) {
        output[key] = undefined;
        return;
      }
      if (key === 'created_at' || key === 'exit_at') {
        output[key] = normalizeIsoDate(input[key]);
      } else {
        output[key] = input[key];
      }
    }
  });
  return output;
}

// Veritabanı dosya yolu
function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'security_panel.db');
}

// Veritabanı başlatma
async function initDatabase() {
  if (db) return db;

  const dbPath = getDbPath();
  console.log('Database path:', dbPath);

  // SQL.js'i başlat
  SQL = await initSqlJs();

  // Mevcut veritabanı dosyası var mı kontrol et
  let buffer = null;
  if (fs.existsSync(dbPath)) {
    try {
      buffer = fs.readFileSync(dbPath);
      console.log('Existing database loaded');
    } catch (e) {
      console.log('Could not read existing database, creating new one');
    }
  }

  // Veritabanını oluştur veya aç
  db = buffer ? new SQL.Database(buffer) : new SQL.Database();

  // Tablo oluşturma
  db.run(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      type TEXT,
      sub_category TEXT,
      shift TEXT,
      plate TEXT,
      driver TEXT,
      name TEXT,
      host TEXT,
      note TEXT,
      location TEXT,
      entry_location TEXT,
      exit_location TEXT,
      seal_number TEXT,
      seal_number_entry TEXT,
      seal_number_exit TEXT,
      tc_no TEXT,
      phone TEXT,
      user_email TEXT,
      created_at TEXT NOT NULL UNIQUE,
      exit_at TEXT
    )
  `);

  // Eski veritabanlari icin kolonlari tamamla
  ensureLogColumns();
  const normalizeResult = normalizeAndDeduplicateLogs();
  if (normalizeResult.updated > 0 || normalizeResult.deleted > 0) {
    console.log(`Log timestamps normalized (updated=${normalizeResult.updated}, deleted duplicates=${normalizeResult.deleted})`);
  }

  db.run(`CREATE INDEX IF NOT EXISTS idx_plate ON security_logs(plate)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_name ON security_logs(name)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_created_at_unique ON security_logs(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_exit_at ON security_logs(exit_at)`);

  // Ayarlar tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Değişiklikleri kaydet
  saveDatabase();

  console.log('Database initialized successfully');
  return db;
}

// Veritabanını dosyaya kaydet
function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(getDbPath(), buffer);
  } catch (e) {
    console.error('Error saving database:', e);
  }
}

// SQL sonucunu obje dizisine dönüştür
function resultToObjects(result) {
  if (!result || result.length === 0) return [];
  const columns = result[0].columns;
  const values = result[0].values;
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

// Tüm aktif kayıtları getir (çıkış yapmamış)
function getActiveLogs() {
  const stmt = db.prepare(`
    SELECT * FROM security_logs
    WHERE exit_at IS NULL
    ORDER BY created_at DESC
  `);
  const logs = [];
  while (stmt.step()) {
    logs.push(stmt.getAsObject());
  }
  stmt.free();
  return logs;
}

// Tüm kayıtları getir (limit ile)
function getAllLogs(limit = 1000) {
  const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 1000;
  const stmt = db.prepare(`
    SELECT * FROM security_logs
    ORDER BY created_at DESC
    LIMIT ?
  `);
  stmt.bind([safeLimit]);

  const logs = [];
  while (stmt.step()) {
    logs.push(stmt.getAsObject());
  }
  stmt.free();
  return logs;
}

// ID ile tek kayıt getir
function getLogById(id) {
  const stmt = db.prepare(`
    SELECT * FROM security_logs
    WHERE id = ?
    LIMIT 1
  `);
  stmt.bind([id]);

  let log = null;
  if (stmt.step()) {
    log = stmt.getAsObject();
  }
  stmt.free();
  return log;
}

// Tarih aralığına göre kayıtları getir
// Tum kayit sayisi
function getLogsCount() {
  const result = db.exec(`SELECT COUNT(*) as count FROM security_logs`);
  return result[0]?.values?.[0]?.[0] || 0;
}

// Sayfali kayit cekme (offset ile)
function getLogsPage(limit = 1000, offset = 0) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 1000;
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(0, Number(offset)) : 0;
  const stmt = db.prepare(`
    SELECT * FROM security_logs
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `);
  stmt.bind([safeLimit, safeOffset]);

  const logs = [];
  while (stmt.step()) {
    logs.push(stmt.getAsObject());
  }
  stmt.free();
  return logs;
}

function getLogsByDateRange(dateFrom, dateTo) {
  const stmt = db.prepare(`
    SELECT * FROM security_logs
    WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
    ORDER BY created_at DESC
  `);
  stmt.bind([dateFrom, dateTo]);

  const logs = [];
  while (stmt.step()) {
    logs.push(stmt.getAsObject());
  }
  stmt.free();
  return logs;
}

// Yeni kayıt ekle
function insertLog(logData) {
  const safeData = filterLogData(logData || {});
  const createdAt = safeData.created_at || normalizeIsoDate(new Date().toISOString());
  safeData.created_at = createdAt;

  const existingId = findLogIdByCreatedAt(createdAt);
  if (existingId) {
    updateLog(existingId, safeData);
    return { id: existingId, ...safeData, created_at: createdAt };
  }

  const stmt = db.prepare(`
    INSERT INTO security_logs (
      event_type, type, sub_category, shift, plate, driver, name, host, note, location,
      entry_location, exit_location, seal_number, seal_number_entry, seal_number_exit, tc_no, phone, user_email, created_at, exit_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run([
      safeData.event_type || null,
      safeData.type || null,
      safeData.sub_category || null,
      safeData.shift || null,
      safeData.plate || null,
      safeData.driver || null,
      safeData.name || null,
      safeData.host || null,
      safeData.note || null,
      safeData.location || null,
      safeData.entry_location || null,
      safeData.exit_location || null,
      safeData.seal_number || null,
      safeData.seal_number_entry || null,
      safeData.seal_number_exit || null,
      safeData.tc_no || null,
      safeData.phone || null,
      safeData.user_email || null,
      createdAt,
      safeData.exit_at || null
    ]);
  } catch (e) {
    const msg = String(e?.message || e || '').toLowerCase();
    if (msg.includes('unique') && msg.includes('created_at')) {
      const conflictId = findLogIdByCreatedAt(createdAt);
      if (conflictId) {
        updateLog(conflictId, safeData);
        return { id: conflictId, ...safeData, created_at: createdAt };
      }
    }
    throw e;
  } finally {
    stmt.free();
  }

  // Son eklenen ID'yi al
  const lastId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  saveDatabase();

  return { id: lastId, ...safeData, created_at: createdAt };
}

// Kayıt güncelle
function updateLog(id, updateData) {
  const safeData = filterLogData(updateData || {});
  const fields = Object.keys(safeData).filter(k => safeData[k] !== undefined);
  if (fields.length === 0) return false;

  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => safeData[f]);
  values.push(id);

  const stmt = db.prepare(`UPDATE security_logs SET ${setClause} WHERE id = ?`);
  stmt.run(values);
  stmt.free();

  saveDatabase();
  return true;
}

// Çıkış işlemi
function exitLog(id, exitData = {}) {
  const updateData = {
    exit_at: new Date().toISOString(),
    ...exitData
  };
  return updateLog(id, updateData);
}

// Kayıt sil
function deleteLog(id) {
  const stmt = db.prepare(`DELETE FROM security_logs WHERE id = ?`);
  stmt.run([id]);
  stmt.free();
  saveDatabase();
  return true;
}

// Supabase'den gelen kaydı created_at ile ekle/güncelle
function upsertLogByCreatedAt(logData) {
  if (!logData || !logData.created_at) return false;

  // Supabase id'sini yerel tabloya yazma
  const { id: _remoteId, ...data } = logData;
  const safeData = filterLogData(data);
  const existingId = findLogIdByCreatedAt(safeData.created_at);

  if (existingId) {
    updateLog(existingId, safeData);
    return true;
  }

  insertLog(safeData);
  return true;
}

// CSV'den veya toplu kaynaktan içe aktarım (created_at ile upsert)
function importLogs(logs = []) {
  if (!Array.isArray(logs)) {
    return { success: false, error: 'invalid_payload' };
  }

  let inserted = 0;
  let updated = 0;
  let invalid = 0;
  let errors = 0;

  const selectStmt = db.prepare(`SELECT id FROM security_logs WHERE created_at = ? LIMIT 1`);
  const insertStmt = db.prepare(`
    INSERT INTO security_logs (${LOG_COLUMN_LIST.join(', ')})
    VALUES (${LOG_COLUMN_LIST.map(() => '?').join(', ')})
  `);
  const updateStmt = db.prepare(`
    UPDATE security_logs
    SET ${LOG_UPDATE_COLUMNS.map((col) => `${col} = ?`).join(', ')}
    WHERE created_at = ?
  `);

  for (const log of logs) {
    try {
      const safeData = filterLogData(log || {});
      const createdAt = safeData.created_at;
      if (!createdAt) {
        invalid += 1;
        continue;
      }

      selectStmt.bind([createdAt]);
      const exists = selectStmt.step();
      selectStmt.reset();

      if (exists) {
        updateStmt.run([
          ...LOG_UPDATE_COLUMNS.map((col) => (safeData[col] !== undefined ? safeData[col] : null)),
          createdAt
        ]);
        updated += 1;
      } else {
        insertStmt.run(LOG_COLUMN_LIST.map((col) => (safeData[col] !== undefined ? safeData[col] : null)));
        inserted += 1;
      }
    } catch (e) {
      errors += 1;
    }
  }

  selectStmt.free();
  insertStmt.free();
  updateStmt.free();
  saveDatabase();

  return {
    success: true,
    total: logs.length,
    inserted,
    updated,
    invalid,
    errors
  };
}

// Plaka veya isim ile arama
function searchLogs(searchTerm, limit = 100) {
  const term = `%${searchTerm}%`;
  const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 100;
  const stmt = db.prepare(`
    SELECT * FROM security_logs
    WHERE plate LIKE ? OR name LIKE ? OR host LIKE ? OR driver LIKE ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  stmt.bind([term, term, term, term, safeLimit]);

  const logs = [];
  while (stmt.step()) {
    logs.push(stmt.getAsObject());
  }
  stmt.free();
  return logs;
}

// İstatistikler
function getStats() {
  const today = new Date().toISOString().split('T')[0];

  const todayResult = db.exec(`SELECT COUNT(*) as count FROM security_logs WHERE date(created_at) = date('${today}')`);
  const todayCount = todayResult[0]?.values[0][0] || 0;

  const activeResult = db.exec(`SELECT COUNT(*) as count FROM security_logs WHERE exit_at IS NULL`);
  const activeCount = activeResult[0]?.values[0][0] || 0;

  const vehicleResult = db.exec(`SELECT COUNT(*) as count FROM security_logs WHERE date(created_at) = date('${today}') AND type = 'vehicle'`);
  const vehicleToday = vehicleResult[0]?.values[0][0] || 0;

  const visitorResult = db.exec(`SELECT COUNT(*) as count FROM security_logs WHERE date(created_at) = date('${today}') AND type = 'visitor'`);
  const visitorToday = visitorResult[0]?.values[0][0] || 0;

  return {
    today: todayCount,
    activeNow: activeCount,
    todayVehicle: vehicleToday,
    todayVisitor: visitorToday
  };
}

// Ayar kaydet
function setSetting(key, value) {
  const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  stmt.run([key, JSON.stringify(value)]);
  stmt.free();
  saveDatabase();
}

// Ayar oku
function getSetting(key) {
  const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  stmt.bind([key]);
  const hasRow = stmt.step();
  const row = hasRow ? stmt.getAsObject() : null;
  stmt.free();
  if (row && row.value !== undefined) {
    try {
      return JSON.parse(row.value);
    } catch (e) {
      // Backward/forward compatibility: if the value is not valid JSON, return it as-is
      // instead of crashing the whole Electron main process.
      return row.value;
    }
  }
  return null;
}

// Veritabanını kapat
function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  getActiveLogs,
  getAllLogs,
  getLogById,
  getLogsCount,
  getLogsPage,
  getLogsByDateRange,
  insertLog,
  updateLog,
  exitLog,
  deleteLog,
  upsertLogByCreatedAt,
  importLogs,
  searchLogs,
  getStats,
  setSetting,
  getSetting,
  closeDatabase,
  getDbPath,
  saveDatabase
};
