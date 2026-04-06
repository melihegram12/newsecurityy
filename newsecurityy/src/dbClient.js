// Electron veya Web ortamını tespit et ve uygun API'yi kullan
import { getChronologyIssue } from './lib/utils';
import { supabase } from './supabaseClient';

const isElectron = typeof window !== 'undefined' && window.electronAPI;
const isMobile = typeof window !== 'undefined' && !!window.Capacitor && !isElectron;

// Supabase senkronizasyon kuyruğu için key
const SYNC_QUEUE_KEY = 'supabase_sync_queue';
const SYNC_STATUS_KEY = 'supabase_sync_status';
const LOCAL_SYNC_STATUS_KEY = 'local_sync_status';
const LOCAL_SYNC_QUEUE_KEY = 'local_sync_queue';
const LOCAL_API_URL_KEY = 'local_api_url';
const LOCAL_API_KEY_KEY = 'local_api_key';
const LOCAL_SYNC_ENABLED = String(
    process.env.REACT_APP_LOCAL_SYNC_ENABLED ||
    process.env.VITE_LOCAL_SYNC_ENABLED ||
    ''
).toLowerCase() === 'true';
const FORCE_LITE_PROFILE = String(process.env.REACT_APP_FORCE_LITE || '').toLowerCase() === 'true';
const LOCAL_PULL_DAYS = 30;
const LOCAL_PULL_LIMIT = 5000;
const LOCAL_PULL_INTERVAL_MS = FORCE_LITE_PROFILE ? 60000 : 30000;
const ELECTRON_SUPABASE_PULL_INTERVAL_MS = FORCE_LITE_PROFILE ? 60000 : 30000;

const normalizeApiBase = (value) => {
    if (!value) return '';
    return value.replace(/\/+$/, '');
};

const getLocalApiBase = () => {
    if (!LOCAL_SYNC_ENABLED) return '';
    const fallback = normalizeApiBase(
        process.env.REACT_APP_LOCAL_API_URL ||
        process.env.VITE_LOCAL_API_URL ||
        ''
    );

    if (typeof window === 'undefined') return fallback;
    try {
        const saved = localStorage.getItem(LOCAL_API_URL_KEY);
        if (saved !== null) return normalizeApiBase(saved);
    } catch (e) {
        // ignore
    }
    return fallback;
};

const getLocalApiKey = () => {
    const fallback =
        process.env.REACT_APP_LOCAL_API_KEY ||
        process.env.VITE_LOCAL_API_KEY ||
        '';

    if (typeof window === 'undefined') return fallback;
    try {
        const saved = localStorage.getItem(LOCAL_API_KEY_KEY);
        if (saved !== null) return saved;
    } catch (e) {
        // ignore
    }
    return fallback;
};

const buildLocalApiHeaders = (extra = {}) => {
    const headers = { ...extra };
    const apiKey = getLocalApiKey();
    if (apiKey) headers['X-Api-Key'] = apiKey;
    return headers;
};

const extractApiErrorMessage = (payload, statusCode) => {
    if (payload?.detail) return String(payload.detail);
    if (payload?.error) return String(payload.error);
    if (typeof payload === 'string' && payload.trim()) return payload.trim();

    if (payload && typeof payload === 'object') {
        const entries = Object.entries(payload);
        if (entries.length > 0) {
            const [field, value] = entries[0];
            if (Array.isArray(value) && value.length > 0) {
                return `${field}: ${String(value[0])}`;
            }
            if (typeof value === 'string') {
                return `${field}: ${value}`;
            }
        }
        try {
            return JSON.stringify(payload);
        } catch (e) {
            // ignore
        }
    }

    return `HTTP ${statusCode}`;
};

async function fetchLocalApi(path, options = {}) {
    const baseUrl = getLocalApiBase();
    if (!baseUrl) {
        throw new Error('Local API URL bulunamadi');
    }
    const endpoint = String(path || '').replace(/^\//, '');
    const url = `${baseUrl}/${endpoint}`;
    const opts = {
        ...options,
        headers: buildLocalApiHeaders(options.headers || {})
    };
    if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const contentType = res.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
        const message = extractApiErrorMessage(payload, res.status);
        throw new Error(message);
    }
    return payload;
}

