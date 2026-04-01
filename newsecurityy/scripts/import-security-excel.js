const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const initSqlJs = require('sql.js');

const LOG_COLUMNS = [
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
];

const SELECT_COLUMNS = ['id', ...LOG_COLUMNS];
const DEFAULT_DB_PATH = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'newsecurityy',
  'security_panel.db'
);

const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function normalizeHeader(value = '') {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0131/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || ['null', 'none', 'nan'].includes(text.toLowerCase())) return null;
  return text;
}

function combineUnique(parts) {
  const unique = [];
  parts.filter(Boolean).forEach((part) => {
    if (!unique.includes(part)) unique.push(part);
  });
  return unique.length > 0 ? unique.join(' | ') : null;
}

function combineLocalDateTime(dateValue, timeValue) {
  const dateText = normalizeValue(dateValue);
  const timeText = normalizeValue(timeValue);
  if (!dateText || !timeText) return null;

  const dateMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(dateText);
  const timeMatch = TIME_ONLY_RE.exec(timeText);
  if (!dateMatch || !timeMatch) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || '0');

  const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getShift(createdAt) {
  const parsed = new Date(createdAt);
  const hour = parsed.getHours();
  if (hour >= 8 && hour < 16) return 'Vardiya 1 (08:00-16:00)';
  if (hour >= 16 && hour < 24) return 'Vardiya 2 (16:00-00:00)';
  return 'Vardiya 3 (00:00-08:00)';
}

function buildIssue(severity, code, message) {
  return { severity, code, message };
}

function getChronologyIssue(createdAt, exitAt) {
  if (!exitAt) return null;
  const createdTime = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  const exitTime = exitAt ? new Date(exitAt).getTime() : Number.NaN;
  if (Number.isNaN(createdTime) || Number.isNaN(exitTime)) return 'invalid_timestamp';
  if (exitTime < createdTime) return 'exit_before_entry';
  return null;
}

