const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

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

const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadEnv(envPath) {
  const env = {};
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text || text.startsWith('#') || !text.includes('=')) return;
    const idx = text.indexOf('=');
    const key = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    env[key] = value;
  });
  return env;
}

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

function dedupeRows(rows) {
  const uniqueRows = [];
  const indexByCreatedAt = new Map();
  let duplicateCount = 0;
  let adjustedCount = 0;

  rows.forEach((row) => {
    if (!row?.created_at) return;

    let offsetMs = 0;
    while (offsetMs < 1000) {
      const candidate = shiftRowTimestamps(row, offsetMs);
      const existingIndex = indexByCreatedAt.get(candidate.created_at);

      if (existingIndex === undefined) {
        uniqueRows.push(candidate);
        indexByCreatedAt.set(candidate.created_at, uniqueRows.length - 1);
        if (offsetMs > 0) adjustedCount += 1;
        return;
      }

      const existing = uniqueRows[existingIndex];
      if (buildSignature(existing) === buildSignature(candidate)) {
        duplicateCount += 1;
        return;
      }

      offsetMs += 1;
    }
  });

  return { uniqueRows, duplicateCount, adjustedCount };
}

function chunked(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

function isMissingColumnError(error, column) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (!msg.includes('column')) return false;
  const target = escapeRegex(String(column || '').toLowerCase());
  if (new RegExp(`['"\`]${target}['"\`]`).test(msg)) return true;
  return new RegExp(`(^|[^a-z0-9_])${target}([^a-z0-9_]|$)`).test(msg);
}

async function tryUpsertChunk(client, chunk) {
  let workingChunk = chunk;

  while (true) {
    const { error } = await client
      .from('security_logs')
      .upsert(workingChunk, { onConflict: 'created_at' });

    if (!error) {
      return null;
    }

    const missingColumns = new Set();
    workingChunk.forEach((row) => {
      Object.keys(row || {}).forEach((column) => {
        if (isMissingColumnError(error, column)) {
          missingColumns.add(column);
        }
      });
    });

    if (missingColumns.size === 0 && isMissingColumnError(error, 'event_type')) {
      missingColumns.add('event_type');
    }

    if (missingColumns.size === 0) {
      return error;
    }

    workingChunk = workingChunk.map((row) => {
      const next = { ...row };
      missingColumns.forEach((column) => delete next[column]);
      return next;
    });
  }
}

async function upsertChunkWithRetry(client, chunk) {
  if (!Array.isArray(chunk) || chunk.length === 0) {
    return { successRows: [], errorRows: [], lastError: '' };
  }

  const error = await tryUpsertChunk(client, chunk);
  if (!error) {
    return { successRows: chunk, errorRows: [], lastError: '' };
  }

  if (chunk.length === 1) {
    return {
      successRows: [],
      errorRows: chunk,
      lastError: error?.message || String(error)
    };
  }

  const mid = Math.floor(chunk.length / 2);
  const left = await upsertChunkWithRetry(client, chunk.slice(0, mid));
  const right = await upsertChunkWithRetry(client, chunk.slice(mid));
  return {
    successRows: [...left.successRows, ...right.successRows],
    errorRows: [...left.errorRows, ...right.errorRows],
    lastError: right.lastError || left.lastError || (error?.message || String(error))
  };
}

async function fetchExistingCreatedAtSet(client, chunk) {
  const createdAtList = Array.from(new Set(chunk.map((row) => row.created_at).filter(Boolean)));
  if (createdAtList.length === 0) return new Set();
  const { data, error } = await client
    .from('security_logs')
    .select('created_at')
    .in('created_at', createdAtList);

  if (error) {
    throw error;
  }
  return new Set((data || []).map((row) => row.created_at));
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Usage: node scripts/import-security-excel-to-supabase.js <input.xlsx>');
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const env = loadEnv(path.join(projectRoot, '.env'));
  const supabaseUrl = (env.REACT_APP_SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  const supabaseKey = (env.REACT_APP_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase env values in .env');
  }

  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, cellDates: true });
  const mappedRecords = rows.map(mapRowDetailed);
  const mappedRows = mappedRecords.map((item) => item.log).filter(Boolean);
  const warningCount = mappedRecords.reduce((sum, item) => sum + (item.warnings || []).length, 0);
  const invalidRows = mappedRecords.reduce((sum, item) => sum + ((item.errors || []).length > 0 ? 1 : 0), 0);
  const { uniqueRows, duplicateCount, adjustedCount } = dedupeRows(mappedRows);

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const chunkSize = 100;
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  let lastError = '';

  for (const chunk of chunked(uniqueRows, chunkSize)) {
    const existingSet = await fetchExistingCreatedAtSet(client, chunk);
    const chunkResult = await upsertChunkWithRetry(client, chunk);

    errors += chunkResult.errorRows.length;
    if (chunkResult.lastError) lastError = chunkResult.lastError;

    (chunkResult.successRows || []).forEach((row) => {
      if (existingSet.has(row.created_at)) {
        updated += 1;
      } else {
        inserted += 1;
      }
    });
  }

  console.log(JSON.stringify({
    inputPath,
    sourceRows: rows.length,
    validRows: mappedRows.length,
    invalidRows,
    warningCount,
    totalRows: uniqueRows.length,
    duplicateRows: duplicateCount,
    adjustedRows: adjustedCount,
    inserted,
    updated,
    errors,
    lastError
  }, null, 2));
}

module.exports = {
  mapRow,
  mapRowDetailed,
  dedupeRows,
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