function readSyncStatus() {
    try {
        return JSON.parse(localStorage.getItem(SYNC_STATUS_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function writeSyncStatus(patch) {
    try {
        const current = readSyncStatus();
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(next));
    } catch (e) {
        console.error('Sync status error:', e);
    }
}

function readLocalSyncStatus() {
    try {
        return JSON.parse(localStorage.getItem(LOCAL_SYNC_STATUS_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function writeLocalSyncStatus(patch) {
    try {
        const current = readLocalSyncStatus();
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        localStorage.setItem(LOCAL_SYNC_STATUS_KEY, JSON.stringify(next));
    } catch (e) {
        console.error('Local sync status error:', e);
    }
}

function updateQueueCount() {
    try {
        const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
        writeSyncStatus({ queueCount: queue.length });
    } catch (e) {
        // ignore
    }
}

function updateLocalQueueCount() {
    try {
        const queue = JSON.parse(localStorage.getItem(LOCAL_SYNC_QUEUE_KEY) || '[]');
        writeLocalSyncStatus({ queueCount: queue.length });
    } catch (e) {
        // ignore
    }
}

// Supabase pull settings (electron)
const PULL_LOOKBACK_DAYS = 3650;
const DELTA_SYNC_BOOTSTRAP_DAYS = 7;
let supabasePullInProgress = false;
let localPullInProgress = false;

const shouldSyncToSupabase = () => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
        return false;
    }
    return true;
};

const normalizeText = (value = '') => {
    return value
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i');
};

const LOCAL_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const normalizeIsoDate = (value) => {
    if (!value) return value;
    const str = String(value).trim();
    const match = LOCAL_DATE_RE.exec(str);
    let dt = null;

    if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        const second = Number(match[6] || '0');
        dt = new Date(year, month - 1, day, hour, minute, second);
    } else {
        const parsed = new Date(str);
        if (!Number.isNaN(parsed.getTime())) {
            dt = parsed;
        }
    }

    if (!dt || Number.isNaN(dt.getTime())) return str;
    return dt.toISOString();
};

const getChronologyErrorMessage = (issue) => {
    if (issue === 'invalid_timestamp') return 'Giriş veya çıkış zamanı geçersiz.';
    if (issue === 'exit_before_entry') return 'Çıkış saati giriş saatinden önce olamaz.';
    return 'Kayıt kronolojisi geçersiz.';
};

const validateChronology = ({ created_at, exit_at } = {}, fallbackCreatedAt = null, fallbackExitAt = undefined) => {
    const effectiveCreatedAt = created_at ?? fallbackCreatedAt;
    const effectiveExitAt = exit_at !== undefined ? exit_at : fallbackExitAt;
    const issue = getChronologyIssue(effectiveCreatedAt, effectiveExitAt);
    return {
        issue,
        createdAt: effectiveCreatedAt,
        exitAt: effectiveExitAt,
        message: issue ? getChronologyErrorMessage(issue) : null
    };
};

const buildChronologySkipResult = (action, issue, data, writeStatus) => {
    const message = getChronologyErrorMessage(issue);
    console.warn(`[sync.${action}] chronology anomaly skipped:`, issue, data?.plate || data?.name || data?.created_at || '-');
    if (typeof writeStatus === 'function') {
        writeStatus({
            lastPushAt: new Date().toISOString(),
            lastPushAction: action,
            lastPushStatus: 'skipped',
            lastPushError: message
        });
    }
    const error = new Error(message);
    error.code = issue;
    return { ok: false, skipped: true, invalidChronology: true, error };
};

const SUPABASE_LOG_FIELDS = new Set([
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

const pickSupabaseLogFields = (input = {}) => {
    const out = {};
    Object.keys(input || {}).forEach((key) => {
        if (!SUPABASE_LOG_FIELDS.has(key)) return;
        let value = input[key];
        if (value !== undefined) {
            if (key === 'created_at' || key === 'exit_at') {
                value = normalizeIsoDate(value);
            }
            out[key] = value;
        }
    });
    return out;
};

const isMissingColumnError = (error, column) => {
    const msg = String(error?.message || error || '');
    const lower = msg.toLowerCase();
    if (!lower.includes('column')) return false;
    const escaped = String(column || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`['"\`]${escaped}['"\`]`).test(lower)) return true;
    return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`).test(lower);
};

const isOnConflictConstraintError = (error) => {
    const msg = String(error?.message || error || '').toLowerCase();
    return msg.includes('on conflict') && (msg.includes('constraint') || msg.includes('unique') || msg.includes('exclusion'));
};

const buildCreatedAtIntegrityError = (operation, error) => {
    const detail = error?.message || String(error || '');
    const nextError = new Error(
        `Supabase security_logs.created_at unique korumasi eksik veya bozuk. ${operation} guvenli sekilde tamamlanmadi. ${detail}`
    );
    nextError.code = 'CREATED_AT_INTEGRITY_REQUIRED';
    nextError.cause = error;
    return nextError;
};

const dropUnsupportedSupabaseColumns = (payload = {}, error) => {
    const nextPayload = { ...payload };
    const keys = Object.keys(nextPayload);
    const missingColumns = keys.filter((column) => isMissingColumnError(error, column));
    if (missingColumns.length === 0) return null;
    missingColumns.forEach((column) => {
        delete nextPayload[column];
    });
    return nextPayload;
};

function resolveQueueLocalId(data, localId = null) {
    if (localId !== undefined && localId !== null && localId !== '') {
        return String(localId);
    }
    const createdAt = normalizeIsoDate(data?.created_at);
    return createdAt ? String(createdAt) : '';
}

function queueLogAction(queue, action, data, localId = null) {
    const resolvedLocalId = resolveQueueLocalId(data, localId);
    const nextItem = {
        action,
        data,
        localId: resolvedLocalId || localId,
        timestamp: Date.now()
    };

    // INSERT için created_at bazlı tek kayıt tut.
    if (action === 'INSERT' && resolvedLocalId) {
        const existingIndex = queue.findIndex((item) => (
            (item?.action || 'INSERT') === 'INSERT'
            && resolveQueueLocalId(item?.data, item?.localId) === resolvedLocalId
        ));
        if (existingIndex >= 0) {
            queue[existingIndex] = { ...queue[existingIndex], ...nextItem, retries: 0 };
            return queue;
        }
    }

    queue.push(nextItem);
    return queue;
}

// Senkronizasyon kuyruğuna ekle
function addToSyncQueue(action, data, localId = null) {
    try {
        const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
        queueLogAction(queue, action, data, localId);
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
        updateQueueCount();
    } catch (e) {
        console.error('Sync queue error:', e);
    }
}

function addToLocalSyncQueue(action, data, localId = null) {
    try {
        const queue = JSON.parse(localStorage.getItem(LOCAL_SYNC_QUEUE_KEY) || '[]');
        queueLogAction(queue, action, data, localId);
        localStorage.setItem(LOCAL_SYNC_QUEUE_KEY, JSON.stringify(queue));
        updateLocalQueueCount();
    } catch (e) {
        console.error('Local sync queue error:', e);
    }
}

// Supabase'e senkronize et (arka planda)
async function syncToSupabase(action, data, localId = null, options = {}) {
    if (!shouldSyncToSupabase()) {
        return { ok: false, skipped: true };
    }

    const { fromQueue = false } = options;
    const shouldQueueOnFailure = !fromQueue;
    const now = new Date().toISOString();
    writeSyncStatus({ lastPushAt: now, lastPushAction: action, lastPushStatus: 'attempt' });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
        writeSyncStatus({ lastPushAt: now, lastPushAction: action, lastPushStatus: 'queued' });
        return { ok: false, offline: true };
    }

    console.log(`🔄 Supabase sync başlatılıyor: ${action}`, data);
    try {
        if (action === 'INSERT') {
            // id'yi kaldır, Supabase kendi id'sini oluşturacak
            const { id, ...insertData } = data;
            const payload = pickSupabaseLogFields(insertData || {});
            if (!payload.created_at) {
                const error = new Error('INSERT için created_at gerekli');
                if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: error.message });
                return { ok: false, error };
            }
            const chronology = validateChronology(payload);
            if (chronology.issue) {
                return buildChronologySkipResult(action, chronology.issue, payload, writeSyncStatus);
            }
            console.log('📦 Supabase INSERT payload:', payload);

            const writeInsertPayload = async (insertPayload) => {
                const response = await supabase
                    .from('security_logs')
                    .upsert([insertPayload], { onConflict: 'created_at' })
                    .select();

                if (response.error && isOnConflictConstraintError(response.error)) {
                    return {
                        data: null,
                        error: buildCreatedAtIntegrityError('INSERT', response.error)
                    };
                }
                return response;
            };

            let workingPayload = payload;
            let { data: result, error } = await writeInsertPayload(workingPayload);
            while (error) {
                const insertFallbackPayload = dropUnsupportedSupabaseColumns(workingPayload, error);
                if (!insertFallbackPayload) break;
                workingPayload = insertFallbackPayload;
                ({ data: result, error } = await writeInsertPayload(workingPayload));
            }
            if (error) {
                console.error('❌ Supabase insert error:', error.message, error.code, error.details);
                console.error('❌ Hata detayları:', JSON.stringify(error, null, 2));
                // RLS hatası kontrolü
                if (error.code === '42501' || error.message.includes('policy')) {
                    console.error('🚫 RLS HATASI: Supabase Dashboard\'da security_logs tablosu için RLS politikası eklemeniz gerekiyor!');
                    try {
                        window.dispatchEvent(new CustomEvent('supabase-rls-error', {
                            detail: { action, message: 'Supabase izin hatası (RLS). Yönetici ile iletişime geçin.' }
                        }));
                    } catch (_) { /* ignore */ }
                }
                if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: error.message || String(error) });
                return { ok: false, error };
            }
            console.log('✅ Supabase sync: INSERT başarılı', result);
            writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'ok', lastPushError: null });
            return { ok: true };
        }

        if (action === 'UPDATE') {
            // Supabase'de created_at ile eşleşen kaydı bul ve güncelle
            const matchCreatedAt = normalizeIsoDate(data?.created_at || localId);
            const payload = pickSupabaseLogFields(data || {});
            delete payload.created_at;

            if (!matchCreatedAt) {
                const error = new Error('UPDATE için created_at gerekli');
                if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: error.message });
                return { ok: false, error };
            }

            if (Object.keys(payload).length === 0) {
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'ok', lastPushError: null });
                return { ok: true, skipped: true };
            }
            const chronology = validateChronology(payload, matchCreatedAt);
            if (chronology.issue) {
                return buildChronologySkipResult(action, chronology.issue, { ...payload, created_at: matchCreatedAt }, writeSyncStatus);
            }

            let workingPayload = payload;
            let error = null;

            while (true) {
                const response = await supabase
                    .from('security_logs')
                    .update(workingPayload)
                    .eq('created_at', matchCreatedAt);
                error = response?.error || null;
                if (!error) break;
                console.error('Supabase update error:', error);

                const retryPayload = dropUnsupportedSupabaseColumns(workingPayload, error);
                if (!retryPayload) break;
                workingPayload = retryPayload;
            }

            if (error) {
                if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: error.message || String(error) });
                return { ok: false, error };
            }
            console.log('✅ Supabase sync: UPDATE başarılı');
            writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'ok', lastPushError: null });
            return { ok: true };
        }

        if (action === 'DELETE') {
            const matchCreatedAt = normalizeIsoDate(localId || data?.created_at);
            if (!matchCreatedAt) {
                const error = new Error('DELETE için created_at gerekli');
                if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: error.message });
                return { ok: false, error };
            }
            const { error } = await supabase
                .from('security_logs')
                .delete()
                .eq('created_at', matchCreatedAt);
            if (error) {
                console.error('Supabase delete error:', error);
                if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: error.message || String(error) });
                return { ok: false, error };
            }
            console.log('✅ Supabase sync: DELETE başarılı');
            writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'ok', lastPushError: null });
            return { ok: true };
        }

        if (action === 'EXIT') {
            // Çıkış işlemi için - plate veya name ile ara
            const matchCreatedAt = normalizeIsoDate(localId || data?.created_at || data?.extraData?.created_at);
            const updateData = pickSupabaseLogFields({ ...(data?.extraData || {}), exit_at: data?.exit_at });
            delete updateData.created_at;
            const chronology = validateChronology(updateData, matchCreatedAt);
            if (chronology.issue) {
                return buildChronologySkipResult(action, chronology.issue, { ...updateData, created_at: matchCreatedAt }, writeSyncStatus);
            }

            let workingPayload = updateData;
            let error = null;

            while (true) {
                let query = supabase.from('security_logs').update(workingPayload);
                if (matchCreatedAt) {
                    query = query.eq('created_at', matchCreatedAt);
                } else {
                    query = query.is('exit_at', null);
                    if (data.plate) {
                        query = query.eq('plate', data.plate);
                    } else if (data.name) {
                        query = query.eq('name', data.name);
                    }
                }

                const response = await query;
                error = response?.error || null;
                if (!error) break;
                console.error('Supabase exit error:', error);

                const retryPayload = dropUnsupportedSupabaseColumns(workingPayload, error);
                if (!retryPayload) break;
                workingPayload = retryPayload;
            }

            if (error) {
                if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
                writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: error.message || String(error) });
                return { ok: false, error };
            }
            console.log('✅ Supabase sync: EXIT başarılı');
            writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'ok', lastPushError: null });
            return { ok: true };
        }

        return { ok: false };
    } catch (e) {
        console.error('Supabase sync exception:', e);
        if (shouldQueueOnFailure) addToSyncQueue(action, data, localId);
        writeSyncStatus({ lastPushAt: new Date().toISOString(), lastPushAction: action, lastPushStatus: 'error', lastPushError: e?.message || String(e) });
        return { ok: false, error: e };
    }
}

const shouldSyncToLocalApi = () => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
        return false;
    }
    if (!LOCAL_SYNC_ENABLED) return false;
    if (!getLocalApiBase()) return false;
    return true;
};

async function syncToLocalApi(action, data, localId = null, options = {}) {
    if (!shouldSyncToLocalApi()) {
        return { ok: false, skipped: true };
    }

    const { fromQueue = false } = options;
    const shouldQueueOnFailure = !fromQueue;
    const now = new Date().toISOString();
    writeLocalSyncStatus({ lastPushAt: now, lastPushAction: action, lastPushStatus: 'attempt' });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (shouldQueueOnFailure) addToLocalSyncQueue(action, data, localId);
        writeLocalSyncStatus({ lastPushAt: now, lastPushAction: action, lastPushStatus: 'queued' });
        return { ok: false, offline: true };
    }

    try {
        const baseUrl = getLocalApiBase();
        const requestBody = { action };
        let chronology = null;
        if (action === 'INSERT') {
            chronology = validateChronology(data || {});
        } else if (action === 'UPDATE') {
            chronology = validateChronology(data || {}, normalizeIsoDate(data?.created_at || localId));
        } else if (action === 'EXIT') {
            chronology = validateChronology(
                { ...(data?.extraData || {}), exit_at: data?.exit_at },
                normalizeIsoDate(localId || data?.created_at || data?.extraData?.created_at)
            );
        }
        if (chronology?.issue) {
            const message = chronology.message || getChronologyErrorMessage(chronology.issue);
            console.warn(`[local-sync.${action}] chronology anomaly skipped:`, chronology.issue, data?.plate || data?.name || data?.created_at || '-');
            writeLocalSyncStatus({
                lastPushAt: new Date().toISOString(),
                lastPushAction: action,
                lastPushStatus: 'skipped',
                lastPushError: message
            });
            const error = new Error(message);
            error.code = chronology.issue;
            return { ok: false, skipped: true, invalidChronology: true, error };
        }
        if (data !== undefined && data !== null) requestBody.data = data;
        if (localId !== undefined && localId !== null && localId !== '') requestBody.local_id = localId;
        const res = await fetch(`${baseUrl}/logs/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildLocalApiHeaders()
            },
            body: JSON.stringify(requestBody)
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok) {
            const message = extractApiErrorMessage(payload, res.status);
            console.error('Local API sync error:', message, payload);
            if (shouldQueueOnFailure) addToLocalSyncQueue(action, data, localId);
            writeLocalSyncStatus({
                lastPushAt: new Date().toISOString(),
                lastPushAction: action,
                lastPushStatus: 'error',
                lastPushError: message
            });
            return { ok: false, error: message };
        }

        writeLocalSyncStatus({
            lastPushAt: new Date().toISOString(),
            lastPushAction: action,
            lastPushStatus: 'ok',
            lastPushError: null
        });
        return { ok: true, data: payload };
    } catch (e) {
        console.error('Local API sync exception:', e);
        if (shouldQueueOnFailure) addToLocalSyncQueue(action, data, localId);
        writeLocalSyncStatus({
            lastPushAt: new Date().toISOString(),
            lastPushAction: action,
            lastPushStatus: 'error',
            lastPushError: e?.message || String(e)
        });
        return { ok: false, error: e };
    }
}

// Bekleyen senkronizasyonları işle
const MAX_SYNC_RETRIES = 5;

function notifyDroppedItem(item, target) {
    console.warn(`Sync item dropped after ${MAX_SYNC_RETRIES} retries [${target}]:`, item?.action, item?.data?.created_at || item?.localId);
    try {
        window.dispatchEvent(new CustomEvent('sync-item-dropped', {
            detail: { action: item?.action, localId: item?.localId, target, retries: item?.retries }
        }));
    } catch (_) { /* ignore */ }
}

function notifyInvalidChronologyItem(item, target, message) {
    console.warn(`Sync item dropped due to invalid chronology [${target}]:`, item?.action, item?.data?.created_at || item?.localId, message || '');
    try {
        window.dispatchEvent(new CustomEvent('sync-item-dropped', {
            detail: { action: item?.action, localId: item?.localId, target, reason: 'invalid_chronology' }
        }));
    } catch (_) { /* ignore */ }
}

async function processSyncQueue() {
    try {
        if (!shouldSyncToSupabase()) return;
        const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
        writeSyncStatus({ queueCount: queue.length });
        if (queue.length === 0) return;

        const newQueue = [];
        for (const item of queue) {
            const retries = (item.retries || 0);
            try {
                const result = await syncToSupabase(item.action, item.data, item.localId, { fromQueue: true });
                if (!result?.ok) {
                    if (result?.offline) {
                        newQueue.push(item);
                        continue;
                    }
                    if (result?.invalidChronology) {
                        notifyInvalidChronologyItem(item, 'supabase', result?.error?.message || null);
                        continue;
                    }
                    if (retries + 1 < MAX_SYNC_RETRIES) {
                        newQueue.push({ ...item, retries: retries + 1 });
                    } else {
                        notifyDroppedItem(item, 'supabase');
                    }
                }
            } catch (e) {
                if (retries + 1 < MAX_SYNC_RETRIES) {
                    newQueue.push({ ...item, retries: retries + 1 });
                } else {
                    notifyDroppedItem(item, 'supabase');
                }
            }
        }
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(newQueue));
        writeSyncStatus({ queueCount: newQueue.length });
    } catch (e) {
        console.error('Process sync queue error:', e);
    }
}

async function processLocalSyncQueue() {
    try {
        if (!shouldSyncToLocalApi()) return;
        const queue = JSON.parse(localStorage.getItem(LOCAL_SYNC_QUEUE_KEY) || '[]');
        writeLocalSyncStatus({ queueCount: queue.length });
        if (queue.length === 0) return;

        const newQueue = [];
        for (const item of queue) {
            const retries = (item.retries || 0);
            try {
                const result = await syncToLocalApi(item.action, item.data, item.localId, { fromQueue: true });
                if (!result?.ok) {
                    if (result?.offline) {
                        newQueue.push(item);
                        continue;
                    }
                    if (result?.invalidChronology) {
                        notifyInvalidChronologyItem(item, 'localApi', result?.error?.message || null);
                        continue;
                    }
                    if (retries + 1 < MAX_SYNC_RETRIES) {
                        newQueue.push({ ...item, retries: retries + 1 });
                    } else {
                        notifyDroppedItem(item, 'localApi');
                    }
                }
            } catch (e) {
                if (retries + 1 < MAX_SYNC_RETRIES) {
                    newQueue.push({ ...item, retries: retries + 1 });
                } else {
                    notifyDroppedItem(item, 'localApi');
                }
            }
        }

        localStorage.setItem(LOCAL_SYNC_QUEUE_KEY, JSON.stringify(newQueue));
        writeLocalSyncStatus({ queueCount: newQueue.length });
    } catch (e) {
        console.error('Process local sync queue error:', e);
    }
}

// Electron ortamında SQLite kullan + Supabase senkronizasyonu

function unwrapElectronDbResult(result, context = 'electron-db') {
    if (result && typeof result === 'object' && result.__ipcError) {
        const error = new Error(result.error || `${context} failed`);
        error.code = 'ELECTRON_DB_IPC_ERROR';
        if (result.channel) error.channel = result.channel;
        throw error;
    }
    return result;
}

async function callElectronDb(method, ...args) {
    const fn = window?.electronAPI?.db?.[method];
    if (typeof fn !== 'function') {
        throw new Error(`electronAPI.db.${method} kullanilamadi`);
    }
    const result = await fn(...args);
    return unwrapElectronDbResult(result, method);
}

// Supabase'den verileri çek (Electron -> local SQLite)
async function getElectronLocalSyncSnapshot() {
    if (!isElectron || !window?.electronAPI?.db) {
        return { count: null, latestCreatedAt: null };
    }

    try {
        const [count, latestLogs] = await Promise.all([
            typeof window.electronAPI.db.getLogsCount === 'function'
                ? callElectronDb('getLogsCount')
                : Promise.resolve(null),
            typeof window.electronAPI.db.getAllLogs === 'function'
                ? callElectronDb('getAllLogs', 1)
                : Promise.resolve([])
        ]);

        return {
            count: Number.isFinite(Number(count)) ? Number(count) : null,
            latestCreatedAt: Array.isArray(latestLogs) && latestLogs.length > 0
                ? latestLogs[0]?.created_at || null
                : null
        };
    } catch (e) {
        console.error('Electron local sync snapshot error:', e);
        return { count: null, latestCreatedAt: null };
    }
}

async function syncFromSupabase(options = {}) {
    if (!isElectron) return { ok: false, skipped: true };
    if (!shouldSyncToSupabase()) return { ok: false, skipped: true };
    if (supabasePullInProgress) return { ok: false, skipped: true };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { ok: false, offline: true };
    }

    const forceFull = Boolean(options?.forceFull);
    supabasePullInProgress = true;
    try {
        await processSyncQueue();

        const lookbackMs = PULL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
        const since = new Date(Date.now() - lookbackMs).toISOString();
        const recentWindowFloor = new Date(Date.now() - (DELTA_SYNC_BOOTSTRAP_DAYS * 24 * 60 * 60 * 1000)).toISOString();
        const recentWindowCursor = new Date(Date.parse(recentWindowFloor) - 1000).toISOString();

        const baseSelect = 'id, created_at, exit_at, type, sub_category, shift, plate, driver, name, host, note, location, entry_location, exit_location, seal_number, seal_number_entry, seal_number_exit, tc_no, phone, user_email';
        const baseSelectLegacy = 'id, created_at, exit_at, type, sub_category, shift, plate, driver, name, host, note, location, seal_number, seal_number_entry, seal_number_exit, tc_no, phone, user_email';
        const selectWithEventType = 'id, event_type, created_at, exit_at, type, sub_category, shift, plate, driver, name, host, note, location, entry_location, exit_location, seal_number, seal_number_entry, seal_number_exit, tc_no, phone, user_email';
        const selectWithEventTypeLegacy = 'id, event_type, created_at, exit_at, type, sub_category, shift, plate, driver, name, host, note, location, seal_number, seal_number_entry, seal_number_exit, tc_no, phone, user_email';
        const pageSize = 1000;
        const maxPages = 50;
        const activeChunkSize = 50;

        const runSelectWithFallback = async (queryFactory) => {
            const candidates = [selectWithEventType, selectWithEventTypeLegacy, baseSelect, baseSelectLegacy];
            let data = null;
            let error = null;

            for (const columns of candidates) {
                ({ data, error } = await queryFactory(columns));
                if (!error) break;
                if (
                    !isMissingColumnError(error, 'event_type')
                    && !isMissingColumnError(error, 'entry_location')
                    && !isMissingColumnError(error, 'exit_location')
                ) {
                    break;
                }
            }

            return { data, error };
        };

        const fetchActiveChunkFromSupabase = async (chunk) => {
            return runSelectWithFallback((columns) => (
                supabase
                    .from('security_logs')
                    .select(columns)
                    .in('created_at', chunk)
                    .order('created_at', { ascending: true })
            ));
        };

        const fetchPullPageFromSupabase = async (cursorValue) => {
            return runSelectWithFallback((columns) => {
                let qb = supabase
                    .from('security_logs')
                    .select(columns)
                    .order('created_at', { ascending: true })
                    .limit(pageSize);

                if (cursorValue) {
                    qb = qb.gt('created_at', cursorValue);
                } else {
                    qb = qb.gte('created_at', since);
                }

                return qb;
            });
        };

        // 1) Önce lokalde "içeride" görünen kayıtları Supabase'den tazele (çıkış yapılmış olabilir).
        // created_at çok eski olsa bile yakalamak için "in(created_at, ...)" kullanır.
        try {
            const activeLocal = await callElectronDb('getActiveLogs');
            const createdAtList = Array.from(
                new Set((activeLocal || []).map((l) => l?.created_at).filter(Boolean))
            );

            for (let i = 0; i < createdAtList.length; i += activeChunkSize) {
                const chunk = createdAtList.slice(i, i + activeChunkSize);
                if (chunk.length === 0) continue;

                const { data, error } = await fetchActiveChunkFromSupabase(chunk);
                if (error) {
                    console.error('Supabase active refresh error:', error);
                    break; // aktif tazeleme başarısızsa yine de incremental pull denenebilir
                }

                if (data && data.length > 0) {
                    for (const row of data) {
                        await callElectronDb('upsertLogByCreatedAt', row);
                    }
                }
            }
        } catch (e) {
            // aktif tazeleme opsiyonel; ana pull'u bloklamasın
            console.error('Supabase active refresh exception:', e);
        }

        // 2) Incremental + pagination (2000 limiti nedeniyle tek seferde takılmasın).
        const currentStatus = readSyncStatus();
        const localSnapshot = await getElectronLocalSyncSnapshot();
        const latestLocalCreatedAt = normalizeIsoDate(localSnapshot?.latestCreatedAt);
        const boundedLatestLocalCursor = latestLocalCreatedAt && latestLocalCreatedAt > recentWindowFloor
            ? latestLocalCreatedAt
            : recentWindowCursor;
        let cursor = forceFull ? recentWindowCursor : currentStatus?.lastPullCursorCreatedAt || null;
        let pullMode = forceFull ? 'limited_full' : 'incremental';
        let bootstrapReason = forceFull ? 'manual_force_full_recent_window' : null;

        if (localSnapshot?.count === 0) {
            cursor = recentWindowCursor;
            pullMode = 'limited_full';
            bootstrapReason = 'local_db_empty_recent_window';
        } else if (!cursor && latestLocalCreatedAt) {
            cursor = boundedLatestLocalCursor;
            pullMode = boundedLatestLocalCursor === latestLocalCreatedAt ? 'delta' : 'limited_full';
            bootstrapReason = boundedLatestLocalCursor === latestLocalCreatedAt
                ? 'latest_local_created_at'
                : 'latest_local_outside_recent_window';
        } else if (!cursor) {
            cursor = recentWindowCursor;
            pullMode = 'limited_full';
            bootstrapReason = 'missing_cursor_recent_window';
        } else if (latestLocalCreatedAt) {
            const cursorMs = Date.parse(cursor);
            const latestLocalMs = Date.parse(latestLocalCreatedAt);

            if (Number.isFinite(cursorMs) && Number.isFinite(latestLocalMs) && cursorMs - latestLocalMs > 60000) {
                cursor = boundedLatestLocalCursor;
                pullMode = boundedLatestLocalCursor === latestLocalCreatedAt ? 'delta' : 'limited_full';
                bootstrapReason = 'cursor_ahead_of_local_db';
            }
        }
        if (cursor && cursor < since) {
            cursor = latestLocalCreatedAt && latestLocalCreatedAt > since ? latestLocalCreatedAt : since;
            if (!bootstrapReason) {
                bootstrapReason = 'lookback_floor';
            }
        }
        if (bootstrapReason) {
            writeSyncStatus({ lastPullBootstrapReason: bootstrapReason });
        }

        let totalCount = 0;
        let pages = 0;

        while (pages < maxPages) {
            const { data, error } = await fetchPullPageFromSupabase(cursor);

            if (error) {
                console.error('Supabase pull error:', error);
                writeSyncStatus({ lastPullAt: new Date().toISOString(), lastPullStatus: 'error', lastPullError: error.message || String(error) });
                return { ok: false, error };
            }

            if (data && data.length > 0) {
                for (const row of data) {
                    await callElectronDb('upsertLogByCreatedAt', row);
                }
                cursor = data[data.length - 1]?.created_at || cursor;
                totalCount += data.length;
                writeSyncStatus({ lastPullCursorCreatedAt: cursor });
            }

            pages += 1;
            if (!data || data.length < pageSize) break;
        }

        writeSyncStatus({
            lastPullAt: new Date().toISOString(),
            lastPullStatus: 'ok',
            lastPullError: null,
            lastPullCount: totalCount,
            lastPullPages: pages,
            lastPullCursorCreatedAt: cursor || null,
            lastPullMode: pullMode,
            lastPullBootstrapReason: bootstrapReason
        });
        return { ok: true, count: totalCount, pages, cursor: cursor || null };
    } catch (e) {
        console.error('Supabase pull exception:', e);
        writeSyncStatus({ lastPullAt: new Date().toISOString(), lastPullStatus: 'error', lastPullError: e?.message || String(e) });
        return { ok: false, error: e };
    } finally {
        supabasePullInProgress = false;
    }
}

