import { fixMojibake } from './utils';
import { supabase } from '../supabaseClient';

export const CSV_LOG_FIELDS = [
  'event_type', 'type', 'sub_category', 'shift', 'plate', 'driver',
  'name', 'host', 'note', 'location', 'entry_location', 'exit_location',
  'seal_number', 'seal_number_entry', 'seal_number_exit',
  'tc_no', 'phone', 'user_email', 'created_at', 'exit_at'
];

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const CSV_HEADER_ALIASES = {
  event_type: ['event_type', 'eventtype', 'event_type_', 'islem_tipi', 'olay_tipi'],
  type: ['type', 'tip', 'kayit_tipi', 'kayit_turu'],
  sub_category: ['sub_category', 'subcategory', 'sub_category_', 'kategori', 'alt_kategori', 'kaynak', 'source'],
  shift: ['shift', 'vardiya'],
  plate: ['plate', 'plaka', 'arac_plaka', 'arac_plaka_veya_no'],
  driver: ['driver', 'surucu', 'sofor', 'surucu_kisi'],
  name: ['name', 'isim', 'ad_soyad', 'ziyaretci'],
  host: ['host', 'birim', 'departman', 'alan_1'],
  note: ['note', 'aciklama', 'alan_2', 'ek_bilgi', 'firma', 'firma_aciklama', 'detay'],
  location: ['location', 'lokasyon', 'konum'],
  entry_location: ['entry_location', 'giris_lokasyon', 'geldigi_lokasyon', 'nereden'],
  exit_location: ['exit_location', 'cikis_lokasyon', 'gidecegi_lokasyon', 'nereye'],
  seal_number: ['seal_number', 'muhur_no'],
  seal_number_entry: ['seal_number_entry', 'giris_muhur_no'],
  seal_number_exit: ['seal_number_exit', 'cikis_muhur_no'],
  tc_no: ['tc_no', 'tc', 'tckn'],
  phone: ['phone', 'telefon', 'tel'],
  user_email: ['user_email', 'email', 'eposta', 'e_posta'],
  created_at: ['created_at', 'createdat', 'giris_tarihi', 'giris_saati', 'giris', 'entry_at'],
  exit_at: ['exit_at', 'exitat', 'cikis_tarihi', 'cikis_saati', 'cikis', 'checkout_at']
};

const TR_DATE_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
const TR_DATETIME_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DATE_COLUMN_ALIASES = ['tarih', 'date', 'kayit_tarihi', 'log_tarihi'];
const DETAIL_COLUMN_ALIASES = ['detay', 'description', 'aciklama_detay'];
const LEGACY_COMPANY_DEPARTURE_ALIASES = ['cikis', 'cikis_saati'];
const LEGACY_COMPANY_RETURN_ALIASES = ['giris', 'giris_saati'];
const EXPLICIT_CREATED_AT_ALIASES = ['created_at', 'createdat', 'entry_at'];
const EXPLICIT_EXIT_AT_ALIASES = ['exit_at', 'exitat', 'checkout_at'];

const CATEGORY_LABELS = {
  staff: 'Personel Arac\u0131',
  guest: 'Misafir Ara\u00e7',
  sealed: 'M\u00fch\u00fcrl\u00fc Ara\u00e7',
  management: 'Y\u00f6netim Arac\u0131',
  company: '\u015eirket Arac\u0131'
};

const CATEGORY_KEY_MAP = new Map([
  ['b_yaka_arac', CATEGORY_LABELS.staff],
  ['beyaz_yaka_arac', CATEGORY_LABELS.staff],
  ['personel_araci', CATEGORY_LABELS.staff],
  ['personel_arac', CATEGORY_LABELS.staff],
  ['misafir_sivil_arac', CATEGORY_LABELS.guest],
  ['misafir_araci', CATEGORY_LABELS.guest],
  ['misafir_arac', CATEGORY_LABELS.guest],
  ['muhurlu_arac', CATEGORY_LABELS.sealed],
  ['muhurlu_araci', CATEGORY_LABELS.sealed],
  ['yonetim_arac', CATEGORY_LABELS.management],
  ['yonetim_araci', CATEGORY_LABELS.management],
  ['sirket_arac', CATEGORY_LABELS.company],
  ['sirket_araci', CATEGORY_LABELS.company]
]);

