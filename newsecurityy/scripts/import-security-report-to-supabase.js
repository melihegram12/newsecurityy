const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { readFirstWorksheetRows } = require('./lib/exceljs-utils');

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function loadEnv(envPath) {
  const env = {};
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text || text.startsWith('#') || !text.includes('=')) return;
    const idx = text.indexOf('=');
    env[text.slice(0, idx).trim()] = text.slice(idx + 1).trim();
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
  if (!text) return null;
  if (['-', '--'].includes(text)) return null;
  const key = normalizeHeader(text);
  if (['null', 'none', 'nan', '-', 'yok', 'belirsiz'].includes(key)) return null;
  return text;
}

function rowToMap(row = {}) {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const normalized = normalizeHeader(key);
    if (normalized) out[normalized] = value;
  });
  return out;
}

function getAny(map, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  }
  return undefined;
}

function parseLocalDate(value) {
  if (value instanceof Date) {
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
  const text = normalizeValue(value);
  if (!text) return null;
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function parseTime(value) {
  if (value instanceof Date) {
    return { hour: value.getHours(), minute: value.getMinutes(), second: value.getSeconds() };
  }
  const text = normalizeValue(value);
  if (!text) return null;
  const key = normalizeHeader(text);
  if (key.includes('iceride')) return null;
  const match = text.match(TIME_RE);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] || '0'),
  };
}

