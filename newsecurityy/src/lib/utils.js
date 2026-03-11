import { LONG_STAY_HOURS, DEFAULT_FEATURE_FLAGS, ROLE_SECURITY, ROLE_HR, ROLE_DEVELOPER } from './constants';
import { styles as _tokenStyles } from './tokens';

// --- CLASSNAME BİRLEŞTİRİCİ ---
export const cx = (...classes) => classes.filter(Boolean).join(' ');

// --- GÜVENLİK: INPUT SANİTİZASYON FONKSİYONU (XSS Koruması) ---
export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .slice(0, 500);
};

export const normalizeFeatureFlags = (raw = {}) => ({
  ...DEFAULT_FEATURE_FLAGS,
  ...(raw && typeof raw === 'object' ? raw : {}),
});

export const humanFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

export const simpleHash = (input = '') => {
  let hash = 5381;
  const str = String(input);
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash &= 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const upperTr = (value = '') => String(value).toLocaleUpperCase('tr-TR');
export const lowerTr = (value = '') => String(value).toLocaleLowerCase('tr-TR');

const MOJIBAKE_RE = /[\u00C2\u00C3\u00C4\u00C5\u00E2\uFFFD]|Ã„Å¸Ã…Â¸|ÃƒÂ¢Ã¢â€šÂ¬|ÃƒÆ'|Ãƒâ€|Ãƒâ€¦|Ãƒâ€š/;

export const fixMojibake = (input) => {
  if (typeof input !== 'string') return input;
  if (!MOJIBAKE_RE.test(input)) return input;
  if (typeof TextDecoder === 'undefined') return input;
  try {
    let output = input;
    for (let i = 0; i < 3; i += 1) {
      if (!MOJIBAKE_RE.test(output)) break;
      const bytes = Uint8Array.from(output, (ch) => ch.charCodeAt(0) & 0xff);
      const decoded = new TextDecoder('utf-8').decode(bytes);
      if (!decoded || decoded === output) break;
      output = decoded;
    }
    return Array.from(output)
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('');
  } catch (e) {
    return input;
  }
};

export const normalizeIdentifier = (value) => {
  if (!value) return '';
  return value
    .toString()
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Z\u00C7\u011E\u0130\u00D6\u015E\u00DC]/g, '');
};

export const isSameIdentifier = (a, b) => {
  const na = normalizeIdentifier(a);
  const nb = normalizeIdentifier(b);
  return !!na && !!nb && na === nb;
};

export const matchesByTab = (log, value, tab) => {
  if (!log || !value) return false;
  if (tab === 'vehicle') return isSameIdentifier(log.plate, value);
  return isSameIdentifier(log.name, value);
};

// --- VALIDASYON FONKSİYONLARI ---
export const isValidTC = (tc) => {
  if (!tc) return false;
  tc = String(tc).trim();
  if (tc.length !== 11 || tc[0] === '0') return false;
  if (!/^\d{11}$/.test(tc)) return false;
  const digits = tc.split('').map(Number);
  const sum1 = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const sum2 = digits[1] + digits[3] + digits[5] + digits[7];
  let check1 = (sum1 * 7 - sum2) % 10;
  if (check1 < 0) check1 += 10;
  const check2 = digits.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return check1 === digits[9] && check2 === digits[10];
};