const buildSignature = (row = {}) => JSON.stringify(
  CSV_LOG_FIELDS.reduce((acc, key) => {
    if (key === 'created_at') return acc;
    const value = row[key];
    if (value === undefined || value === null) return acc;
    if (typeof value === 'string' && value.trim() === '') return acc;
    acc[key] = value;
    return acc;
  }, {})
);

const shiftIsoByMs = (value, offsetMs) => {
  if (!value || !offsetMs) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setMilliseconds(parsed.getMilliseconds() + offsetMs);
  return parsed.toISOString();
};

const shiftLogTimestamps = (row = {}, offsetMs = 0) => {
  if (!offsetMs) return row;
  return {
    ...row,
    created_at: shiftIsoByMs(row.created_at, offsetMs),
    exit_at: shiftIsoByMs(row.exit_at, offsetMs)
  };
};

export const normalizeCsvHeader = (value = '') => fixMojibake(String(value || ''))
  .replace(/\ufeff/g, '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/\u0131/g, 'i')
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

  const trDateMatch = v.match(TR_DATETIME_RE);
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

const isTimeOnlyValue = (value) => {
  if (value instanceof Date) {
    return value.getFullYear() <= 1900;
  }

  if (typeof value === 'number') {
    return value > 0 && value < 1;
  }

  const v = normalizeCsvValue(value);
  return !!v && TIME_ONLY_RE.test(v);
};

const parseDateParts = (value) => {
  if (value instanceof Date) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate()
    };
  }

  if (typeof value === 'number') {
    const iso = excelSerialToIso(value);
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
      year: parsed.getUTCFullYear(),
      month: parsed.getUTCMonth() + 1,
      day: parsed.getUTCDate()
    };
  }

  const v = normalizeCsvValue(value);
  if (!v) return null;

  const trMatch = v.match(TR_DATE_RE);
  if (trMatch) {
    return {
      day: Number(trMatch[1]),
      month: Number(trMatch[2]),
      year: Number(trMatch[3])
    };
  }

  const parsed = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate()
  };
};

const parseTimeParts = (value) => {
  if (value instanceof Date) {
    return {
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds()
    };
  }

  if (typeof value === 'number') {
    const iso = excelSerialToIso(value);
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
      hour: parsed.getUTCHours(),
      minute: parsed.getUTCMinutes(),
      second: parsed.getUTCSeconds()
    };
  }

  const v = normalizeCsvValue(value);
  if (!v) return null;

  const timeMatch = v.match(TIME_ONLY_RE);
  if (timeMatch) {
    return {
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2]),
      second: Number(timeMatch[3] || '0')
    };
  }

  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    hour: parsed.getHours(),
    minute: parsed.getMinutes(),
    second: parsed.getSeconds()
  };
};

const combineDateAndTime = (dateValue, timeValue) => {
  const direct = normalizeCsvDate(timeValue);
  if (direct && !isTimeOnlyValue(timeValue)) return direct;

  const dateParts = parseDateParts(dateValue);
  const timeParts = parseTimeParts(timeValue);
  if (!dateParts || !timeParts) return direct;

  const parsed = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    timeParts.second,
    0
  );
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeImportedType = (value) => {
  const raw = normalizeCsvValue(value);
  if (!raw) return null;
  const key = normalizeCsvHeader(raw);
  if (key.includes('vehicle') || key.includes('arac')) return 'vehicle';
  if (key.includes('visitor') || key.includes('ziyaret') || key.includes('misafir')) return 'visitor';
  return raw;
};