async function syncFromLocalApi() {
    if (!isElectron) return { ok: false, skipped: true };
    if (!shouldSyncToLocalApi()) return { ok: false, skipped: true };
    if (localPullInProgress) return { ok: false, skipped: true };

    localPullInProgress = true;
    try {
        await processLocalSyncQueue();

        const lookbackMs = LOCAL_PULL_DAYS * 24 * 60 * 60 * 1000;
        const since = new Date(Date.now() - lookbackMs).toISOString();
        const pageSize = Math.min(LOCAL_PULL_LIMIT, 1000);
        const maxPages = 50;

        const currentStatus = readLocalSyncStatus();
        let cursor = currentStatus?.lastPullCursorCreatedAt || null;
        if (cursor && cursor < since) cursor = null;

        let totalCount = 0;
        let pages = 0;

        while (pages < maxPages) {
            const params = new URLSearchParams();
            if (cursor) {
                params.set('since', cursor);
            } else {
                params.set('since', since);
            }
            params.set('limit', String(pageSize));

            const data = await fetchLocalApi(`logs?${params.toString()}`);
            const rows = Array.isArray(data) ? data : [];

            if (rows.length > 0) {
                for (const row of rows) {
                    await callElectronDb('upsertLogByCreatedAt', row);
                }
                cursor = rows[rows.length - 1]?.created_at || cursor;
                totalCount += rows.length;
                writeLocalSyncStatus({ lastPullCursorCreatedAt: cursor });
            }

            pages += 1;
            if (rows.length < pageSize) break;
        }

        writeLocalSyncStatus({
            lastPullAt: new Date().toISOString(),
            lastPullStatus: 'ok',
            lastPullError: null,
            lastPullCount: totalCount,
            lastPullPages: pages,
            lastPullCursorCreatedAt: cursor || null
        });
        return { ok: true, count: totalCount, pages, cursor: cursor || null };
    } catch (e) {
        console.error('Local API pull exception:', e);
        writeLocalSyncStatus({
            lastPullAt: new Date().toISOString(),
            lastPullStatus: 'error',
            lastPullError: e?.message || String(e)
        });
        return { ok: false, error: e };
    } finally {
        localPullInProgress = false;
    }
}

