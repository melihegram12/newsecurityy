import { fixMojibake } from './utils';
import { supabase } from '../supabaseClient';

export const CSV_LOG_FIELDS = [
  'event_type', 'type', 'sub_category', 'shift', 'plate', 'driver',
  'name', 'host', 'note', 'location', 'entry_location', 'exit_location',
  'seal_number', 'seal_number_entry', 'seal_number_exit',
  'tc_no', 'phone', 'user_email', 'created_at', 'exit_at'
];

export const CSV_HEADER_ALIASES = {
  event_type: ['event_type', 'eventtype', 'event_type_', 'islem_tipi', 'olay_tipi'],
  type: ['type', 'tip', 'kayit_tipi', 'kayıt_tipi'],
  sub_category: ['sub_category', 'subcategory', 'sub_category_', 'kategori', 'alt_kategori'],
  shift: ['shift', 'vardiya'],
  plate: ['plate', 'plaka', 'arac_plaka', 'araç_plaka', 'arac_plaka_veya_no'],
  driver: ['driver', 'surucu', 'sürücü', 'sofor', 'şoför', 'surucu_kisi'],
  name: ['name', 'isim', 'ad_soyad', 'ziyaretci', 'ziyaretçi'],
  host: ['host', 'birim', 'departman', 'alan_1'],
  note: ['note', 'aciklama', 'açıklama', 'alan_2', 'ek_bilgi'],
  location: ['location', 'lokasyon', 'konum'],
  entry_location: ['entry_location', 'giris_lokasyon', 'giriş_lokasyon', 'geldigi_lokasyon', 'geldiği_lokasyon', 'nereden'],
  exit_location: ['exit_location', 'cikis_lokasyon', 'çıkış_lokasyon', 'gidecegi_lokasyon', 'gideceği_lokasyon', 'nereye'],
  seal_number: ['seal_number', 'muhur_no', 'mühür_no'],
  seal_number_entry: ['seal_number_entry', 'giris_muhur_no', 'giriş_mühür_no'],
  seal_number_exit: ['seal_number_exit', 'cikis_muhur_no', 'çıkış_mühür_no'],
  tc_no: ['tc_no', 'tc', 'tckn'],
  phone: ['phone', 'telefon', 'tel'],
  user_email: ['user_email', 'email', 'eposta', 'e_posta'],
  created_at: ['created_at', 'createdat', 'giris_tarihi', 'giriş_tarihi', 'giris_saati', 'entry_at'],
  exit_at: ['exit_at', 'exitat', 'cikis_tarihi', 'çıkış_tarihi', 'cikis_saati', 'checkout_at']
};

export const normalizeCsvHeader = (value = '') => fixMojibake(String(value || ''))
  .replace(/\ufeff/g, '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const normalizeCsvValue = (value) => {
  if (value === undefined || value === null) return null;
  const v = fixMojibake(String(value).trim());
  if (!v || ['null', 'none', 'nan'].includes(v.toLowerCase())) return null;
  return v;
};

export const excelSerialToIso = (n) => {
  if (!Number.isFinite(n)) return null;
  const millis = Math.round((n - 25569) * 86400 * 1000);
  return new Date(millis).toISOString();
};

export const normalizeCsvDate = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return excelSerialToIso(value);
  const v = normalizeCsvValue(value);
  if (!v) return null;

  const trDateMatch = v.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (trDateMatch) {
    const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = trDateMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss), 0);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  let s = v;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
};

export const isMissingColumnError = (error, column) => {
  const msg = String(error?.message || error || '');
  return msg.toLowerCase().includes('column') && msg.toLowerCase().includes(column.toLowerCase());
};

const getCsvFieldValue = (row = {}, normalizedKeyMap = {}, key) => {
  if (row?.[key] !== undefined) return row[key];
  const aliases = CSV_HEADER_ALIASES[key] || [key];
  for (const alias of aliases) {
    const normalizedAlias = normalizeCsvHeader(alias);
    if (normalizedAlias && normalizedAlias in normalizedKeyMap) {
      return normalizedKeyMap[normalizedAlias];
    }
  }
  return undefined;
};

export const mapCsvRowToLog = (row = {}) => {
  const normalizedKeyMap = {};
  Object.keys(row || {}).forEach((rawKey) => {
    const normalized = normalizeCsvHeader(rawKey);
    if (normalized) normalizedKeyMap[normalized] = row[rawKey];
  });

  const out = {};
  CSV_LOG_FIELDS.forEach((key) => {
    let value = getCsvFieldValue(row, normalizedKeyMap, key);
    if (key === 'created_at' || key === 'exit_at') {
      value = normalizeCsvDate(value);
    } else {
      value = normalizeCsvValue(value);
    }
    if (value !== undefined) out[key] = value;
  });
  return out;
};

export const scoreImportedLog = (row = {}) =>
  Object.values(row).reduce((acc, value) => (
    value !== null && value !== undefined && String(value).trim() !== '' ? acc + 1 : acc
  ), 0);

export const dedupeLogsByCreatedAt = (logs = []) => {
  const map = new Map();
  let duplicateCount = 0;
  logs.forEach((row) => {
    const createdAt = row?.created_at;
    if (!createdAt) return;
    const existing = map.get(createdAt);
    if (!existing) {
      map.set(createdAt, row);
      return;
    }
    duplicateCount += 1;
    if (scoreImportedLog(row) >= scoreImportedLog(existing)) {
      map.set(createdAt, row);
    }
  });
  return { uniqueLogs: Array.from(map.values()), duplicateCount };
};

export const trySupabaseUpsertChunk = async (chunk) => {
  let { error } = await supabase
    .from('security_logs')
    .upsert(chunk, { onConflict: 'created_at' });

  if (error && isMissingColumnError(error, 'event_type')) {
    const cleaned = chunk.map(({ event_type: _drop, ...rest }) => rest);
    ({ error } = await supabase
      .from('security_logs')
      .upsert(cleaned, { onConflict: 'created_at' }));
  }

  return error || null;
};

export const upsertChunkWithRetry = async (chunk) => {
  if (!Array.isArray(chunk) || chunk.length === 0) {
    return { successRows: [], errorRows: [], lastError: '' };
  }

  const error = await trySupabaseUpsertChunk(chunk);
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
  const left = await upsertChunkWithRetry(chunk.slice(0, mid));
  const right = await upsertChunkWithRetry(chunk.slice(mid));
  return {
    successRows: [...left.successRows, ...right.successRows],
    errorRows: [...left.errorRows, ...right.errorRows],
    lastError: right.lastError || left.lastError || (error?.message || String(error))
  };
};