function combineDateTime(dateValue, timeValue) {
  const date = parseLocalDate(dateValue);
  const time = parseTime(timeValue);
  if (!date || !time) return null;
  const parsed = new Date(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
    time.second,
    0
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getShift(createdAt) {
  const hour = createdAt.getHours();
  if (hour >= 8 && hour < 16) return 'Vardiya 1 (08:00-16:00)';
  if (hour >= 16 && hour < 24) return 'Vardiya 2 (16:00-00:00)';
  return 'Vardiya 3 (00:00-08:00)';
}

function isVehicleCategory(category) {
  const key = normalizeHeader(category);
  return key.includes('arac') || key.includes('muhur') || key.includes('yonetim') || key.includes('sirket');
}

function buildLegacyLocationValue(entryLocation, exitLocation, fallback) {
  const entry = normalizeValue(entryLocation);
  const exit = normalizeValue(exitLocation);
  if (entry || exit) return [entry, exit].filter(Boolean).join(' -> ');
  return normalizeValue(fallback);
}

function shiftIsoByMs(value, offsetMs) {
  if (!offsetMs) return value;
  const parsed = new Date(value);
  parsed.setMilliseconds(parsed.getMilliseconds() + offsetMs);
  return parsed.toISOString();
}

function sameLogicalRecord(existing = {}, row = {}) {
  const existingIdentifier = String(existing.plate || existing.name || '').trim().toLocaleUpperCase('tr-TR');
  const rowIdentifier = String(row.plate || row.name || '').trim().toLocaleUpperCase('tr-TR');
  return String(existing.type || '') === String(row.type || '')
    && String(existing.sub_category || '') === String(row.sub_category || '')
    && existingIdentifier === rowIdentifier;
}

function mapReportRow(row) {
  const map = rowToMap(row);
  const reportDate = getAny(map, ['tarih', 'date']);
  const category = normalizeValue(getAny(map, ['kategori', 'sub_category']));
  const identifier = normalizeValue(getAny(map, ['plaka_isim', 'plaka', 'isim', 'ad_soyad']));
  const entryTime = getAny(map, ['giris_saati', 'giris']);
  const exitTime = getAny(map, ['cikis_saati', 'cikis']);
  const createdAtDate = combineDateTime(reportDate, entryTime);
  if (!createdAtDate || !category) return null;

  let exitAtDate = combineDateTime(reportDate, exitTime);
  if (exitAtDate && exitAtDate.getTime() < createdAtDate.getTime()) {
    exitAtDate = new Date(exitAtDate.getTime() + 24 * 60 * 60 * 1000);
  }

  const isVehicle = isVehicleCategory(category);
  const location = normalizeValue(getAny(map, ['lokasyon', 'location']));
  const exitLocation = normalizeValue(getAny(map, ['cikis_lokasyon', 'gidecegi_lokasyon']));
  const entryLocation = normalizeValue(getAny(map, ['giris_lokasyon', 'geldigi_lokasyon']));

  return {
    event_type: 'import',
    type: isVehicle ? 'vehicle' : 'visitor',
    sub_category: category,
    shift: normalizeValue(getAny(map, ['vardiya', 'shift'])) || getShift(createdAtDate),
    plate: isVehicle && identifier ? identifier.toLocaleUpperCase('tr-TR') : null,
    driver: isVehicle ? normalizeValue(getAny(map, ['surucu', 'sofor', 'driver'])) : null,
    name: isVehicle ? null : identifier,
    host: normalizeValue(getAny(map, ['ilgili_birim', 'birim', 'host'])),
    note: normalizeValue(getAny(map, ['aciklama', 'note'])),
    location: buildLegacyLocationValue(entryLocation, exitLocation, location),
    entry_location: entryLocation,
    exit_location: exitLocation,
    seal_number: normalizeValue(getAny(map, ['giris_muhru', 'muhur_no', 'seal_number'])),
    seal_number_entry: normalizeValue(getAny(map, ['giris_muhru', 'giris_muhur_no'])),
    seal_number_exit: normalizeValue(getAny(map, ['cikis_muhru', 'cikis_muhur_no'])),
    tc_no: normalizeValue(getAny(map, ['tc_kimlik', 'tc_no', 'tc'])),
    phone: normalizeValue(getAny(map, ['telefon', 'phone'])),
    user_email: 'excel_import',
    created_at: createdAtDate.toISOString(),
    exit_at: exitAtDate ? exitAtDate.toISOString() : null,
  };
}

function parseArgs(argv) {
  const args = { inputPath: '', from: '2026-04-08', to: '2026-04-21', dryRun: false };
  const rest = [...argv];
  args.inputPath = rest.shift() || '';
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (item === '--dry-run') args.dryRun = true;
    else if (item === '--from') args.from = rest[++i];
    else if (item === '--to') args.to = rest[++i];
  }
  return args;
}

async function fetchExistingByCreatedAt(client, createdAt) {
  const { data, error } = await client
    .from('security_logs')
    .select('*')
    .eq('created_at', createdAt)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inputPath) throw new Error('Usage: node scripts/import-security-report-to-supabase.js <report.xlsx> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]');
  if (!fs.existsSync(args.inputPath)) throw new Error(`Input file not found: ${args.inputPath}`);

  const fromDate = new Date(`${args.from}T00:00:00`);
  const toDate = new Date(`${args.to}T23:59:59.999`);
  const rows = await readFirstWorksheetRows(args.inputPath);
  const mappedRows = rows
    .map(mapReportRow)
    .filter(Boolean)
    .filter((row) => {
      const createdAt = new Date(row.created_at);
      return createdAt >= fromDate && createdAt <= toDate;
    });

  const summary = {
    inputPath: args.inputPath,
    from: args.from,
    to: args.to,
    sourceRows: rows.length,
    mappedRows: mappedRows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    adjusted: 0,
    collisions: 0,
    dryRun: args.dryRun,
  };

  const byDate = {};
  const byCategory = {};
  mappedRows.forEach((row) => {
    const localDate = new Date(row.created_at).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
    byDate[localDate] = (byDate[localDate] || 0) + 1;
    byCategory[row.sub_category] = (byCategory[row.sub_category] || 0) + 1;
  });
  summary.byDate = byDate;
  summary.byCategory = byCategory;

  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const projectRoot = path.resolve(__dirname, '..');
  const env = loadEnv(path.join(projectRoot, '.env'));
  const supabaseUrl = (env.REACT_APP_SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEW_SUPABASE_URL || '').trim();
  const supabaseKey = (
    env.SUPABASE_SERVICE_ROLE_KEY
    || env.NEW_SERVICE_ROLE_KEY
    || env.REACT_APP_SUPABASE_ANON_KEY
    || env.VITE_SUPABASE_ANON_KEY
    || ''
  ).trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase URL or key in .env');
  if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.NEW_SERVICE_ROLE_KEY) {
    console.warn('Service-role key not found; using anon key. Import depends on current RLS policies.');
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const row of mappedRows) {
    let offsetMs = 0;
    let candidate = row;
    while (offsetMs < 1000) {
      candidate = {
        ...row,
        created_at: shiftIsoByMs(row.created_at, offsetMs),
        exit_at: shiftIsoByMs(row.exit_at, offsetMs),
      };
      const existing = await fetchExistingByCreatedAt(client, candidate.created_at);
      if (!existing || sameLogicalRecord(existing, candidate)) {
        const { error } = await client
          .from('security_logs')
          .upsert(candidate, { onConflict: 'created_at' });
        if (error) throw error;
        if (existing) summary.updated += 1;
        else summary.inserted += 1;
        if (offsetMs > 0) summary.adjusted += 1;
        break;
      }
      summary.collisions += 1;
      offsetMs += 1;
    }
    if (offsetMs >= 1000) summary.skipped += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
}

module.exports = {
  mapReportRow,
  normalizeHeader,
  parseLocalDate,
  parseTime,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