// Electron lokal verileri Supabase'e toplu aktar
async function exportLocalLogsToSupabase(options = {}) {
    if (!isElectron) return { ok: false, skipped: true };
    if (!shouldSyncToSupabase()) return { ok: false, skipped: true };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { ok: false, offline: true };
    }

    const pageSize = Number.isFinite(Number(options.pageSize)) ? Math.max(50, Number(options.pageSize)) : 500;
    let total = 0;
    let processed = 0;
    let pages = 0;
    let skippedInvalid = 0;
    let lastError = null;

    try {
        total = await callElectronDb('getLogsCount');
        writeSyncStatus({ lastBulkExportAt: new Date().toISOString(), lastBulkExportStatus: 'attempt', lastBulkExportError: null });

        for (let offset = 0; offset < total; offset += pageSize) {
            const rows = await callElectronDb('getLogsPage', pageSize, offset);
            if (!rows || rows.length === 0) break;

            let payload = [];
            for (const sourceRow of rows) {
                const row = pickSupabaseLogFields(sourceRow);
                if (!row?.created_at) continue;
                const chronology = validateChronology(row);
                if (chronology.issue) {
                    skippedInvalid += 1;
                    console.warn('[sync.bulk_export] chronology anomaly skipped:', chronology.issue, row.plate || row.name || row.created_at);
                    continue;
                }
                payload.push(row);
            }

            if (payload.length > 0) {
                const uniqueMap = new Map();
                payload.forEach((row) => {
                    uniqueMap.set(row.created_at, row);
                });
                payload = Array.from(uniqueMap.values());

                let workingPayload = payload;
                let error = null;

                for (let attempt = 0; attempt < 6; attempt += 1) {
                    let response = await supabase
                        .from('security_logs')
                        .upsert(workingPayload, { onConflict: 'created_at' });

                    error = response?.error || null;
                    if (error && isOnConflictConstraintError(error)) {
                        error = buildCreatedAtIntegrityError('BULK_EXPORT', error);
                        break;
                    }

                    if (!error) break;

                    const cleaned = [];
                    let changed = false;
                    for (let i = 0; i < workingPayload.length; i += 1) {
                        const row = workingPayload[i];
                        const nextRow = dropUnsupportedSupabaseColumns(row, error) || row;
                        cleaned.push(nextRow);
                        if (!changed && JSON.stringify(nextRow) !== JSON.stringify(row)) {
                            changed = true;
                        }
                    }
                    if (!changed) break;
                    workingPayload = cleaned;
                }

                if (error) {
                    lastError = error;
                    break;
                }
            }

            processed += rows.length;
            pages += 1;
            if (typeof options.onProgress === 'function') {
                options.onProgress({ processed, total, pages });
            }
        }

        writeSyncStatus({
            lastBulkExportAt: new Date().toISOString(),
            lastBulkExportStatus: lastError ? 'error' : 'ok',
            lastBulkExportError: lastError ? (lastError.message || String(lastError)) : (skippedInvalid > 0 ? `${skippedInvalid} geçersiz kayıt atlandı.` : null)
        });

        return { ok: !lastError, total, processed, pages, skippedInvalid, error: lastError };
    } catch (e) {
        writeSyncStatus({
            lastBulkExportAt: new Date().toISOString(),
            lastBulkExportStatus: 'error',
            lastBulkExportError: e?.message || String(e)
        });
        return { ok: false, total, processed, pages, skippedInvalid, error: e };
    }
}