const looksLikePlate = (value = '') => {
  const text = fixMojibake(String(value || ''))
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(0[1-9]|[1-7][0-9]|8[01])\s?[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc]{1,3}\s?\d{2,4}$/.test(text);
};

const normalizeImportedCategory = (value) => {
  const raw = normalizeCsvValue(value);
  if (!raw) return null;

  const key = normalizeCsvHeader(raw);
  if (CATEGORY_KEY_MAP.has(key)) return CATEGORY_KEY_MAP.get(key);
  if (key.includes('muhur')) return CATEGORY_LABELS.sealed;
  if (key.includes('misafir') || key.includes('sivil')) return CATEGORY_LABELS.guest;
  if (key.includes('yonetim')) return CATEGORY_LABELS.management;
  if (key.includes('personel') || key.includes('b_yaka') || key.includes('beyaz_yaka')) return CATEGORY_LABELS.staff;
  if (key.includes('sirket') || looksLikePlate(raw)) return CATEGORY_LABELS.company;
  return raw;
};

const inferShiftFromCreatedAt = (createdAt) => {
  if (!createdAt) return null;
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const hour = parsed.getHours();
  if (hour >= 8 && hour < 16) return 'Vardiya 1 (08:00-16:00)';
  if (hour >= 16 && hour < 24) return 'Vardiya 2 (16:00-00:00)';
  return 'Vardiya 3 (00:00-08:00)';
};

const buildImportIssue = (severity, code, message) => ({ severity, code, message });

const getIsoTime = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const getChronologyIssueCode = (createdAt, exitAt) => {
  if (!exitAt) return null;
  const createdTime = getIsoTime(createdAt);
  const exitTime = getIsoTime(exitAt);
  if (createdTime === null || exitTime === null) return 'invalid_timestamp';
  if (exitTime < createdTime) return 'exit_before_entry';
  return null;
};