function looksLikePlate(value = '') {
  const text = String(value || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(0[1-9]|[1-7][0-9]|8[01])\s?[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc]{1,3}\s?\d{2,4}$/.test(text);
}

function mapSourceToCategory(source) {
  const raw = normalizeValue(source);
  if (!raw) return null;

  const key = normalizeHeader(raw);
  if (key.includes('muhur')) return 'Mühürlü Araç';
  if (key.includes('misafir') || key.includes('sivil')) return 'Misafir Araç';
  if (key.includes('yonetim')) return 'Yönetim Aracı';
  if (key.includes('personel') || key.includes('b_yaka') || key.includes('beyaz_yaka')) return 'Personel Aracı';
  if (key.includes('sirket') || looksLikePlate(raw)) return 'Şirket Aracı';
  return raw;
}

function shiftIsoByMs(value, offsetMs) {
  if (!value || !offsetMs) return value;
  const parsed = new Date(value);
  parsed.setMilliseconds(parsed.getMilliseconds() + offsetMs);
  return parsed.toISOString();
}

function shiftRowTimestamps(row, offsetMs) {
  if (!offsetMs) return row;
  return {
    ...row,
    created_at: shiftIsoByMs(row.created_at, offsetMs),
    exit_at: shiftIsoByMs(row.exit_at, offsetMs)
  };
}

function buildSignature(row = {}) {
  return JSON.stringify({
    type: row.type || null,
    sub_category: row.sub_category || null,
    plate: row.plate || null,
    name: row.name || null,
    note: row.note || null,
    location: row.location || null,
    exit_at: row.exit_at || null
  });
}

function rowToNormalizedMap(row = {}) {
  const map = {};
  Object.keys(row).forEach((key) => {
    const normalized = normalizeHeader(key);
    if (normalized) map[normalized] = row[key];
  });
  return map;
}

function getFieldValue(map, aliases) {
  for (const alias of aliases) {
    const normalized = normalizeHeader(alias);
    if (normalized && Object.prototype.hasOwnProperty.call(map, normalized)) {
      return map[normalized];
    }
  }
  return undefined;
}

function mapRowDetailed(row) {
  const fields = rowToNormalizedMap(row);
  const dateValue = getFieldValue(fields, ['tarih', 'date']);
  const entryValue = getFieldValue(fields, ['giris', 'entry_at']);
  const exitValue = getFieldValue(fields, ['cikis', 'exit_at']);
  const sourceValue = getFieldValue(fields, ['kaynak', 'sub_category', 'kategori']);
  const noteValue = getFieldValue(fields, ['firma_aciklama', 'note', 'aciklama']);
  const detailValue = getFieldValue(fields, ['detay']);
  const subCategory = mapSourceToCategory(sourceValue);
  const isLegacyCompanyRow = subCategory === 'Şirket Aracı'
    && (
      Object.prototype.hasOwnProperty.call(fields, normalizeHeader('giris'))
      || Object.prototype.hasOwnProperty.call(fields, normalizeHeader('cikis'))
    );
  const warnings = [];
  const errors = [];
  const normalizedEntryValue = normalizeValue(entryValue);
  const normalizedExitValue = normalizeValue(exitValue);
  const effectiveEntryValue = isLegacyCompanyRow
    ? (normalizedExitValue || entryValue)
    : entryValue;
  const effectiveExitValue = isLegacyCompanyRow
    ? (normalizedExitValue && normalizedEntryValue ? entryValue : null)
    : exitValue;

  const createdAt = combineLocalDateTime(dateValue, effectiveEntryValue) || combineLocalDateTime(dateValue, effectiveExitValue);
  if (!createdAt) {
    errors.push(buildIssue('error', 'missing_created_at', 'Gecerli giris zamani bulunamadi.'));
    return { log: null, warnings, errors };
  }

  if (isLegacyCompanyRow) {
    if (normalizedExitValue && !normalizedEntryValue) {
      warnings.push(buildIssue('warning', 'legacy_company_missing_return', 'Legacy sirket araci satirinda donus zamani yok; kayit acik aktarildi.'));
    } else if (!normalizedExitValue && normalizedEntryValue) {
      warnings.push(buildIssue('warning', 'legacy_company_missing_departure', 'Legacy sirket araci satirinda gidis zamani yok; kayit acik aktarildi.'));
    }
  } else if (!normalizedEntryValue && normalizedExitValue) {
    errors.push(buildIssue('error', 'missing_entry_time', 'Yalnizca cikis zamani olan satir tamamlanmis kayit olarak aktarilamadi.'));
  }

  const exitAt = combineLocalDateTime(dateValue, effectiveExitValue);
  const chronologyIssue = getChronologyIssue(createdAt, exitAt);
  if (chronologyIssue === 'exit_before_entry') {
    errors.push(buildIssue('error', 'exit_before_entry', 'Cikis zamani giris zamanindan once oldugu icin satir aktarilmadi.'));
  } else if (chronologyIssue === 'invalid_timestamp') {
    errors.push(buildIssue('error', 'invalid_timestamp', 'Giris/cikis zamanlari gecersiz oldugu icin satir aktarilmadi.'));
  }

  const log = {
    event_type: 'import',
    type: 'vehicle',
    sub_category: subCategory,
    shift: getShift(createdAt),
    plate: normalizeValue(getFieldValue(fields, ['plaka', 'plate'])),
    driver: normalizeValue(getFieldValue(fields, ['ad_soyad', 'name', 'isim'])),
    name: normalizeValue(getFieldValue(fields, ['ad_soyad', 'name', 'isim'])),
    host: null,
    note: combineUnique([
      normalizeValue(noteValue),
      normalizeValue(detailValue)
    ]),
    location: normalizeValue(getFieldValue(fields, ['lokasyon', 'location'])),
    entry_location: null,
    exit_location: null,
    seal_number: null,
    seal_number_entry: null,
    seal_number_exit: null,
    tc_no: null,
    phone: null,
    user_email: 'excel_import',
    created_at: createdAt,
    exit_at: exitAt
  };

  return {
    log: errors.length === 0 ? log : null,
    warnings,
    errors
  };
}

function mapRow(row) {
  return mapRowDetailed(row).log;
}

function ensureSchema(db) {
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
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_created_at_unique ON security_logs(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_exit_at ON security_logs(exit_at)');
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, cellDates: true });
}