const electronDB = {
    async getActiveLogs() {
        return await callElectronDb('getActiveLogs');
    },

    async getLogById(id) {
        if (window?.electronAPI?.db?.getLogById) {
            return await callElectronDb('getLogById', id);
        }
        const logs = await this.getAllLogs();
        return logs.find((log) => log.id === id) || null;
    },

    async getAllLogs(limit = 1000) {
        return await callElectronDb('getAllLogs', limit);
    },

    async getLogsByDateRange(dateFrom, dateTo) {
        return await callElectronDb('getLogsByDateRange', dateFrom, dateTo);
    },

    async insertLog(logData) {
        // Önce yerel SQLite'a kaydet
        const result = await callElectronDb('insertLog', logData);

        // Sonra Supabase'e senkronize et (arka planda)
        syncToSupabase('INSERT', { ...logData, created_at: result.created_at || logData.created_at }, result.id);
        // Yerel API'ye de senkronize et
        syncToLocalApi('INSERT', { ...logData, created_at: result.created_at || logData.created_at }, result.id);

        return result;
    },

    async updateLog(id, updateData) {
        // Önce güncellenecek kaydı bul (created_at için)
        const existingLog = await this.getLogById(id);

        const result = await callElectronDb('updateLog', id, updateData);

        // Supabase'e senkronize et
        if (existingLog) {
            syncToSupabase('UPDATE', { ...updateData, created_at: existingLog.created_at }, existingLog.created_at);
            syncToLocalApi('UPDATE', { ...updateData, created_at: existingLog.created_at }, existingLog.created_at);
        }

        return result;
    },

    async exitLog(id, exitData = {}) {
        // Önce çıkış yapılacak kaydı bul
        const existingLog = await this.getLogById(id);
        if (!existingLog) {
            throw new Error('Çıkış yapılacak kayıt bulunamadı.');
        }
        if (existingLog.exit_at) {
            throw new Error('Bu kayıt zaten çıkış yapmış görünüyor.');
        }
        const exitTimestamp = new Date().toISOString();

        const result = await callElectronDb('exitLog', id, { ...exitData, exit_at: exitTimestamp });
        if (!result) {
            throw new Error('Çıkış işlemi veritabanında tamamlanamadı. Kayıt güncel olmayabilir, listeyi yenileyin.');
        }

        // Supabase'e senkronize et (aynı timestamp kullan)
        syncToSupabase('EXIT', {
            plate: existingLog.plate,
            name: existingLog.name,
            exit_at: exitTimestamp,
            extraData: exitData
        }, existingLog.created_at);
        syncToLocalApi('EXIT', {
            plate: existingLog.plate,
            name: existingLog.name,
            exit_at: exitTimestamp,
            extraData: exitData
        }, existingLog.created_at);

        return result;
    },

    async deleteLog(id) {
        // Önce silinecek kaydı bul
        const existingLog = await this.getLogById(id);

        const result = await callElectronDb('deleteLog', id);

        // Supabase'e senkronize et
        if (existingLog) {
            syncToSupabase('DELETE', null, existingLog.created_at);
            syncToLocalApi('DELETE', null, existingLog.created_at);
        }

        return result;
    },

    async searchLogs(searchTerm, limit = 100) {
        return await callElectronDb('searchLogs', searchTerm, limit);
    },

    async getStats() {
        return await callElectronDb('getStats');
    },

    async setSetting(key, value) {
        return await callElectronDb('setSetting', key, value);
    },

    async getSetting(key) {
        return await callElectronDb('getSetting', key);
    }
};