export const formatPhone = (value) => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 6) return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
  if (cleaned.length <= 8) return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 8)} ${cleaned.slice(8, 10)}`;
};

export const formatForInput = (isoString) => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date - offset)).toISOString().slice(0, 16);
    return localISOTime;
  } catch (error) {
    return '';
  }
};

export const safeDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const toDateOnly = (value) => {
  const d = safeDate(value);
  return d ? d.toISOString().split('T')[0] : null;
};

export const calculateWaitTime = (createdAt) => {
  try {
    const now = new Date();
    const entry = new Date(createdAt);
    if (isNaN(entry.getTime())) return { hours: 0, mins: 0, totalMins: 0, isLongStay: false };
    const diffMs = Math.max(0, now - entry);
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return { hours, mins, totalMins: diffMins, isLongStay: hours >= LONG_STAY_HOURS };
  } catch (error) {
    return { hours: 0, mins: 0, totalMins: 0, isLongStay: false };
  }
};

export const getCategoryStyle = (cat) => {
  if (cat?.includes('Yönetim')) return 'border-yellow-500 text-yellow-400 bg-yellow-500/10';
  if (cat?.includes('Şirket')) return 'border-blue-500 text-blue-400 bg-blue-500/10';
  if (cat?.includes('Servis')) return 'border-purple-500 text-purple-400 bg-purple-500/10';
  if (cat?.includes('Mühür')) return 'border-red-500 text-red-400 bg-red-500/10';
  if (cat?.includes('Personel Aracı')) return 'border-cyan-500 text-cyan-400 bg-cyan-500/10';
  if (cat?.includes('Misafir Araç')) return 'border-green-500 text-green-400 bg-green-500/10';
  if (cat?.includes('Misafir')) return 'border-emerald-500 text-emerald-400 bg-emerald-500/10';
  if (cat?.includes('Fabrika')) return 'border-orange-500 text-orange-400 bg-orange-500/10';
  if (cat?.includes('İşten')) return 'border-rose-500 text-rose-400 bg-rose-500/10';
  return 'border-slate-600 text-slate-400';
};

export const getShortCategory = (cat) => {
  if (!cat) return 'Genel';
  return cat
    .replace(' (Giriş)', '')
    .replace(' (Çıkış)', '')
    .replace(' (Giriş)', '')
    .replace(' (Çıkış)', '')
    .replace(' Aracı', '')
    .replace(' Aracı', '');
};

// --- LOGIN ALIAS ---
export const normalizeLoginAlias = (value = '') => String(value)
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/\u0131/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_ ]+/g, '')
  .replace(/\s+/g, ' ');

const ROLE_USERNAME_ALIASES = {
  [ROLE_SECURITY]: new Set(['guvenlik personeli', 'guvenlik_personeli', 'security', 'guvenlik']),
  [ROLE_HR]: new Set(['insan kaynaklari', 'insan_kaynaklari', 'ik', 'hr']),
  [ROLE_DEVELOPER]: new Set(['gelistirici', 'developer']),
};

export const resolveRoleByAlias = (username = '') => {
  const key = normalizeLoginAlias(username);
  if (!key) return '';
  if (ROLE_USERNAME_ALIASES[ROLE_SECURITY].has(key)) return ROLE_SECURITY;
  if (ROLE_USERNAME_ALIASES[ROLE_HR].has(key)) return ROLE_HR;
  if (ROLE_USERNAME_ALIASES[ROLE_DEVELOPER].has(key)) return ROLE_DEVELOPER;
  return '';
};

export const buildFallbackSessionUser = (role) => {
  const ROLE_FALLBACK_USERS = {
    [ROLE_SECURITY]: { username: 'guvenlik_personeli', email: 'guvenlik@local' },
    [ROLE_HR]: { username: 'insan_kaynaklari', email: 'ik@local' },
    [ROLE_DEVELOPER]: { username: 'gelistirici', email: 'gelistirici@local' },
  };
  const fallback = ROLE_FALLBACK_USERS[role] || { username: 'local_user', email: 'local@offline' };
  return {
    id: `local-${role.toLowerCase()}`,
    username: fallback.username,
    email: fallback.email,
    is_superuser: role === ROLE_DEVELOPER,
    roles: [role],
    active_role: role,
  };
};

// --- ATTACHMENT UTILS ---
export const createAttachmentId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const normalizeAttachmentItem = (item = {}) => {
  const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl : '';
  if (!dataUrl.startsWith('data:')) return null;
  return {
    id: item.id || createAttachmentId(),
    name: String(item.name || 'attachment'),
    type: String(item.type || 'application/octet-stream'),
    size: Number(item.size || 0),
    dataUrl,
    addedAt: item.addedAt || new Date().toISOString()
  };
};

export const normalizeAttachmentMap = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  const next = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!key) return;
    if (!Array.isArray(value)) return;
    const normalized = value.map((x) => normalizeAttachmentItem(x)).filter(Boolean);
    if (normalized.length > 0) next[key] = normalized;
  });
  return next;
};

export const getLogAttachmentKey = (log) => {
  if (!log) return '';
  if (typeof log === 'string') return log;
  return String(log.created_at || log.id || '');
};

export const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Dosya okunamadi'));
  reader.readAsDataURL(file);
});

export const downloadDataUrl = (name, dataUrl) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// --- LOG LİSTESİ YARDIMCI FONKSİYONLARI ---
export const areObjectsEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
};

export const normalizeLogText = (log) => {
  if (!log) return null;
  const result = { ...log };
  ['plate', 'driver', 'name', 'host', 'location', 'entry_location', 'exit_location'].forEach((key) => {
    if (typeof result[key] === 'string') result[key] = result[key].trim();
  });
  return result;
};

export const normalizeLogList = (logs) =>
  (Array.isArray(logs) ? logs : []).map(normalizeLogText).filter(Boolean);

export const areLogListsEqual = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((log, i) => log === b[i]);
};

export const upsertLogInList = (list, log) => {
  if (!log) return list;
  const arr = Array.isArray(list) ? list : [];
  const idx = arr.findIndex((item) =>
    (log.id && item.id === log.id) || (log.created_at && item.created_at === log.created_at)
  );
  if (idx >= 0) {
    const updated = [...arr];
    updated[idx] = { ...arr[idx], ...log };
    return updated;
  }
  return [log, ...arr];
};

// --- CSV FALLBACK ---
export const needsPlainCsvFallback = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== 'object') return true;
  const keys = Object.keys(firstRow);
  return keys.length <= 1;
};

export const parseCsvTextLoose = (text) => {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[;,\t]/).map((h) => h.trim().replace(/^["']|["']$/g, ''));
  return lines.slice(1).map((line) => {
    const values = line.split(/[;,\t]/).map((v) => v.trim().replace(/^["']|["']$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  }).filter((row) => Object.values(row).some(Boolean));
};

// --- SUPABASE UYUMLU LOG ---
const SUPABASE_LOG_FIELDS = new Set([
  'id', 'event_type', 'type', 'sub_category', 'shift', 'plate', 'driver',
  'name', 'host', 'note', 'location', 'entry_location', 'exit_location',
  'seal_number', 'seal_number_entry', 'seal_number_exit', 'tc_no', 'phone',
  'user_email', 'created_at', 'exit_at',
]);

export const pickSupabaseCompatibleLog = (log) => {
  if (!log || typeof log !== 'object') return {};
  const result = {};
  Object.keys(log).forEach((key) => {
    if (SUPABASE_LOG_FIELDS.has(key) && log[key] !== undefined) {
      result[key] = log[key];
    }
  });
  return result;
};

// --- STİL SABİTLERİ (tokens.js ile senkronize) ---
export const inputClass = _tokenStyles.input;
export const labelClass = _tokenStyles.label;

// --- LOKASYON YARDIMCI FONKSİYONLARI ---
export const getEntryLocation = (log) => log?.entry_location || '';
export const getExitLocation = (log) => log?.exit_location || '';

export const buildLegacyLocationValue = (entry, exit) => {
  const e = (entry || '').trim();
  const x = (exit || '').trim();
  if (e && x) return `${e} | ${x}`;
  return e || x || '';
};

export const formatLogLocation = (log) => {
  if (!log) return '';
  const entry = getEntryLocation(log);
  const exit = getExitLocation(log);
  if (entry || exit) return buildLegacyLocationValue(entry, exit);
  return log.location || '';
};