function getExistingRow(selectStmt, createdAt) {
  selectStmt.bind([createdAt]);
  let row = null;
  if (selectStmt.step()) {
    row = selectStmt.getAsObject();
  }
  selectStmt.reset();
  return row;
}

async function main() {
  const inputPath = process.argv[2];
  const dbPath = process.argv[3] || DEFAULT_DB_PATH;

  if (!inputPath) {
    throw new Error('Usage: node scripts/import-security-excel.js <input.xlsx> [db-path]');
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const rows = readWorkbookRows(inputPath);
  const mappedRecords = rows.map(mapRowDetailed);
  const mappedRows = mappedRecords.map((item) => item.log).filter(Boolean);
  const warningCount = mappedRecords.reduce((sum, item) => sum + (item.warnings || []).length, 0);
  const invalidRows = mappedRecords.reduce((sum, item) => sum + ((item.errors || []).length > 0 ? 1 : 0), 0);
  if (mappedRows.length === 0) {
    throw new Error('No valid rows found in workbook');
  }

  const SQL = await initSqlJs();
  ensureParentDir(dbPath);
  const existingBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const db = existingBuffer ? new SQL.Database(existingBuffer) : new SQL.Database();

  ensureSchema(db);

  const backupPath = existingBuffer
    ? `${dbPath}.${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}.bak`
    : null;
  if (backupPath) {
    fs.copyFileSync(dbPath, backupPath);
  }

  const selectStmt = db.prepare(
    `SELECT ${SELECT_COLUMNS.join(', ')} FROM security_logs WHERE created_at = ? LIMIT 1`
  );
  const insertStmt = db.prepare(
    `INSERT INTO security_logs (${LOG_COLUMNS.join(', ')}) VALUES (${LOG_COLUMNS.map(() => '?').join(', ')})`
  );
  const updateStmt = db.prepare(
    `UPDATE security_logs SET ${LOG_COLUMNS.map((col) => `${col} = ?`).join(', ')} WHERE id = ?`
  );

  const summary = {
    sourceRows: rows.length,
    validRows: mappedRows.length,
    invalidRows,
    warningCount,
    inserted: 0,
    updated: 0,
    adjusted: 0,
    collisions: 0,
    backupPath
  };

  for (const originalRow of mappedRows) {
    let offsetMs = 0;
    while (offsetMs < 1000) {
      const candidate = shiftRowTimestamps(originalRow, offsetMs);
      const existingRow = getExistingRow(selectStmt, candidate.created_at);

      if (!existingRow) {
        insertStmt.run(LOG_COLUMNS.map((column) => candidate[column] ?? null));
        summary.inserted += 1;
        if (offsetMs > 0) summary.adjusted += 1;
        break;
      }

      if (buildSignature(existingRow) === buildSignature(candidate)) {
        updateStmt.run([
          ...LOG_COLUMNS.map((column) => candidate[column] ?? null),
          existingRow.id
        ]);
        summary.updated += 1;
        if (offsetMs > 0) summary.adjusted += 1;
        break;
      }

      summary.collisions += 1;
      offsetMs += 1;
    }
  }

  selectStmt.free();
  insertStmt.free();
  updateStmt.free();

  const buffer = Buffer.from(db.export());
  fs.writeFileSync(dbPath, buffer);
  db.close();

  console.log(JSON.stringify({
    inputPath,
    dbPath,
    ...summary
  }, null, 2));
}

module.exports = {
  mapRow,
  mapRowDetailed,
  mapSourceToCategory,
  looksLikePlate,
  combineLocalDateTime,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