export const isMissingColumnError = (error, column) => {
  const msg = String(error?.message || error || '');
  const lower = msg.toLowerCase();
  if (!lower.includes('column')) return false;
  const target = String(column || '').toLowerCase();
  const quoted = new RegExp(`['"\`]${escapeRegex(target)}['"\`]`);
  if (quoted.test(lower)) return true;
  const exact = new RegExp(`(^|[^a-z0-9_])${escapeRegex(target)}([^a-z0-9_]|$)`);
  return exact.test(lower);
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

const getCsvValueByAliases = (normalizedKeyMap = {}, aliases = []) => {
  for (const alias of aliases) {
    const normalizedAlias = normalizeCsvHeader(alias);
    if (normalizedAlias && normalizedAlias in normalizedKeyMap) {
      return normalizedKeyMap[normalizedAlias];
    }
  }
  return undefined;
};

const hasCsvAlias = (normalizedKeyMap = {}, aliases = []) =>
  aliases.some((alias) => {
    const normalizedAlias = normalizeCsvHeader(alias);
    return !!normalizedAlias && Object.prototype.hasOwnProperty.call(normalizedKeyMap, normalizedAlias);
  });

const buildImportedNote = (normalizedKeyMap = {}, currentNote) => {
  const parts = [normalizeCsvValue(currentNote)];
  const detailValue = getCsvValueByAliases(normalizedKeyMap, DETAIL_COLUMN_ALIASES);
  const detail = normalizeCsvValue(detailValue);
  if (detail) parts.push(detail);

  const unique = [];
  parts.filter(Boolean).forEach((part) => {
    if (!unique.includes(part)) unique.push(part);
  });

  return unique.length > 0 ? unique.join(' | ') : null;
};

const resolveImportedDate = (normalizedKeyMap, rawDateValue) => {
  const direct = normalizeCsvDate(rawDateValue);
  if (direct && !isTimeOnlyValue(rawDateValue)) return direct;

  const dateColumnValue = getCsvValueByAliases(normalizedKeyMap, DATE_COLUMN_ALIASES);
  return combineDateAndTime(dateColumnValue, rawDateValue);
};

const isLegacyCompanyMovementRow = (normalizedKeyMap = {}, normalizedCategory) => {
  if (normalizedCategory !== CATEGORY_LABELS.company) return false;
  if (hasCsvAlias(normalizedKeyMap, EXPLICIT_CREATED_AT_ALIASES) || hasCsvAlias(normalizedKeyMap, EXPLICIT_EXIT_AT_ALIASES)) {
    return false;
  }
  return hasCsvAlias(normalizedKeyMap, LEGACY_COMPANY_DEPARTURE_ALIASES)
    || hasCsvAlias(normalizedKeyMap, LEGACY_COMPANY_RETURN_ALIASES);
};

const remapLegacyCompanyMovementTimes = (normalizedKeyMap = {}, out = {}) => {
  const departureAt = resolveImportedDate(
    normalizedKeyMap,
    getCsvValueByAliases(normalizedKeyMap, LEGACY_COMPANY_DEPARTURE_ALIASES)
  );
  const returnAt = resolveImportedDate(
    normalizedKeyMap,
    getCsvValueByAliases(normalizedKeyMap, LEGACY_COMPANY_RETURN_ALIASES)
  );

  return {
    ...out,
    created_at: departureAt || returnAt || out.created_at || out.exit_at || null,
    exit_at: departureAt && returnAt ? returnAt : null
  };
};

export const mapCsvRowToImportRecord = (row = {}) => {
  const normalizedKeyMap = {};
  Object.keys(row || {}).forEach((rawKey) => {
    const normalized = normalizeCsvHeader(rawKey);
    if (normalized) normalizedKeyMap[normalized] = row[rawKey];
  });

  const out = {};
  CSV_LOG_FIELDS.forEach((key) => {
    const rawValue = getCsvFieldValue(row, normalizedKeyMap, key);
    let value;
    if (key === 'created_at' || key === 'exit_at') {
      value = resolveImportedDate(normalizedKeyMap, rawValue);
    } else {
      value = normalizeCsvValue(rawValue);
    }

    if (value !== undefined) out[key] = value;
  });

  const normalizedType = normalizeImportedType(out.type);
  const normalizedCategory = normalizeImportedCategory(out.sub_category);
  const normalizedNote = buildImportedNote(normalizedKeyMap, out.note);
  const legacyCompanyRow = isLegacyCompanyMovementRow(normalizedKeyMap, normalizedCategory);
  const warnings = [];
  const errors = [];
  const rawLegacyDeparture = normalizeCsvValue(getCsvValueByAliases(normalizedKeyMap, LEGACY_COMPANY_DEPARTURE_ALIASES));
  const rawLegacyReturn = normalizeCsvValue(getCsvValueByAliases(normalizedKeyMap, LEGACY_COMPANY_RETURN_ALIASES));
  const rawExplicitCreatedAt = normalizeCsvValue(getCsvValueByAliases(normalizedKeyMap, EXPLICIT_CREATED_AT_ALIASES));
  const rawExplicitExitAt = normalizeCsvValue(getCsvValueByAliases(normalizedKeyMap, EXPLICIT_EXIT_AT_ALIASES));

  if (legacyCompanyRow) {
    Object.assign(out, remapLegacyCompanyMovementTimes(normalizedKeyMap, out));
  } else if (!out.created_at && out.exit_at) {
    errors.push(buildImportIssue('error', 'missing_entry_time', 'Giriş zamanı olmayan satır içe aktarılamadı.'));
  }

  if (normalizedType) {
    out.type = normalizedType;
  } else if (out.plate) {
    out.type = 'vehicle';
  } else if (out.name) {
    out.type = 'visitor';
  }

  if (normalizedCategory) out.sub_category = normalizedCategory;
  if (out.type === 'vehicle' && !out.driver && out.name) out.driver = out.name;
  if (!out.shift && out.created_at) out.shift = inferShiftFromCreatedAt(out.created_at);
  if (normalizedNote !== null) out.note = normalizedNote;

  if (legacyCompanyRow) {
    if (rawLegacyDeparture && !rawLegacyReturn) {
      warnings.push(buildImportIssue('warning', 'legacy_company_missing_return', 'Legacy şirket aracı satırında dönüş zamanı yok; kayıt açık olarak içe aktarılacak.'));
    } else if (!rawLegacyDeparture && rawLegacyReturn) {
      warnings.push(buildImportIssue('warning', 'legacy_company_missing_departure', 'Legacy şirket aracı satırında gidiş zamanı yok; kayıt açık olarak içe aktarılacak.'));
    }
  }

  if (!out.created_at) {
    errors.push(buildImportIssue('error', 'missing_created_at', 'Geçerli giriş zamanı bulunamadı.'));
  }

  if (!legacyCompanyRow && !rawExplicitCreatedAt && !rawLegacyReturn && (rawExplicitExitAt || rawLegacyDeparture)) {
    errors.push(buildImportIssue('error', 'missing_entry_time', 'Yalnızca çıkış zamanı olan satır tamamlanmış kayıt olarak içe aktarılamaz.'));
  }

  const chronologyIssue = getChronologyIssueCode(out.created_at, out.exit_at);
  if (chronologyIssue === 'exit_before_entry') {
    errors.push(buildImportIssue('error', 'exit_before_entry', 'Çıkış zamanı giriş zamanından önce olduğu için satır içe aktarılmadı.'));
  } else if (chronologyIssue === 'invalid_timestamp') {
    errors.push(buildImportIssue('error', 'invalid_timestamp', 'Giriş/çıkış tarihleri geçersiz olduğu için satır içe aktarılmadı.'));
  }

  const uniqueErrors = [];
  const seenErrorCodes = new Set();
  errors.forEach((item) => {
    if (seenErrorCodes.has(item.code)) return;
    seenErrorCodes.add(item.code);
    uniqueErrors.push(item);
  });

  return {
    log: uniqueErrors.length === 0 ? out : null,
    warnings,
    errors: uniqueErrors,
    meta: {
      legacyCompanyRow,
      normalizedCategory: normalizedCategory || null,
    },
  };
};

export const mapCsvRowToLog = (row = {}) => mapCsvRowToImportRecord(row).log;

export const scoreImportedLog = (row = {}) =>
  Object.values(row).reduce((acc, value) => (
    value !== null && value !== undefined && String(value).trim() !== '' ? acc + 1 : acc
  ), 0);

export const dedupeLogsByCreatedAt = (logs = []) => {
  const uniqueLogs = [];
  const indexByCreatedAt = new Map();
  let duplicateCount = 0;
  let adjustedCount = 0;

  logs.forEach((row) => {
    if (!row?.created_at) return;

    let offsetMs = 0;
    while (offsetMs < 1000) {
      const candidate = shiftLogTimestamps(row, offsetMs);
      const existingIndex = indexByCreatedAt.get(candidate.created_at);

      if (existingIndex === undefined) {
        uniqueLogs.push(candidate);
        indexByCreatedAt.set(candidate.created_at, uniqueLogs.length - 1);
        if (offsetMs > 0) adjustedCount += 1;
        return;
      }

      const existing = uniqueLogs[existingIndex];
      if (buildSignature(existing) === buildSignature(candidate)) {
        duplicateCount += 1;
        if (scoreImportedLog(candidate) >= scoreImportedLog(existing)) {
          uniqueLogs[existingIndex] = candidate;
        }
        return;
      }

      offsetMs += 1;
    }
  });

  return { uniqueLogs, duplicateCount, adjustedCount };
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