// Web ortamında localStorage + Supabase kullan (fallback)
const webDB = {
    // LocalStorage key
    LOGS_KEY: 'security_logs_local',
    SETTINGS_KEY: 'security_settings_local',

    _getLogs() {
        try {
            return JSON.parse(localStorage.getItem(this.LOGS_KEY) || '[]');
        } catch {
            return [];
        }
    },

    _saveLogs(logs) {
        localStorage.setItem(this.LOGS_KEY, JSON.stringify(logs));
    },

    async getActiveLogs() {
        const logs = this._getLogs();
        return logs.filter(log => !log.exit_at).sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );
    },

    async getAllLogs(limit = 1000) {
        const logs = this._getLogs();
        return logs
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit);
    },

    async getLogsByDateRange(dateFrom, dateTo) {
        const logs = this._getLogs();
        return logs.filter(log => {
            const logDate = new Date(log.created_at).toISOString().split('T')[0];
            return logDate >= dateFrom && logDate <= dateTo;
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    async getLogById(id) {
        const logs = this._getLogs();
        return logs.find(log => log.id === id) || null;
    },

    async insertLog(logData) {
        const logs = this._getLogs();
        const newLog = {
            id: Date.now(),
            ...logData,
            created_at: logData.created_at || new Date().toISOString()
        };
        const chronology = validateChronology(newLog);
        if (chronology.issue) {
            throw new Error(chronology.message);
        }
        logs.unshift(newLog);
        this._saveLogs(logs);

        // Supabase'e de senkronize et (web için önemli!)
        if (shouldSyncToSupabase()) {
            console.log("🔄 Web: Supabase'e senkronize ediliyor...", newLog);
            syncToSupabase('INSERT', newLog, newLog.id);
        }
        syncToLocalApi('INSERT', newLog, newLog.created_at);

        return newLog;
    },

    async updateLog(id, updateData) {
        const logs = this._getLogs();
        const index = logs.findIndex(log => log.id === id);
        if (index !== -1) {
            const existingLog = logs[index];
            const chronology = validateChronology(
                updateData || {},
                updateData?.created_at ?? existingLog.created_at,
                updateData?.exit_at !== undefined ? updateData.exit_at : existingLog.exit_at
            );
            if (chronology.issue) {
                throw new Error(chronology.message);
            }
            logs[index] = { ...logs[index], ...updateData };
            this._saveLogs(logs);

            // Supabase'e de senkronize et
            syncToSupabase('UPDATE', { ...updateData, created_at: existingLog.created_at }, existingLog.created_at);
            syncToLocalApi('UPDATE', { ...updateData, created_at: existingLog.created_at }, existingLog.created_at);

            return true;
        }
        return false;
    },

    async exitLog(id, exitData = {}) {
        const existingLog = await this.getLogById(id);
        if (!existingLog) {
            throw new Error('Çıkış yapılacak kayıt bulunamadı.');
        }
        if (existingLog.exit_at) {
            throw new Error('Bu kayıt zaten çıkış yapmış görünüyor.');
        }
        const exitTimestamp = new Date().toISOString();
        const result = await this.updateLog(id, { exit_at: exitTimestamp, ...exitData });
        if (!result) {
            throw new Error('Çıkış işlemi veritabanında tamamlanamadı. Kayıt güncel olmayabilir, listeyi yenileyin.');
        }

        // Supabase'e EXIT senkronizasyonu (aynı timestamp kullan)
        syncToSupabase('EXIT', {
            plate: existingLog.plate,
            name: existingLog.name,
            exit_at: exitTimestamp,
            extraData: exitData
        }, existingLog.created_at);
        syncToLocalApi('EXIT', {
            plate: existingLog.plate,
            name: existingLog.name,
            exit_at: exitTimestamp,
            extraData: exitData
        }, existingLog.created_at);

        return result;
    },

    async deleteLog(id) {
        const logs = this._getLogs();
        const existingLog = logs.find(log => log.id === id);
        const filtered = logs.filter(log => log.id !== id);
        if (filtered.length !== logs.length) {
            this._saveLogs(filtered);
            if (existingLog) {
                syncToSupabase('DELETE', null, existingLog.created_at);
                syncToLocalApi('DELETE', null, existingLog.created_at);
            }
            return true;
        }
        return false;
    },

    async searchLogs(searchTerm, limit = 100) {
        const logs = this._getLogs();
        const term = normalizeText(searchTerm);
        return logs
            .filter(log =>
                (log.plate && normalizeText(log.plate).includes(term)) ||
                (log.name && normalizeText(log.name).includes(term)) ||
                (log.host && normalizeText(log.host).includes(term)) ||
                (log.driver && normalizeText(log.driver).includes(term))
            )
            .slice(0, limit);
    },

    async getStats() {
        const logs = this._getLogs();
        const today = new Date().toISOString().split('T')[0];

        const todayLogs = logs.filter(log =>
            new Date(log.created_at).toISOString().split('T')[0] === today
        );

        return {
            today: todayLogs.length,
            activeNow: logs.filter(log => !log.exit_at).length,
            todayVehicle: todayLogs.filter(log => log.type === 'vehicle').length,
            todayVisitor: todayLogs.filter(log => log.type === 'visitor').length
        };
    },

    async setSetting(key, value) {
        const settings = JSON.parse(localStorage.getItem(this.SETTINGS_KEY) || '{}');
        settings[key] = value;
        localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
    },

    async getSetting(key) {
        const settings = JSON.parse(localStorage.getItem(this.SETTINGS_KEY) || '{}');
        return settings[key] || null;
    }
};

// Doğru API'yi seç
const db = isElectron ? electronDB : webDB;

// Interval ID'leri modül seviyesinde — tekrar çağrıda temizlenir (memory leak önleme)
let _syncQueueIntervalId = null;
let _supabasePullIntervalId = null;
let _localPullIntervalId = null;

// Uygulama başladığında bekleyen senkronizasyonları işle
if (typeof window !== 'undefined') {
    // 5 saniyelik gecikme ile başlat
    setTimeout(() => {
        processSyncQueue();
        processLocalSyncQueue();
    }, 5000);

    // Her 30 saniyede bir kontrol et (önceki interval varsa temizle)
    if (_syncQueueIntervalId) clearInterval(_syncQueueIntervalId);
    _syncQueueIntervalId = setInterval(() => {
        processSyncQueue();
        processLocalSyncQueue();
    }, 30000);

    // Online olunca hemen queue işle (B3)
    window.addEventListener('online', () => {
        setTimeout(() => {
            processSyncQueue();
            processLocalSyncQueue();
        }, 1000);
    });

    if (isElectron) {
        // İlk başlatmada: DB boşsa hemen full sync, değilse kısa gecikme ile incremental
        setTimeout(async () => {
            try {
                const snapshot = await getElectronLocalSyncSnapshot();
                const isEmpty = !snapshot?.count || snapshot.count === 0;

                if (isEmpty) {
                    // Yeni kurulum — hemen full sync başlat, UI'a bildir
                    window.dispatchEvent(new CustomEvent('supabase-sync-start', {
                        detail: { mode: 'full', reason: 'first_launch' }
                    }));
                }

                const result = await syncFromSupabase(isEmpty ? { forceFull: true } : {});
                if (result?.ok) {
                    window.dispatchEvent(new CustomEvent('supabase-sync-done', {
                        detail: { ...result, firstLaunch: isEmpty }
                    }));
                }
                syncFromLocalApi();
            } catch (e) {
                console.error('Initial sync error:', e);
            }
        }, 2000);

        if (_supabasePullIntervalId) clearInterval(_supabasePullIntervalId);
        _supabasePullIntervalId = setInterval(async () => {
            const result = await syncFromSupabase();
            if (result?.ok && result?.count > 0) {
                window.dispatchEvent(new CustomEvent('supabase-sync-done', { detail: result }));
            }
        }, ELECTRON_SUPABASE_PULL_INTERVAL_MS);

        if (_localPullIntervalId) clearInterval(_localPullIntervalId);
        _localPullIntervalId = setInterval(() => {
            syncFromLocalApi();
        }, LOCAL_PULL_INTERVAL_MS);
    }
}

// Export
function getSyncStatus() {
    const status = readSyncStatus();
    try {
        const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
        status.queueCount = queue.length;
    } catch (e) {
        // ignore
    }
    status.local = readLocalSyncStatus();
    try {
        const localQueue = JSON.parse(localStorage.getItem(LOCAL_SYNC_QUEUE_KEY) || '[]');
        status.local.queueCount = localQueue.length;
    } catch (e) {
        // ignore
    }
    return status;
}

export { db, isElectron, isMobile, syncToSupabase, processSyncQueue, processLocalSyncQueue, syncFromSupabase, syncFromLocalApi, exportLocalLogsToSupabase, getSyncStatus, webDB };
export default db;
