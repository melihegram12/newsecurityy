import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Car, User, FileText, CheckCircle, Clock, LogOut, Search,
  Edit, X, Wifi, WifiOff, LogIn, MapPin, Lock, Briefcase, Layers, RefreshCw, UserMinus, UserCheck, AlertTriangle, Crown, Bus,
  Trash2, BarChart3, Calendar, Filter, Phone, TrendingUp, Users, Activity, PieChart, History, Timer, AlertCircle, ArrowRightCircle, ArrowLeftCircle,
  CalendarClock, Mail, Volume2, VolumeX, Zap, Star, Send, RotateCcw, Folder, Upload
} from 'lucide-react';
import { supabase, supabaseUrl } from './supabaseClient';
import { db as dbClient, isElectron, processSyncQueue, processLocalSyncQueue, syncFromSupabase, syncFromLocalApi, exportLocalLogsToSupabase, getSyncStatus } from './dbClient';
import * as XLSX from 'xlsx';

// --- MODÜLER İMPORTLAR ---
import {
  OFFLINE_QUEUE_KEY, BUILD_TIME, LOCAL_API_URL_KEY, LOCAL_API_KEY_KEY,
  LOCAL_API_TOKEN_KEY, LOCAL_ROLE_SESSION_KEY, ACTIVE_ROLE_KEY, ACTION_LOGS_KEY,
  LOCAL_SYNC_ENABLED, LOCAL_API_DEFAULT_URL, SHOW_SYNC_PANEL_KEY, SHOW_SMTP_PANEL_KEY,
  SHOW_HISTORY_PANEL_KEY, LITE_MODE_KEY, FEATURE_FLAGS_KEY, ATTACHMENTS_SETTINGS_KEY,
  SUPABASE_SYNC_QUEUE_KEY, LOCAL_SYNC_QUEUE_KEY, MAX_ATTACHMENTS_PER_LOG,
  MAX_ATTACHMENT_SIZE_BYTES, REPORT_RENDER_LIMIT_NORMAL, REPORT_PAGE_SIZE_NORMAL,
  REPORT_PAGE_SIZE_LITE, DIRECTION_ENTRY, DIRECTION_EXIT, DEFAULT_FEATURE_FLAGS,
  ROLE_SECURITY, ROLE_HR, ROLE_DEVELOPER, ROLE_FALLBACK_PASSWORDS, LOGIN_ROLE_OPTIONS,
} from './lib/constants';
import {
  cx, sanitizeInput, normalizeFeatureFlags, humanFileSize,
  upperTr, lowerTr, normalizeIdentifier, isSameIdentifier,
  isValidTC, formatPhone, formatForInput, toDateOnly, calculateWaitTime,
  getCategoryStyle, getShortCategory, resolveRoleByAlias,
  buildFallbackSessionUser, createAttachmentId, normalizeAttachmentItem,
  normalizeAttachmentMap, getLogAttachmentKey, readFileAsDataUrl, downloadDataUrl,
  labelClass, getEntryLocation, getExitLocation, buildLegacyLocationValue, formatLogLocation,
  areObjectsEqual, normalizeLogText, normalizeLogList, areLogListsEqual, upsertLogInList,
  needsPlainCsvFallback, parseCsvTextLoose, pickSupabaseCompatibleLog,
} from './lib/utils';
import { buildAuditHash, verifyAuditChain } from './lib/audit-utils';
import {
  mapCsvRowToLog,
  dedupeLogsByCreatedAt, upsertChunkWithRetry,
} from './lib/csv-utils';
import {
  MANAGEMENT_VEHICLES, STAFF_LIST, OTHER_HOST_VALUE, UNSPECIFIED_HOST_VALUE,
  HOST_PRESETS, CATEGORIES,
} from './lib/data';
import { useDebounce } from './hooks/useDebounce';
import { Button, Card, FormField, TableHeadCell, Toast, ConfirmModal, SubTabBtn, Input, Select, Textarea, Modal, Badge } from './components/ui';

// --- LOGO İÇE AKTARMA ---
import logoImg from './logo.png';

// === MAIN APP COMPONENT ===
export default function App() {
  // --- STATE TANIMLARI ---
  const [session, setSession] = useState(null);
  const [activeLogs, setActiveLogs] = useState([]);
  const [allLogs, setAllLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [notification, setNotification] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [supabaseDebug, setSupabaseDebug] = useState({ lastError: null, lastCheckedAt: null });
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState(() => getSyncStatus());
  const [bulkExportState, setBulkExportState] = useState({ running: false, processed: 0, total: 0, lastError: null });
  const [showSyncPanel, setShowSyncPanel] = useState(() => {
    try {
      const saved = localStorage.getItem(SHOW_SYNC_PANEL_KEY);
      return saved ? saved === '1' : true;
    } catch (e) {
      return true;
    }
  });
  const [showSmtpPanel, setShowSmtpPanel] = useState(() => {
    try {
      const saved = localStorage.getItem(SHOW_SMTP_PANEL_KEY);
      return saved ? saved === '1' : false;
    } catch (e) {
      return false;
    }
  });
  const [showHistoryPanel, setShowHistoryPanel] = useState(() => {
    try {
      const saved = localStorage.getItem(SHOW_HISTORY_PANEL_KEY);
      return saved === '1';
    } catch (e) {
      return false;
    }
  });
  const [liteMode, setLiteMode] = useState(() => localStorage.getItem(LITE_MODE_KEY) === '1');
  const [featureFlags, setFeatureFlags] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY) || '{}');
      return normalizeFeatureFlags(saved);
    } catch (e) {
      return normalizeFeatureFlags();
    }
  });
  const optionalAttachmentsEnabled = !!featureFlags.optionalAttachments;
  const advancedReportEnabled = !!featureFlags.advancedReport;
  const offlineQueueInspectorEnabled = !!featureFlags.offlineQueueInspector;
  const enhancedAuditEnabled = !!featureFlags.enhancedAudit;
  const enabledFeatureCount = Object.values(featureFlags || {}).filter(Boolean).length;
  const localDbFetchLimit = liteMode ? 400 : 1000;
  const remoteFetchLimit = liteMode ? 1200 : 5000;
  const localApiFetchLimit = liteMode ? 1200 : 5000;
  const reportRenderLimit = liteMode ? 300 : REPORT_RENDER_LIMIT_NORMAL;
  const reportPageSize = liteMode ? REPORT_PAGE_SIZE_LITE : REPORT_PAGE_SIZE_NORMAL;
  const syncStatusIntervalMs = liteMode ? 30000 : 15000;
  const backupStatusIntervalMs = liteMode ? 60000 : 30000;
  const emailSchedulerStatusIntervalMs = liteMode ? 60000 : 30000;
  const dataRefreshIntervalMs = liteMode ? 45000 : 20000;
  const [localApiUrl, setLocalApiUrl] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_API_URL_KEY);
      return saved ?? '';
    } catch (e) {
      return '';
    }
  });
  const [localApiKey, setLocalApiKey] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_API_KEY_KEY);
      return saved ?? '';
    } catch (e) {
      return '';
    }
  });
  const [localApiToken, setLocalApiToken] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_API_TOKEN_KEY);
      return saved ?? '';
    } catch (e) {
      return '';
    }
  });
  const [localApiAuthUser, setLocalApiAuthUser] = useState('');
  const [localApiAuthPass, setLocalApiAuthPass] = useState('');
  const [localApiAuthLoading, setLocalApiAuthLoading] = useState(false);
  const [authRole, setAuthRole] = useState(() => localStorage.getItem(ACTIVE_ROLE_KEY) || ROLE_SECURITY);
  const [authLoading, setAuthLoading] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [serverPingLoading, setServerPingLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ACTION_LOGS_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (e) {
      return [];
    }
  });
  const [auditSearchTerm, setAuditSearchTerm] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [serverAuditLogs, setServerAuditLogs] = useState([]);
  const [serverAuditLoading, setServerAuditLoading] = useState(false);
  const [attachmentsByLog, setAttachmentsByLog] = useState({});
  const [entryAttachments, setEntryAttachments] = useState([]);
  const [attachmentModalLog, setAttachmentModalLog] = useState(null);
  const attachmentsRef = useRef({});
  const [updateUrl, setUpdateUrl] = useState('');
  const [effectiveUpdateUrl, setEffectiveUpdateUrl] = useState('');
  const effectiveLocalApiUrl = localApiUrl?.trim() ? localApiUrl.trim() : LOCAL_API_DEFAULT_URL;
  const canUseLocalApi = LOCAL_SYNC_ENABLED && Boolean(effectiveLocalApiUrl);
  const localApiHeaders = useMemo(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (localApiKey?.trim()) headers['X-Api-Key'] = localApiKey.trim();
    if (localApiToken?.trim()) headers['Authorization'] = `Bearer ${localApiToken.trim()}`;
    return headers;
  }, [localApiKey, localApiToken]);
  const localApiFetch = useCallback(async (path, options = {}) => {
    const base = (effectiveLocalApiUrl || '').replace(/\/$/, '');
    const endpoint = (path || '').replace(/^\//, '');
    const url = `${base}/${endpoint}`;
    const opts = {
      ...options,
      headers: { ...localApiHeaders, ...(options.headers || {}) },
    };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const contentType = res.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const detail = payload?.detail || payload?.error || (typeof payload === 'string' ? payload : 'API hatası');
      throw new Error(detail);
    }
    return payload;
  }, [effectiveLocalApiUrl, localApiHeaders]);
  const _fetchLogsFromLocalApi = useCallback(async () => { // eslint-disable-line no-unused-vars
    if (!canUseLocalApi) return null;
    const data = await localApiFetch(`logs?limit=${localApiFetchLimit}`);
    if (!Array.isArray(data)) return null;
    const all = [...data].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const active = all.filter((row) => !row.exit_at);
    return { all, active };
  }, [canUseLocalApi, localApiFetch, localApiFetchLimit]);
  const backupToLocalApi = useCallback(async (action, data, localId) => {
    if (!canUseLocalApi) return { ok: false, skipped: true };
    try {
      const body = { action };
      if (data !== undefined && data !== null) body.data = data;
      if (localId !== undefined && localId !== null && localId !== '') body.local_id = localId;
      await localApiFetch('logs/sync', {
        method: 'POST',
        body
      });
      return { ok: true };
    } catch (e) {
      console.warn('Local backup error:', e);
      return { ok: false, error: e };
    }
  }, [canUseLocalApi, localApiFetch]);
  const activeRole = session?.user?.active_role || session?.user?.activeRole || '';
  const canUseSecurityPanel = activeRole === ROLE_SECURITY || activeRole === ROLE_DEVELOPER;
  const canUseHrPanel = activeRole === ROLE_HR || activeRole === ROLE_DEVELOPER;
  const isDeveloperRole = activeRole === ROLE_DEVELOPER || !!session?.user?.is_superuser;
  const [backupStatus, setBackupStatus] = useState(null);
  const [showStaffList, setShowStaffList] = useState(false);
  const [showManagementList, setShowManagementList] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [importFile, setImportFile] = useState(null);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ processed: 0, total: 0 });
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [plateHistory, setPlateHistory] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('');
  const [hostFilter, setHostFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sealFilter, setSealFilter] = useState('');
  const [hrTab, setHrTab] = useState('attendance');
  const [hrLoading, setHrLoading] = useState(false);
  const [hrError, setHrError] = useState('');
  const [absenceTypes, setAbsenceTypes] = useState([]);
  const [absenceTypeDraft, setAbsenceTypeDraft] = useState({
    name: '',
    code: '',
    description: '',
    default_unit: 'FULL_DAY',
    is_paid: false,
    affects_payroll: false,
    affects_sgk: false,
    affects_premium: false,
    sgk_code: '',
    requires_document: false,
    is_excused_default: false,
    is_active: true,
  });
  const [absenceRecords, setAbsenceRecords] = useState([]);
  const [absenceRecordDraft, setAbsenceRecordDraft] = useState({
    person: '',
    absence_type: '',
    start_at: '',
    end_at: '',
    duration_unit: 'FULL_DAY',
    duration_value: '',
    is_excused: false,
    note: '',
    source: 'MANUAL',
  });
  const [absenceRecordFilters, setAbsenceRecordFilters] = useState({
    person_id: '',
    status: '',
    date_from: '',
    date_to: '',
  });
  const [workShifts, setWorkShifts] = useState([]);
  const [shiftDraft, setShiftDraft] = useState({
    name: '',
    code: '',
    description: '',
    start_time: '08:00',
    end_time: '16:00',
    late_tolerance_minutes: 0,
    early_leave_tolerance_minutes: 0,
    is_active: true,
  });
  const [shiftAssignments, setShiftAssignments] = useState([]);
  const [assignmentDraft, setAssignmentDraft] = useState({
    person: '',
    shift: '',
    effective_from: '',
    effective_to: '',
    is_active: true,
  });
  const [attendanceQuery, setAttendanceQuery] = useState({
    person_id: '',
    date_from: '',
    date_to: '',
  });
  const [attendanceSummary, setAttendanceSummary] = useState(null);
  const [payrollProfiles, setPayrollProfiles] = useState([]);
  const [payrollProfileDraft, setPayrollProfileDraft] = useState({
    person: '',
    salary_type: 'DAILY',
    hourly_rate: '',
    daily_rate: '',
    monthly_salary: '',
    premium_hourly_rate: '',
    premium_daily_rate: '',
    currency: 'TRY',
    is_active: true,
  });
  const [payrollSummaryQuery, setPayrollSummaryQuery] = useState({ person_id: '', date_from: '', date_to: '' });
  const [payrollSummary, setPayrollSummary] = useState(null);
  const [sgkReportQuery, setSgkReportQuery] = useState({ date_from: '', date_to: '' });
  const [sgkReport, setSgkReport] = useState(null);
  const [todayPageFilter, setTodayPageFilter] = useState('all'); // all, entry, exit
  const [todayCategoryFilter, setTodayCategoryFilter] = useState('');
  const [todayCurrentPage, setTodayCurrentPage] = useState(1);
  const [todayPageSize] = useState(15);
  const [todaySort, setTodaySort] = useState({ key: 'time', dir: 'desc' });
  const [reportSort, setReportSort] = useState({ key: 'created_at', dir: 'desc' });
  const [reportCurrentPage, setReportCurrentPage] = useState(1);
  const [showHostStaffList, setShowHostStaffList] = useState(false);
  const [hostSearchTerm, setHostSearchTerm] = useState('');
  const [isCustomHost, setIsCustomHost] = useState(false);
  const hostSelectRef = useRef(null);
  const [vehicleDirection, setVehicleDirection] = useState(DIRECTION_ENTRY);
  const isExitDirection = vehicleDirection === DIRECTION_EXIT;
  const isEntryDirection = !isExitDirection;
  const [exitSealModalOpen, setExitSealModalOpen] = useState(false);
  const [exitingLogData, setExitingLogData] = useState(null);
  const [exitSealNumber, setExitSealNumber] = useState('');
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning',
    onConfirm: null,
    onSecondary: null,
    confirmLabel: '',
    cancelLabel: '',
    secondaryLabel: '',
    confirmVariant: undefined,
    secondaryVariant: undefined,
  });
  const [mainTab, setMainTab] = useState('vehicle');
  const [vehicleSubTab, setVehicleSubTab] = useState('guest');
  const [visitorSubTab, setVisitorSubTab] = useState('guest');
  const [formData, setFormData] = useState({ plate: '', driver: '', driver_type: 'owner', name: '', host: '', note: '', entry_location: '', exit_location: '', seal_number_entry: '', seal_number_exit: '', tc_no: '', phone: '' });
  const [editingLog, setEditingLog] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [_loginError, setLoginError] = useState(null); // eslint-disable-line no-unused-vars
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('soundEnabled') !== 'false');
  const [sendingReport, setSendingReport] = useState(false);
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);
  const [emailSettings, setEmailSettings] = useState(null);
  const [emailSchedulerStatus, setEmailSchedulerStatus] = useState(null);
  const [smtpDraft, setSmtpDraft] = useState(null);
  const [smtpRecipientsText, setSmtpRecipientsText] = useState('');
  const [smtpPassInput, setSmtpPassInput] = useState('');
  const [smtpRunNowLoading] = useState(false);

  // Refs
  const isMountedRef = useRef(true);
  const fetchIntervalRef = useRef(null);
  const fetchInFlightRef = useRef(false);
  const queuedFetchRef = useRef(false);

  // Debounced values
  const debouncedActiveSearchTerm = useDebounce(activeSearchTerm, 300);

  const localApiUrlError = useMemo(() => {
    const v = (localApiUrl || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) return 'URL http:// veya https:// ile baslamali.';
    return '';
  }, [localApiUrl]);

  const updateUrlError = useMemo(() => {
    const v = (updateUrl || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) return 'URL http:// veya https:// ile baslamali.';
    return '';
  }, [updateUrl]);

  useEffect(() => {
    if (!isElectron) return;
    if (!serverSettingsOpen) return;

    let cancelled = false;
    (async () => {
      try {
        const url = await window?.electronAPI?.updater?.getUpdateUrl?.();
        if (cancelled) return;
        const value = typeof url === 'string' ? url : '';
        setUpdateUrl(value);
        setEffectiveUpdateUrl(value);
      } catch (e) {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverSettingsOpen]);

  // Vardiya hesaplama
  const getShiftByTime = useCallback(() => {
    const hour = new Date().getHours();
    if (hour >= 8 && hour < 16) return 'Vardiya 1 (08:00-16:00)';
    if (hour >= 16 && hour < 24) return 'Vardiya 2 (16:00-00:00)';
    return 'Vardiya 3 (00:00-08:00)';
  }, []);

  const [currentShift, setCurrentShift] = useState(() => getShiftByTime());

  // --- CALLBACKS ---
  const showToast = useCallback((message, type = 'success') => {
    setNotification({ message, type });
  }, []);

  const closeToast = useCallback(() => setNotification(null), []);

  const persistFeatureFlags = useCallback((nextFlags) => {
    const normalized = normalizeFeatureFlags(nextFlags);
    setFeatureFlags(normalized);
    try {
      localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(normalized));
    } catch (e) {
      // ignore
    }
    return normalized;
  }, []);

  const toggleFeatureFlag = useCallback((key) => {
    persistFeatureFlags({
      ...featureFlags,
      [key]: !featureFlags[key]
    });
  }, [featureFlags, persistFeatureFlags]);

  const disableNewFeatures = useCallback(() => {
    persistFeatureFlags({
      optionalAttachments: false,
      advancedReport: false,
      offlineQueueInspector: false,
      enhancedAudit: false
    });
    showToast('Yeni ozellikler kapatildi. Eski gorunume donuldu.', 'info');
  }, [persistFeatureFlags, showToast]);

  const enableNewFeatures = useCallback(() => {
    persistFeatureFlags(DEFAULT_FEATURE_FLAGS);
    showToast('Yeni ozellikler yeniden aktif edildi.', 'success');
  }, [persistFeatureFlags, showToast]);

  const appendActionLog = useCallback((action, message = '') => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      action,
      message,
      user: session?.user?.username || session?.user?.email || 'anonymous',
      role: activeRole || '-',
    };
    setAuditLogs((prev) => {
      const previousHash = prev?.[0]?.hash || 'GENESIS';
      const signed = {
        ...entry,
        prev_hash: previousHash,
        hash: buildAuditHash({ ...entry, prev_hash: previousHash })
      };
      const next = [signed, ...prev].slice(0, 500);
      try {
        localStorage.setItem(ACTION_LOGS_KEY, JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      return next;
    });
  }, [activeRole, session]);

  const saveAttachmentsMap = useCallback(async (nextMap) => {
    const normalized = normalizeAttachmentMap(nextMap);
    attachmentsRef.current = normalized;
    setAttachmentsByLog(normalized);
    try {
      await dbClient.setSetting(ATTACHMENTS_SETTINGS_KEY, normalized);
    } catch (e) {
      showToast(`Ek kaydedilemedi: ${e?.message || String(e)}`, 'error');
    }
  }, [showToast]);

  const getAttachmentsForLog = useCallback((log) => {
    const key = getLogAttachmentKey(log);
    if (!key) return [];
    return Array.isArray(attachmentsByLog?.[key]) ? attachmentsByLog[key] : [];
  }, [attachmentsByLog]);

  const addAttachmentsToLog = useCallback(async (logLike, attachments = []) => {
    const key = getLogAttachmentKey(logLike);
    if (!key) return;
    const incoming = (attachments || []).map((x) => normalizeAttachmentItem(x)).filter(Boolean);
    if (incoming.length === 0) return;

    const current = attachmentsRef.current || {};
    const existing = Array.isArray(current[key]) ? current[key] : [];
    const merged = [...existing, ...incoming].slice(0, MAX_ATTACHMENTS_PER_LOG);
    const next = { ...current, [key]: merged };
    await saveAttachmentsMap(next);
  }, [saveAttachmentsMap]);

  const removeAttachmentFromLog = useCallback(async (logLike, attachmentId) => {
    const key = getLogAttachmentKey(logLike);
    if (!key) return;
    const current = attachmentsRef.current || {};
    const existing = Array.isArray(current[key]) ? current[key] : [];
    const nextItems = existing.filter((x) => x.id !== attachmentId);
    const next = { ...current };
    if (nextItems.length === 0) {
      delete next[key];
    } else {
      next[key] = nextItems;
    }
    await saveAttachmentsMap(next);
  }, [saveAttachmentsMap]);

  const _removeAllAttachmentsForLog = useCallback(async (logLike) => { // eslint-disable-line no-unused-vars
    const key = getLogAttachmentKey(logLike);
    if (!key) return;
    const current = attachmentsRef.current || {};
    if (!current[key]) return;
    const next = { ...current };
    delete next[key];
    await saveAttachmentsMap(next);
  }, [saveAttachmentsMap]);

  const handleEntryAttachmentSelect = useCallback(async (event) => {
    const files = Array.from(event?.target?.files || []);
    if (event?.target) event.target.value = '';
    if (files.length === 0) return;

    const safeList = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        showToast(`"${file.name}" 2 MB sinirini asiyor.`, 'warning');
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        safeList.push(normalizeAttachmentItem({
          id: createAttachmentId(),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
          addedAt: new Date().toISOString()
        }));
      } catch (e) {
        showToast(`"${file.name}" okunamadi.`, 'error');
      }
    }

    if (safeList.length === 0) return;

    setEntryAttachments((prev) => {
      const merged = [...prev, ...safeList].slice(0, MAX_ATTACHMENTS_PER_LOG);
      if (merged.length < prev.length + safeList.length) {
        showToast(`Maksimum ${MAX_ATTACHMENTS_PER_LOG} dosya eklenebilir.`, 'warning');
      }
      const totalBytes = merged.reduce((sum, item) => sum + Number(item.size || 0), 0);
      if (totalBytes > (MAX_ATTACHMENT_SIZE_BYTES * MAX_ATTACHMENTS_PER_LOG)) {
        showToast('Toplam ek boyutu siniri asildi. Daha kucuk dosya secin.', 'warning');
        return prev;
      }
      return merged;
    });
  }, [showToast]);

  const removeEntryAttachment = useCallback((attachmentId) => {
    setEntryAttachments((prev) => prev.filter((x) => x.id !== attachmentId));
  }, []);

  const clearEntryAttachments = useCallback(() => {
    setEntryAttachments([]);
  }, []);

  const handleAttachmentModalSelect = useCallback(async (event) => {
    const target = attachmentModalLog;
    if (!target) return;
    const files = Array.from(event?.target?.files || []);
    if (event?.target) event.target.value = '';
    if (files.length === 0) return;

    const safeList = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        showToast(`"${file.name}" 2 MB sinirini asiyor.`, 'warning');
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        safeList.push(normalizeAttachmentItem({
          id: createAttachmentId(),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
          addedAt: new Date().toISOString()
        }));
      } catch (e) {
        showToast(`"${file.name}" okunamadi.`, 'error');
      }
    }

    if (safeList.length > 0) {
      await addAttachmentsToLog(target, safeList);
      showToast('Dosya eklendi.', 'success');
    }
  }, [attachmentModalLog, addAttachmentsToLog, showToast]);

  const exportAuditLogs = useCallback(() => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        count: auditLogs.length,
        chain: verifyAuditChain(auditLogs),
        logs: auditLogs
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `newsecurityy-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast('Audit export hatasi.', 'error');
    }
  }, [auditLogs, showToast]);

  const clearAuditLogs = useCallback(() => {
    setAuditLogs([]);
    try {
      localStorage.removeItem(ACTION_LOGS_KEY);
    } catch (e) {
      // ignore
    }
    showToast('Audit loglari temizlendi.', 'info');
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbClient.getSetting(ATTACHMENTS_SETTINGS_KEY);
        if (cancelled) return;
        const normalized = normalizeAttachmentMap(saved || {});
        attachmentsRef.current = normalized;
        setAttachmentsByLog(normalized);
      } catch (e) {
        if (!cancelled) {
          attachmentsRef.current = {};
          setAttachmentsByLog({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAuthMe = useCallback(async (token, role = '') => {
    const base = (effectiveLocalApiUrl || '').replace(/\/$/, '');
    if (!base) throw new Error('Yerel API URL tanimli degil.');
    const headers = { 'Content-Type': 'application/json' };
    if (localApiKey?.trim()) headers['X-Api-Key'] = localApiKey.trim();
    headers['Authorization'] = `Bearer ${token}`;
    const suffix = role ? `?role=${encodeURIComponent(role)}` : '';
    const res = await fetch(`${base}/auth/me${suffix}`, { headers });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = payload?.detail || payload?.error || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return payload;
  }, [effectiveLocalApiUrl, localApiKey]);

  const handleRoleLogin = useCallback(async () => {
    if (!localApiAuthUser || !localApiAuthPass) {
      showToast('Kullanici adi ve sifre gerekli.', 'warning');
      return;
    }
    if (!authRole) {
      showToast('Rol seciniz.', 'warning');
      return;
    }

    const username = localApiAuthUser.trim();
    const password = localApiAuthPass;
    const completeFallbackLogin = (reason = '') => {
      const resolvedRole = resolveRoleByAlias(username);
      if (!resolvedRole) throw new Error('Kullanici adi taninmadi.');
      if (resolvedRole !== authRole) throw new Error('Secilen rol ile kullanici adi uyusmuyor.');
      const expectedPassword = ROLE_FALLBACK_PASSWORDS[authRole];
      if (password !== expectedPassword) throw new Error('Kullanici adi veya sifre hatali.');

      const user = buildFallbackSessionUser(authRole);
      setLocalApiToken('');
      setSession({ user });
      localStorage.removeItem(LOCAL_API_TOKEN_KEY);
      localStorage.setItem(LOCAL_ROLE_SESSION_KEY, JSON.stringify({
        user,
        mode: 'supabase',
        reason,
        at: new Date().toISOString(),
      }));
      localStorage.setItem(ACTIVE_ROLE_KEY, user.active_role || authRole);
      setCurrentPage('dashboard');
      setLocalApiAuthPass('');
      showToast('Giris basarili (Supabase modu).', 'success');
      appendActionLog('auth.login', `${user.username || user.email} -> ${user.active_role || authRole}${reason ? ` (${reason})` : ''}`);
    };

    setAuthLoading(true);
    try {
      const base = (effectiveLocalApiUrl || '').replace(/\/$/, '');
      if (!base) {
        completeFallbackLogin('local-api-disabled');
        return;
      }

      const headers = { 'Content-Type': 'application/json' };
      if (localApiKey?.trim()) headers['X-Api-Key'] = localApiKey.trim();

      try {
        const res = await fetch(`${base}/auth/login`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            username,
            password,
            role: authRole,
          }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          let detail = payload?.detail || payload?.error || `HTTP ${res.status}`;
          if (res.status === 403 && Array.isArray(payload?.available_roles) && payload.available_roles.length > 0) {
            detail = `${detail} (roller: ${payload.available_roles.join(', ')})`;
          }
          throw new Error(detail);
        }

        const accessToken = payload?.access;
        const user = payload?.user;
        if (!accessToken || !user) throw new Error('Giris cevabi gecersiz.');

        setLocalApiToken(accessToken);
        setSession({ user });
        localStorage.setItem(LOCAL_API_TOKEN_KEY, accessToken);
        localStorage.removeItem(LOCAL_ROLE_SESSION_KEY);
        localStorage.setItem(ACTIVE_ROLE_KEY, user.active_role || authRole);
        setCurrentPage('dashboard');
        setLocalApiAuthPass('');
        showToast('Giris basarili.', 'success');
        appendActionLog('auth.login', `${user.username || user.email} -> ${user.active_role || authRole}`);
      } catch (apiErr) {
        const apiMsg = apiErr?.message || String(apiErr);
        if (/failed to fetch/i.test(apiMsg) || /networkerror/i.test(apiMsg) || /ecconn/i.test(apiMsg) || /refused/i.test(apiMsg) || /load failed/i.test(apiMsg)) {
          completeFallbackLogin('local-api-unreachable');
          return;
        }
        throw apiErr;
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (/failed to fetch/i.test(msg) || /networkerror/i.test(msg) || /ecconn/i.test(msg) || /refused/i.test(msg)) {
        showToast('Sunucuya baglanilamadi. Sunucu Ayari bolumunden URL/port kontrol edin.', 'error');
        setServerSettingsOpen(true);
      } else {
        showToast(`Giris hatasi: ${msg}`, 'error');
      }
    } finally {
      setAuthLoading(false);
    }
  }, [localApiAuthUser, localApiAuthPass, authRole, effectiveLocalApiUrl, localApiKey, showToast, appendActionLog]);

  const handleRoleLogout = useCallback(() => {
    appendActionLog('auth.logout', 'Kullanici cikis yapti');
    setSession(null);
    setLocalApiToken('');
    setCurrentPage('dashboard');
    try {
      localStorage.removeItem(LOCAL_API_TOKEN_KEY);
      localStorage.removeItem(LOCAL_ROLE_SESSION_KEY);
      localStorage.removeItem(ACTIVE_ROLE_KEY);
    } catch (e) {
      // ignore
    }
    showToast('Cikis yapildi.', 'info');
  }, [appendActionLog, showToast]);

  const loadServerAuditLogs = useCallback(async () => {
    if (!isDeveloperRole) return;
    setServerAuditLoading(true);
    try {
      const data = await localApiFetch('auth/audit?limit=200');
      setServerAuditLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(`Audit log hatasi: ${e?.message || String(e)}`, 'error');
    } finally {
      setServerAuditLoading(false);
    }
  }, [isDeveloperRole, localApiFetch, showToast]);

  const toggleTodaySort = useCallback((key) => {
    setTodaySort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  }, []);

  const toggleReportSort = useCallback((key) => {
    setReportSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  }, []);

  const refreshSyncStatus = useCallback(() => {
    try {
      const nextStatus = getSyncStatus() || {};
      setSyncStatus((prev) => (areObjectsEqual(prev, nextStatus) ? prev : nextStatus));
    } catch (e) {
      setSyncStatus((prev) => (areObjectsEqual(prev, {}) ? prev : {}));
    }
  }, []);

  const refreshBackupStatus = useCallback(async () => {
    try {
      if (window?.electronAPI?.backup) {
        const status = await window.electronAPI.backup.getStatus();
        const nextStatus = status || null;
        setBackupStatus((prev) => (areObjectsEqual(prev, nextStatus) ? prev : nextStatus));
      }
    } catch (e) {
      setBackupStatus((prev) => (prev === null ? prev : null));
    }
  }, []);

  const refreshEmailSchedulerStatus = useCallback(async () => {
    try {
      if (window?.electronAPI?.scheduler?.getStatus) {
        const status = await window.electronAPI.scheduler.getStatus();
        const nextStatus = status || null;
        setEmailSchedulerStatus((prev) => (areObjectsEqual(prev, nextStatus) ? prev : nextStatus));
      }
    } catch (e) {
      setEmailSchedulerStatus((prev) => (prev === null ? prev : null));
    }
  }, []);

  const formatSyncTime = useCallback((iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, []);

  const setLogsIfChanged = useCallback((activeRows, allRows) => {
    const normalizedActive = normalizeLogList(activeRows || []);
    const normalizedAll = normalizeLogList(allRows || []);

    setActiveLogs((prev) => (areLogListsEqual(prev, normalizedActive) ? prev : normalizedActive));
    setAllLogs((prev) => (areLogListsEqual(prev, normalizedAll) ? prev : normalizedAll));
  }, []);

  const applyLocalLogUpsert = useCallback((logLike, { includeInActive = false } = {}) => {
    const normalizedLog = normalizeLogText(logLike);
    if (!normalizedLog) return;

    setAllLogs((prev) => upsertLogInList(prev, normalizedLog));
    if (includeInActive && !normalizedLog.exit_at) {
      setActiveLogs((prev) => upsertLogInList(prev, normalizedLog));
    }
  }, []);

  const applyLocalExitState = useCallback((id, updateData = {}, fallbackLog = null) => {
    const fallbackCreatedAt = fallbackLog?.created_at || null;

    setActiveLogs((prev) => normalizeLogList(
      (Array.isArray(prev) ? prev : []).filter((log) => {
        if (id !== undefined && id !== null && log?.id === id) return false;
        if (fallbackCreatedAt && log?.created_at === fallbackCreatedAt) return false;
        return true;
      })
    ));

    setAllLogs((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const existing = current.find((log) => (
        (id !== undefined && id !== null && log?.id === id)
        || (fallbackCreatedAt && log?.created_at === fallbackCreatedAt)
      ));
      const baseLog = existing || fallbackLog;
      if (!baseLog) return current;
      const mergedLog = normalizeLogText({ ...baseLog, ...updateData });
      return upsertLogInList(current, mergedLog);
    });
  }, []);

  const readCsvFile = useCallback(async (file) => {
    const [buffer, text] = await Promise.all([file.arrayBuffer(), file.text()]);
    let rows = [];
    try {
      const workbook = XLSX.read(buffer, { type: 'array', raw: true, cellDates: true });
      const sheet = workbook?.Sheets?.[workbook?.SheetNames?.[0]];
      rows = sheet
        ? XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, cellDates: true })
        : [];
    } catch (e) {
      rows = [];
    }

    if (needsPlainCsvFallback(rows)) {
      const fallbackRows = parseCsvTextLoose(text);
      if (fallbackRows.length > 0) return fallbackRows;
    }

    return rows;
  }, []);

  const handleImportFileChange = useCallback((event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportFileName(file.name);
    setImportResult(null);
    setImportError('');
  }, []);

  const runCsvImport = useCallback(async () => {
    if (!importFile) {
      showToast('Lütfen CSV dosyası seçin.', 'error');
      return;
    }

    setImporting(true);
    setImportResult(null);
    setImportError('');
    try {
      const rows = await readCsvFile(importFile);
      const mappedLogs = rows.map(mapCsvRowToLog).filter((row) => row?.created_at);
      const { uniqueLogs: logs, duplicateCount } = dedupeLogsByCreatedAt(mappedLogs);
      const invalidCount = Math.max(0, rows.length - mappedLogs.length) + duplicateCount;
      setImportProgress({ processed: 0, total: logs.length });

      if (logs.length === 0) {
        showToast('CSV içinde geçerli kayıt bulunamadı.', 'error');
        setImporting(false);
        return;
      }

      let result = null;
      if (isElectron && window?.electronAPI?.db) {
        if (window?.electronAPI?.db?.importLogs) {
          result = await window.electronAPI.db.importLogs(logs);
        } else {
          let inserted = 0;
          let updated = 0;
          let invalid = 0;
          let errors = 0;
          for (let i = 0; i < logs.length; i += 1) {
            const row = logs[i];
            if (!row?.created_at) {
              invalid += 1;
              continue;
            }
            try {
              await window.electronAPI.db.upsertLogByCreatedAt(row);
              updated += 1;
            } catch (e) {
              errors += 1;
            }
            if ((i + 1) % 100 === 0 || i + 1 === logs.length) {
              setImportProgress({ processed: i + 1, total: logs.length });
            }
          }
          result = { success: true, total: logs.length, inserted, updated, invalid, errors };
        }
      } else {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          showToast('CSV içe aktarma için internet bağlantısı gerekli.', 'error');
          setImporting(false);
          return;
        }

        const chunkSize = 100;
        let inserted = 0;
        let updated = 0;
        let errors = 0;
        let lastErrorMessage = '';

        for (let i = 0; i < logs.length; i += chunkSize) {
          const chunk = logs.slice(i, i + chunkSize);
          const createdAtList = Array.from(
            new Set(chunk.map((row) => row?.created_at).filter(Boolean))
          );
          let existingSet = new Set();
          let existingLookupReady = false;

          // Çok uzun URL hatalarını azaltmak için bu lookup'u küçük parçada tut.
          if (createdAtList.length > 0 && createdAtList.length <= 120) {
            const { data: existing, error: existingError } = await supabase
              .from('security_logs')
              .select('created_at')
              .in('created_at', createdAtList);
            if (!existingError && Array.isArray(existing)) {
              existingSet = new Set(existing.map((row) => row.created_at));
              existingLookupReady = true;
            }
          }

          const chunkResult = await upsertChunkWithRetry(chunk);
          const successRows = chunkResult.successRows || [];
          const errorRows = chunkResult.errorRows || [];

          if (errorRows.length > 0) {
            errors += errorRows.length;
            lastErrorMessage = chunkResult.lastError || lastErrorMessage;
          } else {
            if (existingLookupReady) {
              inserted += successRows.filter((row) => !existingSet.has(row.created_at)).length;
              updated += successRows.filter((row) => existingSet.has(row.created_at)).length;
            } else {
              inserted += successRows.length;
            }
          }

          setImportProgress({ processed: Math.min(i + chunkSize, logs.length), total: logs.length });
        }

        result = {
          success: errors === 0,
          total: logs.length,
          inserted,
          updated,
          invalid: invalidCount,
          errors
        };

        if (errors > 0 && lastErrorMessage) {
          setImportError(lastErrorMessage);
        }
      }

      if (result && result.invalid === undefined) {
        result.invalid = invalidCount;
      }

      setImportResult(result);
      setImportProgress({ processed: logs.length, total: logs.length });
      if (result?.success === false) {
        showToast('CSV içe aktarma hatası.', 'error');
      } else {
        showToast(`İçe aktarma tamamlandı. ${result?.inserted || 0} eklendi, ${result?.updated || 0} güncellendi.`, 'success');
      }

      if (isElectron) {
        const [activeData, allData] = await Promise.all([
          dbClient.getActiveLogs(),
          dbClient.getAllLogs(localDbFetchLimit)
        ]);
        setLogsIfChanged(activeData, allData);
      } else {
        const [activeResult, allResult] = await Promise.all([
          supabase.from('security_logs').select('*').is('exit_at', null).order('created_at', { ascending: false }),
          supabase.from('security_logs').select('*').order('created_at', { ascending: false }).limit(remoteFetchLimit)
        ]);
        setLogsIfChanged(activeResult?.data || [], allResult?.data || []);
      }
    } catch (e) {
      const message = e?.message || String(e);
      setImportError(message);
      showToast('CSV içe aktarma hatası.', 'error');
    } finally {
      setImporting(false);
    }
  }, [importFile, readCsvFile, showToast, localDbFetchLimit, remoteFetchLimit, setLogsIfChanged]);

  const checkOnlineStatus = useCallback(async () => {
    const now = new Date().toISOString();
    try {
      const { error } = await supabase.from('security_logs').select('id').limit(1);
      if (error) {
        setSupabaseDebug({ lastError: error.message || String(error), lastCheckedAt: now });
        return false;
      }
      setSupabaseDebug({ lastError: null, lastCheckedAt: now });
      return true;
    } catch (e) {
      setSupabaseDebug({ lastError: e?.message || String(e), lastCheckedAt: now });
      return false;
    }
  }, []);

  const checkPendingData = useCallback(() => {
    try {
      const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
      setPendingCount(queue.length);
    } catch (error) {
      setPendingCount(0);
    }
  }, []);

  const saveToOfflineQueue = useCallback((data, action = 'INSERT', id = null, localId = null) => {
    try {
      const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
      const resolvedLocalId = localId || data?.created_at || null;
      if (action === 'INSERT' && resolvedLocalId) {
        const alreadyQueued = queue.some((item) => (
          (item?.action || 'INSERT') === 'INSERT'
          && (item?.localId || item?.data?.created_at || null) === resolvedLocalId
        ));
        if (alreadyQueued) {
          checkPendingData();
          return;
        }
      }
      queue.push({ action, data, id, localId: resolvedLocalId, _offlineTimestamp: Date.now() });
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      checkPendingData();
      showToast(action === 'DELETE' ? "Silme işlemi hafızaya alındı." : "İnternet yok. İşlem hafızaya alındı!", "warning");
      if (action === 'UPDATE' && id) {
        const isExitUpdate = !!data?.exit_at;
        if (isExitUpdate) {
          setActiveLogs(prev => prev.filter(log => log.id !== id));
        } else {
          setActiveLogs(prev => prev.map(log => log.id === id ? { ...log, ...data } : log));
        }
        setAllLogs(prev => {
          const mapped = prev.map(log => log.id === id ? { ...log, ...data } : log);
          return data?.created_at ? upsertLogInList(mapped, { ...data, id }) : mapped;
        });
      } else if (action === 'DELETE' && id) {
        setActiveLogs(prev => prev.filter(log => log.id !== id));
        setAllLogs(prev => prev.filter(log => log.id !== id));
      }
      if (canUseLocalApi) {
        void backupToLocalApi(action, data, resolvedLocalId);
      }
    } catch (error) {
      showToast("Offline kayıt hatası!", "error");
    }
  }, [checkPendingData, showToast, backupToLocalApi, canUseLocalApi]);

  const fetchData = useCallback(async () => {
    if (!session) return;
    if (fetchInFlightRef.current) {
      queuedFetchRef.current = true;
      return;
    }
    fetchInFlightRef.current = true;
    try {
      // Electron ortamında yerel SQLite kullan
      if (isElectron) {
        const [activeData, allData] = await Promise.all([
          dbClient.getActiveLogs(),
          dbClient.getAllLogs(localDbFetchLimit)
        ]);
        if (!isMountedRef.current) return;
        setLogsIfChanged(activeData, allData);
      } else {
        // Web ortamında Supabase kullan
        if (!isOnline) return;
        const [activeResult, allResult] = await Promise.all([
          supabase.from('security_logs').select('*').is('exit_at', null).order('created_at', { ascending: false }),
          supabase.from('security_logs').select('*').order('created_at', { ascending: false }).limit(remoteFetchLimit)
        ]);
        if (!isMountedRef.current) return;
        if (activeResult.data || allResult.data) {
          setLogsIfChanged(activeResult.data || [], allResult.data || []);
        }
      }
    } catch (error) {
      if (isMountedRef.current) showToast("Veri çekme hatası!", "error");
    } finally {
      fetchInFlightRef.current = false;
      if (queuedFetchRef.current && isMountedRef.current) {
        queuedFetchRef.current = false;
        setTimeout(() => {
          if (isMountedRef.current) {
            fetchData();
          }
        }, 0);
      }
    }
  }, [session, isOnline, showToast, localDbFetchLimit, remoteFetchLimit, setLogsIfChanged]);

  const syncOfflineData = useCallback(async () => {
    try {
      const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
      if (queue.length === 0) return;
      const newQueue = [];
      let successCount = 0;
      let failCount = 0;

      for (const item of queue) {
        try {
          const action = item.action || 'INSERT';
          const data = item.data || item;
          const id = item.id;
          const { _offlineTimestamp, _syncAttempts, ...cleanData } = data || {};
          let error = null;

          if (action === 'INSERT' && cleanData) {
            const { error: e } = await supabase.from('security_logs').insert([pickSupabaseCompatibleLog(cleanData)]);
            error = e;
          } else if (action === 'UPDATE' && id && cleanData) {
            const { error: e } = await supabase.from('security_logs').update(pickSupabaseCompatibleLog(cleanData)).eq('id', id);
            error = e;
          } else if (action === 'DELETE' && id) {
            const { error: e } = await supabase.from('security_logs').delete().eq('id', id);
            error = e;
          }

          if (error) {
            const attempts = (item._syncAttempts || 0) + 1;
            if (attempts < 5) newQueue.push({ ...item, _syncAttempts: attempts });
            else failCount++;
          } else {
            successCount++;
          }
        } catch (e) {
          const attempts = (item._syncAttempts || 0) + 1;
          if (attempts < 5) newQueue.push({ ...item, _syncAttempts: attempts });
          else failCount++;
        }
      }

      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(newQueue));
      checkPendingData();
      if (successCount > 0) { showToast(`${successCount} işlem senkronize edildi!`, "success"); fetchData(); }
      if (failCount > 0) showToast(`${failCount} işlem başarısız oldu.`, "warning");
    } catch (error) {
      console.error('Sync error:', error);
    }
  }, [checkPendingData, fetchData, showToast]);

  const resetForm = useCallback(() => {
    setFormData({ plate: '', driver: '', driver_type: 'owner', name: '', host: '', note: '', entry_location: '', exit_location: '', seal_number_entry: '', seal_number_exit: '', tc_no: '', phone: '' });
    setPlateHistory(null);
    setShowManagementList(false);
    setShowStaffList(false);
    setShowHostStaffList(false);
    setHostSearchTerm('');
    setIsCustomHost(false);
    clearEntryAttachments();
  }, [clearEntryAttachments]);

  // --- ÇIKIŞ FONKSİYONU ---
  const handleExit = useCallback(async (id, sealNo, additionalData = {}) => {
    if (!id) { showToast("Geçersiz kayıt ID'si!", "error"); return; }
    const existingLog = activeLogs.find(l => l.id === id) || allLogs.find(l => l.id === id) || null;
    setActionLoading(id);

    try {
      const updateData = { exit_at: new Date().toISOString(), ...additionalData };
      if (sealNo) {
        updateData.seal_number_exit = sealNo;
        if (existingLog?.seal_number_entry) {
          updateData.seal_number = `Giriş: ${existingLog.seal_number_entry} / Çıkış: ${sealNo}`;
        }
      }

      // Electron ortamında yerel SQLite kullan
      if (isElectron) {
        await dbClient.exitLog(id, updateData);
        applyLocalExitState(id, updateData, existingLog);
        showToast("Çıkış işlemi tamamlandı.", "success");
        await fetchData();
      } else {
        // Web ortamında Supabase kullan
        const reallyOnline = await checkOnlineStatus();
        setIsOnline(reallyOnline);

        if (!reallyOnline) {
          saveToOfflineQueue(existingLog?.created_at ? { ...updateData, created_at: existingLog.created_at } : updateData, 'UPDATE', id);
          applyLocalExitState(id, updateData, existingLog);
          setActionLoading(null);
          return;
        }

        const { error } = await supabase.from('security_logs').update(pickSupabaseCompatibleLog(updateData)).eq('id', id);
        if (error) {
          showToast(`Çıkış hatası: ${error.message}`, "error");
        } else {
          showToast("Çıkış işlemi tamamlandı.", "success");
          applyLocalExitState(id, updateData, existingLog);
          await fetchData();
        }
      }
    } catch (error) {
      showToast(`Hata: ${error.message}`, "error");
    } finally {
      setActionLoading(null);
    }
  }, [activeLogs, allLogs, applyLocalExitState, checkOnlineStatus, fetchData, saveToOfflineQueue, showToast]);

  // --- GİRİŞ FONKSİYONU ---
  const handleEntry = useCallback(async () => {
    if (mainTab === 'vehicle' && !formData.plate) return showToast("Plaka giriniz!", "error");
    if (mainTab === 'visitor' && !formData.name) return showToast("İsim seçiniz/giriniz!", "error");
    if ((vehicleSubTab === 'company' || vehicleSubTab === 'service') && vehicleDirection === 'Giriş' && !formData.entry_location) return showToast("Lokasyon giriniz!", "error");
    if ((vehicleSubTab === 'management' || vehicleSubTab === 'company') && vehicleDirection === 'Giriş' && formData.driver_type !== 'owner' && !formData.driver) return showToast("Aracı kullanan kişinin adını giriniz!", "error");
    // MÜHÜR NUMARASI ARTIK OPSİYONEL - Zorunlu değil!
    // if (vehicleSubTab === 'sealed' && vehicleDirection === 'Giriş' && !formData.seal_number_entry) return showToast("Giriş Mühür No giriniz!", "error");
    if (formData.tc_no && formData.tc_no !== 'BELİRTİLMEDİ' && !isValidTC(formData.tc_no)) return showToast("Geçersiz TC Kimlik No!", "error");

    const isHostRequired = !(mainTab === 'visitor' && visitorSubTab === 'staff');
    if (isHostRequired && vehicleDirection === 'Giriş' && !formData.host) return showToast("İlgili birimi/kişiyi seçiniz.", "error");

    // Çıkış işlemi
    if (vehicleDirection === 'Çıkış') {
      const searchValue = mainTab === 'vehicle' ? formData.plate.toUpperCase() : formData.name.toUpperCase();
      const existingLog = activeLogs.find(log => (mainTab === 'vehicle' && log.plate === searchValue) || (mainTab === 'visitor' && log.name === searchValue));

      if (existingLog) {
        if (existingLog.sub_category === 'Mühürlü Araç') {
          setExitingLogData(existingLog);
          setExitSealNumber('');
          setExitSealModalOpen(true);
          return;
        }

        const extraData = {};
        // Tüm çıkışlarda lokasyon bilgisini kaydet
        if (formData.exit_location) {
          extraData.exit_location = sanitizeInput(formData.exit_location);
          extraData.location = buildLegacyLocationValue(getEntryLocation(existingLog), extraData.exit_location);
        }
        if (mainTab === 'vehicle') {
          if (vehicleSubTab === 'management') {
            if (formData.driver_type !== 'owner' && formData.driver_type) {
              const labels = { driver: 'Şoför', supervisor: 'Vardiya Amiri', other: 'Diğer' };
              extraData.driver = `[${labels[formData.driver_type] || 'Diğer'}] ${sanitizeInput(formData.driver)}`;
            } else {
              extraData.driver = sanitizeInput(formData.driver);
            }
          }
        }

        setConfirmModal({
          isOpen: true,
          title: 'Çıkış Onayı',
          message: `${searchValue} için çıkış işlemini onaylıyor musunuz?${extraData.exit_location ? `\nGidilen: ${extraData.exit_location}` : ''}`,
          type: 'warning',
          onConfirm: async () => {
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
            await handleExit(existingLog.id, null, extraData);
            resetForm();
          }
        });
        return;
      } else {
        // Araç/kişi içeride görünmüyorsa çıkış yapılamaz
        showToast("HATA: Bu araç/kişi içeride görünmüyor! Önce giriş kaydı yapılmalı.", "error");
        return;
      }
    }

    // Giriş kontrolü - Veritabanından anlık kontrol yap
    if (vehicleDirection === 'Giriş') {
      const searchValue = mainTab === 'vehicle' ? formData.plate.toUpperCase() : formData.name.toUpperCase();

      // Önce local kontrolü yap
      const existingLocalRecord = activeLogs.find(log =>
        (mainTab === 'vehicle' && log.plate === searchValue) ||
        (mainTab === 'visitor' && log.name === searchValue)
      );

      if (existingLocalRecord) {
        setConfirmModal({
          isOpen: true,
          title: '⚠️ Araç/Kişi Zaten İçeride!',
          message: `${searchValue} aktif listede içeride görünüyor.\n\nBu kayıt geçmişten kalmış açık kayıt olabilir.\nÖnce çıkış yaptırılsın mı?`,
          type: 'warning',
          confirmLabel: 'Çıkış Yaptır',
          cancelLabel: 'Vazgeç',
          confirmVariant: 'destructive',
          onConfirm: async () => {
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
            await handleExit(existingLocalRecord.id, null, {});
            showToast(`${searchValue} için açık kayıt kapatıldı. Girişi tekrar kaydedebilirsiniz.`, "info");
          }
        });
        return;
      }

      // Veritabanından da kontrol et (senkronizasyon hatalarını önlemek için)
      try {
        // Electron ortamında yerel veritabanını kontrol et
        if (isElectron) {
          const activeData = await dbClient.getActiveLogs();
          const existingRecords = activeData.filter(log =>
            (mainTab === 'vehicle' && log.plate === searchValue) ||
            (mainTab === 'visitor' && log.name === searchValue)
          );

          if (existingRecords && existingRecords.length > 0) {
            setConfirmModal({
              isOpen: true,
              title: '⚠️ Araç/Kişi Zaten İçeride!',
              message: `${searchValue} veritabanında içeride görünüyor!\n\nBu kayıt için çıkış işlemi yapmak ister misiniz?`,
              type: 'warning',
              onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                await handleExit(existingRecords[0].id, null, {});
                showToast(`${searchValue} çıkış yaptırıldı.`, "success");
                fetchData();
              }
            });
            return;
          }
        } else {
          // Web ortamında Supabase kontrolü
          const reallyOnline = await checkOnlineStatus();
          if (reallyOnline) {
            let dbQuery = supabase.from('security_logs').select('id, plate, name').is('exit_at', null);

            if (mainTab === 'vehicle') {
              dbQuery = dbQuery.eq('plate', searchValue);
            } else {
              dbQuery = dbQuery.eq('name', searchValue);
            }

            const { data: existingRecords } = await dbQuery;

            if (existingRecords && existingRecords.length > 0) {
              // Varolan kaydı çıkış yapmak isteyip istemediğini sor
              setConfirmModal({
                isOpen: true,
                title: '⚠️ Araç/Kişi Zaten İçeride!',
                message: `${searchValue} veritabanında içeride görünüyor!\n\nBu kayıt için çıkış işlemi yapmak ister misiniz?`,
                type: 'warning',
                onConfirm: async () => {
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  await handleExit(existingRecords[0].id, null, {});
                  showToast(`${searchValue} çıkış yaptırıldı.`, "success");
                  fetchData();
                }
              });
              return;
            }
          }
        }
      } catch (error) {
        console.error('DB check error:', error);
        // Hata durumunda devam et, local kontrol yeterli
      }
    }

    setLoading(true);

    let subCategory = 'Genel';
    if (mainTab === 'vehicle') {
      const map = { guest: 'Misafir Araç', staff: 'Personel Aracı', management: 'Yönetim Aracı', service: 'Servis Aracı', sealed: 'Mühürlü Araç', company: 'Şirket Aracı' };
      subCategory = map[vehicleSubTab] || 'Genel';
    } else {
      const map = { guest: 'Misafir', staff: 'Fabrika Personeli', 'ex-staff': 'İşten Ayrılan' };
      subCategory = map[visitorSubTab] || 'Misafir';
    }

    const isExitLog = vehicleDirection === 'Çıkış';
    const entryLocation = sanitizeInput(formData.entry_location);
    const exitLocation = sanitizeInput(formData.exit_location);
    let driverInfo = null;
    if (mainTab === 'vehicle') {
      if (formData.driver_type !== 'owner' && formData.driver_type) {
        const labels = { driver: 'Şoför', supervisor: 'Vardiya Amiri', other: 'Diğer' };
        driverInfo = `[${labels[formData.driver_type] || 'Diğer'}] ${sanitizeInput(formData.driver)}`;
      } else {
        driverInfo = sanitizeInput(formData.driver);
      }
    }

    const newLog = {
      type: mainTab,
      sub_category: subCategory,
      shift: currentShift,
      plate: mainTab === 'vehicle' ? sanitizeInput(formData.plate).toUpperCase() : null,
      driver: driverInfo,
      name: mainTab === 'visitor' ? sanitizeInput(formData.name) : null,
      host: (mainTab === 'visitor' && visitorSubTab === 'staff') ? 'Fabrika' : sanitizeInput(formData.host),
      note: sanitizeInput(formData.note),
      location: buildLegacyLocationValue(entryLocation, isExitLog ? exitLocation : ''),
      entry_location: entryLocation,
      exit_location: isExitLog ? exitLocation : null,
      seal_number_entry: vehicleSubTab === 'sealed' ? sanitizeInput(formData.seal_number_entry) : null,
      seal_number_exit: null,
      seal_number: vehicleSubTab === 'sealed' ? sanitizeInput(formData.seal_number_entry) : null,
      tc_no: formData.tc_no || null,
      phone: formData.phone || null,
      user_email: session?.user?.email || 'local_user',
      created_at: new Date().toISOString(),
      exit_at: isExitLog ? new Date().toISOString() : null
    };

    try {
      // Electron ortamında yerel SQLite kullan
      if (isElectron) {
        const savedLog = await dbClient.insertLog(newLog);
        applyLocalLogUpsert({ ...newLog, ...(savedLog || {}) }, { includeInActive: !isExitLog });
        showToast(isExitLog ? "Çıkış Kaydedildi" : "Giriş Kaydedildi");
        resetForm();
        fetchData();
      } else {
        // Web ortamında Supabase kullan
        const reallyOnline = await checkOnlineStatus();
        setIsOnline(reallyOnline);

        if (!reallyOnline) {
          saveToOfflineQueue(newLog);
          applyLocalLogUpsert(newLog, { includeInActive: !isExitLog });
          resetForm();
          setLoading(false);
          return;
        }

        const { error } = await supabase.from('security_logs').insert([pickSupabaseCompatibleLog(newLog)]);
        if (error) {
          saveToOfflineQueue(newLog);
          applyLocalLogUpsert(newLog, { includeInActive: !isExitLog });
          resetForm();
        } else {
          showToast(isExitLog ? "Çıkış Kaydedildi" : "Giriş Kaydedildi");
          resetForm();
          applyLocalLogUpsert(newLog, { includeInActive: !isExitLog });
          fetchData();
        }
      }
    } catch (error) {
      if (!isElectron) {
        saveToOfflineQueue(newLog);
        applyLocalLogUpsert(newLog, { includeInActive: !isExitLog });
        resetForm();
      } else {
        showToast(`Hata: ${error.message}`, "error");
      }
    } finally {
      setLoading(false);
    }
  }, [mainTab, vehicleSubTab, visitorSubTab, vehicleDirection, formData, activeLogs, currentShift, session, checkOnlineStatus, saveToOfflineQueue, resetForm, fetchData, showToast, handleExit, applyLocalLogUpsert]);

  const confirmSealedExit = useCallback(async () => {
    if (!exitSealNumber?.trim()) return showToast("Lütfen Çıkış Mühür Numarasını Giriniz!", "error");
    if (!exitingLogData?.id) return showToast("Geçersiz kayıt!", "error");
    await handleExit(exitingLogData.id, sanitizeInput(exitSealNumber));
    setExitSealModalOpen(false);
    setExitingLogData(null);
    setExitSealNumber('');
    resetForm();
  }, [exitSealNumber, exitingLogData, handleExit, showToast, resetForm]);

  const handleDelete = useCallback(async (id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Kayıt Silme',
      message: 'Bu kaydı kalıcı olarak silmek istediğinize emin misiniz?\n\nBu işlem geri alınamaz!',
      type: 'danger',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        try {
          setActionLoading(id);
          // Electron ortamında yerel SQLite kullan
          if (isElectron) {
            await dbClient.deleteLog(id);
            showToast("Kayıt silindi.", "success");
            fetchData();
            setEditingLog(null);
          } else {
            // Web ortamında Supabase kullan
            if (!isOnline) {
              saveToOfflineQueue(null, 'DELETE', id);
              setEditingLog(null);
              return;
            }
            const { error } = await supabase.from('security_logs').delete().eq('id', id);
            if (!error) { showToast("Kayıt silindi.", "success"); fetchData(); setEditingLog(null); }
            else showToast("Silme hatası!", "error");
          }
        } catch (error) {
          showToast("Bağlantı hatası!", "error");
        } finally {
          setActionLoading(null);
        }
      }
    });
  }, [isOnline, saveToOfflineQueue, fetchData, showToast]);

  const handleUpdate = useCallback(async () => {
    const normalizedEditEntryLocation = sanitizeInput(editForm.entry_location);
    const normalizedEditExitLocation = sanitizeInput(editForm.exit_location);
    const updateData = {
      plate: sanitizeInput(editForm.plate), driver: sanitizeInput(editForm.driver), name: sanitizeInput(editForm.name),
      host: sanitizeInput(editForm.host), note: sanitizeInput(editForm.note),
      location: buildLegacyLocationValue(normalizedEditEntryLocation, normalizedEditExitLocation),
      entry_location: normalizedEditEntryLocation,
      exit_location: normalizedEditExitLocation,
      seal_number: sanitizeInput(editForm.seal_number), seal_number_entry: sanitizeInput(editForm.seal_number_entry),
      seal_number_exit: sanitizeInput(editForm.seal_number_exit), shift: editForm.shift, tc_no: editForm.tc_no,
      phone: editForm.phone, created_at: editForm.created_at, exit_at: editForm.exit_at
    };

    try {
      setActionLoading(editingLog.id);
      // Electron ortamında yerel SQLite kullan
      if (isElectron) {
        await dbClient.updateLog(editingLog.id, updateData);
        showToast("Güncellendi.");
        setEditingLog(null);
        fetchData();
      } else {
        // Web ortamında Supabase kullan
        if (!isOnline) {
          saveToOfflineQueue(updateData, 'UPDATE', editingLog.id);
          setEditingLog(null);
          return;
        }
        const { error } = await supabase.from('security_logs').update(pickSupabaseCompatibleLog(updateData)).eq('id', editingLog.id);
        if (!error) { showToast("Güncellendi."); setEditingLog(null); fetchData(); }
        else showToast("Güncelleme hatası!", "error");
      }
    } catch (error) {
      showToast("Bağlantı hatası!", "error");
    } finally {
      setActionLoading(null);
    }
  }, [editForm, editingLog, isOnline, saveToOfflineQueue, fetchData, showToast]);

  const _handleLogin = useCallback(async (e) => { // eslint-disable-line no-unused-vars
    e.preventDefault();
    setLoginError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setLoginError("E-posta veya şifre hatalı.");
    } catch (error) {
      setLoginError("Bağlantı hatası. Lütfen tekrar deneyin.");
    }
  }, [email, password]);

  const _handleLogout = useCallback(async () => { // eslint-disable-line no-unused-vars
    try { await supabase.auth.signOut(); setEmail(""); setPassword(""); } catch (error) { }
  }, []);

  const handleQuickExit = useCallback(async (log) => {
    if (actionLoading) return;
    if (log.sub_category === 'Mühürlü Araç') {
      setExitingLogData(log);
      setExitSealNumber('');
      setExitSealModalOpen(true);
      return;
    }
    const identifier = log.plate || log.name;
    setConfirmModal({
      isOpen: true,
      title: 'Çıkış Onayı',
      message: `${identifier} için çıkış işlemini onaylıyor musunuz?`,
      type: 'warning',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        const shouldUseLegacyQuickExit = window?.electronAPI?.__useLegacyQuickExit === true;
        if (!shouldUseLegacyQuickExit) {
          await handleExit(log.id);
          return;
        }
        try {
          setActionLoading(log.id);
          // Electron ortamında yerel SQLite kullan
          if (isElectron) {
            await dbClient.exitLog(log.id, { exit_at: new Date().toISOString() });
            showToast(`✅ ${identifier} çıkış yaptı!`, "success");
            fetchData();
          } else {
            // Web ortamında Supabase kullan
            const reallyOnline = await checkOnlineStatus();
            setIsOnline(reallyOnline);
            if (!reallyOnline) { showToast("Çıkış işlemi için internet bağlantısı gerekir.", "error"); return; }
            const { error } = await supabase.from('security_logs').update(pickSupabaseCompatibleLog({ exit_at: new Date().toISOString() })).eq('id', log.id);
            if (error) showToast(`Çıkış hatası: ${error.message}`, "error");
            else { showToast(`✅ ${identifier} çıkış yaptı!`, "success"); fetchData(); }
          }
        } catch (error) {
          showToast(`Hata: ${error.message}`, "error");
        } finally {
          setActionLoading(null);
        }
      }
    });
  }, [actionLoading, checkOnlineStatus, fetchData, showToast, handleExit]);

  const quickEntry = useCallback(async (plate, category, host) => {
    if (loading) return;
    const normalizedPlate = plate.toUpperCase();
    const isInside = activeLogs.some(log => log.plate === normalizedPlate);
    if (isInside) { showToast(`${normalizedPlate} zaten içerde!`, "error"); return; }

    setConfirmModal({
      isOpen: true, title: 'Hızlı Giriş', message: `${normalizedPlate} için hızlı giriş yapılsın mı?`, type: 'info',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setLoading(true);
        const newLog = { type: 'vehicle', sub_category: category, shift: currentShift, plate: normalizedPlate, driver: null, name: null, host, note: 'Hızlı giriş', user_email: session?.user?.email || 'local_user', created_at: new Date().toISOString(), exit_at: null };
        try {
          // Electron ortamında yerel SQLite kullan
          if (isElectron) {
            await dbClient.insertLog(newLog);
            showToast(`${normalizedPlate} girişi kaydedildi`, "success");
            fetchData();
          } else {
            // Web ortamında Supabase kullan
            const { error } = await supabase.from('security_logs').insert([pickSupabaseCompatibleLog(newLog)]);
            if (error) showToast("Hata: " + error.message, "error");
            else { showToast(`${normalizedPlate} girişi kaydedildi`, "success"); fetchData(); }
          }
        } catch (error) {
          showToast("Bağlantı hatası!", "error");
        } finally {
          setLoading(false);
        }
      }
    });
  }, [loading, activeLogs, currentShift, session, fetchData, showToast]);

  // --- HIZLI TEKRAR GİRİŞ FONKSİYONU ---
  const handleReEntry = useCallback(async (log) => {
    if (loading || actionLoading) return;
    const identifier = log.plate || log.name;
    const isInside = activeLogs.some(l => (log.plate && l.plate === log.plate) || (log.name && l.name === log.name));
    if (isInside) return showToast(`${identifier} zaten içeride!`, "error");

    setConfirmModal({
      isOpen: true,
      title: 'Hızlı Tekrar Giriş',
      message: `${identifier} için tekrar giriş işlemi yapılsın mı?\n\nBilgiler önceki kayıttan kopyalanacak.`,
      type: 'info',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setActionLoading(log.id);

        const newLog = {
          type: log.type,
          sub_category: log.sub_category,
          shift: currentShift,
          plate: log.plate,
          driver: log.driver,
          name: log.name,
          host: log.host,
          location: getEntryLocation(log) || log.location,
          entry_location: getEntryLocation(log),
          exit_location: null,
          note: log.note ? `[Tekrar Giriş] ${log.note}` : 'Tekrar Giriş',
          tc_no: log.tc_no,
          phone: log.phone,
          seal_number_entry: null,
          seal_number: null,
          user_email: session?.user?.email || 'local_user',
          created_at: new Date().toISOString(),
          exit_at: null
        };

        try {
          // Electron ortamında yerel SQLite kullan
          if (isElectron) {
            await dbClient.insertLog(newLog);
            showToast(`✅ ${identifier} tekrar giriş yaptı!`, "success");
            fetchData();
          } else {
            // Web ortamında Supabase kullan
            const { error } = await supabase.from('security_logs').insert([pickSupabaseCompatibleLog(newLog)]);
            if (error) {
              showToast("Hata: " + error.message, "error");
            } else {
              showToast(`✅ ${identifier} tekrar giriş yaptı!`, "success");
              fetchData();
            }
          }
        } catch (error) {
          showToast("Bağlantı hatası!", "error");
        } finally {
          setActionLoading(null);
        }
      }
    });
  }, [loading, actionLoading, activeLogs, currentShift, session, fetchData, showToast]);

  const exportToExcel = useCallback(() => {
    try {
      if (filteredLogs.length === 0) return showToast("Veri yok", "error");
      const exportData = filteredLogs.map(log => ({
        Tarih: new Date(log.created_at).toLocaleDateString('tr-TR'), Vardiya: log.shift, Kategori: log.sub_category,
        'Plaka/İsim': log.plate || log.name, 'Sürücü': log.driver || '-', 'İlgili Birim': log.host,
        Lokasyon: formatLogLocation(log) || '-', 'TC Kimlik': log.tc_no || '-', Telefon: log.phone || '-',
        Açıklama: log.note || '-', 'Giriş Mührü': log.seal_number_entry || '-', 'Çıkış Mührü': log.seal_number_exit || '-',
        'Giriş Saati': new Date(log.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        'Çıkış Saati': log.exit_at ? new Date(log.exit_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'İÇERİDE'
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Rapor");
      XLSX.writeFile(wb, `Guvenlik_Raporu_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.xlsx`);
      showToast("Excel dosyası indirildi!", "success");
    } catch (error) {
      showToast("Excel oluşturma hatası!", "error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

const sendDailyReport = useCallback((dateParam) => {
    setConfirmModal({
      isOpen: true,
      title: 'Rapor Gönderimi',
      message: `${new Date(dateParam).toLocaleDateString('tr-TR')} tarihli rapor hazırlanacak.\n\n${isElectron ? 'E-posta yerel SMTP üzerinden gönderilecek.' : 'Excel raporu indirilecek.'}`,
      type: 'info',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setSendingReport(true);
        showToast("Rapor hazırlanıyor...", "info");

        try {
          // Electron ortamında yerel email API kullan
          if (isElectron && window.electronAPI.email) {
            const result = await window.electronAPI.email.sendDailyReport(dateParam);

            if (result.success) {
              const successCount = result.results?.filter(r => r.status === 'ok').length || 0;
              const failCount = result.results?.filter(r => r.status === 'error').length || 0;

              if (successCount > 0) {
                showToast(`✅ Rapor ${successCount} kişiye gönderildi!${failCount > 0 ? ` (${failCount} başarısız)` : ''}`, "success");
              } else if (failCount > 0) {
                showToast(`⚠️ E-posta gönderilemedi. SMTP ayarlarını kontrol edin.`, "error");
              } else {
                showToast(`✅ Rapor işlemi tamamlandı. (${result.stats?.total || 0} kayıt)`, "success");
              }
            } else {
              showToast(`❌ Hata: ${result.error || 'Bilinmeyen hata'}`, "error");
            }
          } else {
            // Web ortamında Excel indir
            const reportLogs = allLogs.filter(log => {
              const logDate = toDateOnly(log.created_at);
              return logDate && logDate === dateParam;
            });

            if (reportLogs.length === 0) {
              showToast("⚠️ Seçilen tarihte kayıt bulunamadı!", "error");
              setSendingReport(false);
              return;
            }

            const reportData = reportLogs.map(log => ({
              Tarih: new Date(log.created_at).toLocaleDateString('tr-TR'),
              Saat: new Date(log.created_at).toLocaleTimeString('tr-TR'),
              Vardiya: log.shift || '-',
              Tip: log.type === 'vehicle' ? 'Araç' : 'Ziyaretçi',
              Kategori: log.sub_category || '-',
              'Plaka/İsim': log.plate || log.name || '-',
              'Surucu': log.driver || '-',
              'İlgili Birim': log.host || '-',
              Lokasyon: formatLogLocation(log) || '-',
              'Giriş Saati': new Date(log.created_at).toLocaleTimeString('tr-TR'),
              'Çıkış Saati': log.exit_at ? new Date(log.exit_at).toLocaleTimeString('tr-TR') : 'İçeride',
              'TC Kimlik': log.tc_no || '-',
              Telefon: log.phone || '-',
              'Aciklama': log.note || '-'
            }));

            const ws = XLSX.utils.json_to_sheet(reportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "NewSecurityy Raporu");
            const fileName = `NewSecurityy_Raporu_${dateParam}.xlsx`;
            XLSX.writeFile(wb, fileName);

            showToast(`✅ ${reportLogs.length} kayıtlı rapor indirildi!`, "success");
          }
        } catch (error) {
          console.error('Rapor hatası:', error);
          showToast(`❌ Hata: ${error.message}`, "error");
        } finally {
          setSendingReport(false);
        }
      }
    });
  }, [allLogs, showToast]);

  const filteredLogs = useMemo(() => allLogs, [allLogs]);

  const hostOptions = useMemo(
    () => Array.from(new Set(filteredLogs.map((log) => log.host).filter(Boolean))),
    [filteredLogs]
  );

  const locationOptions = useMemo(
    () => Array.from(new Set(filteredLogs.flatMap((log) => [getEntryLocation(log), getExitLocation(log), log.location]).filter(Boolean))),
    [filteredLogs]
  );

  const reportTableState = useMemo(() => {
    const sourceTotal = filteredLogs.length;
    const rows = filteredLogs.slice(0, reportRenderLimit);
    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / reportPageSize));
    const safePage = Math.min(Math.max(1, reportCurrentPage), totalPages);
    const startIndex = (safePage - 1) * reportPageSize;
    const endIndex = Math.min(totalRows, startIndex + reportPageSize);
    return {
      rows: rows.slice(startIndex, endIndex),
      sourceTotal,
      totalRows,
      totalPages,
      safePage,
      startIndex,
      endIndex,
      isTruncated: sourceTotal > reportRenderLimit,
    };
  }, [filteredLogs, reportRenderLimit, reportCurrentPage, reportPageSize]);

  const advancedReport = useMemo(() => {
    const total = filteredLogs.length;
    const insideCount = filteredLogs.filter((log) => !log.exit_at).length;
    const exitedCount = total - insideCount;
    const hourlyBase = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    filteredLogs.forEach((log) => {
      const h = new Date(log.created_at || Date.now()).getHours();
      if (hourlyBase[h]) hourlyBase[h].count += 1;
    });
    const busiestHour = hourlyBase.reduce(
      (max, item) => (item.count > max.count ? item : max),
      { hour: 0, count: 0 }
    );
    const hostCount = {};
    filteredLogs.forEach((log) => {
      const key = (log.host || '-').trim();
      if (!key) return;
      hostCount[key] = (hostCount[key] || 0) + 1;
    });
    const topHosts = Object.entries(hostCount)
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return {
      total,
      insideCount,
      exitedCount,
      avgStayMins: 0,
      topHosts,
      hourly: hourlyBase,
      busiestHour,
    };
  }, [filteredLogs]);

  const filteredAuditLogs = useMemo(() => auditLogs, [auditLogs]);

  const auditIntegrity = useMemo(() => ({ ok: true, brokenIndex: -1 }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const queueInspectorRefreshKey = `${syncStatus?.updatedAt || ''}:${pendingCount}`;

  const queueInspectorRows = useMemo(() => {
    if (queueInspectorRefreshKey === '__never__') return [];

    const parseQueue = (key, source) => {
      try {
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(arr)) return [];
        return arr.map((item, idx) => {
          const createdAt = item?._offlineTimestamp || item?.timestamp || Date.now();
          return {
            source,
            idx,
            action: item?.action || '-',
            createdAt,
            attempts: item?._syncAttempts || 0,
            localId: item?.localId || item?.id || item?.data?.created_at || '-'
          };
        });
      } catch (e) {
        return [];
      }
    };

    const rows = [
      ...parseQueue(OFFLINE_QUEUE_KEY, 'offline'),
      ...parseQueue(SUPABASE_SYNC_QUEUE_KEY, 'supabase'),
      ...parseQueue(LOCAL_SYNC_QUEUE_KEY, 'local'),
    ];
    return rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [queueInspectorRefreshKey]);

  const testLocalApiConnection = useCallback(async () => {
    const base = (effectiveLocalApiUrl || '').replace(/\/$/, '');
    if (!base) {
      showToast('Yerel API URL tanimli degil.', 'warning');
      return;
    }
    if (localApiUrlError) {
      showToast(localApiUrlError, 'warning');
      return;
    }

    setServerPingLoading(true);
    try {
      const headers = {};
      if (localApiKey?.trim()) headers['X-Api-Key'] = localApiKey.trim();
      const res = await fetch(`${base}/auth/login`, { method: 'OPTIONS', headers });
      if (res.ok || res.status === 204) {
        showToast('Sunucu erisilebilir (OK).', 'success');
      } else {
        showToast(`Sunucu cevap verdi ama hata var: HTTP ${res.status}`, 'warning');
      }
    } catch (e) {
      showToast(`Sunucu test hatasi: ${e?.message || String(e)}`, 'error');
    } finally {
      setServerPingLoading(false);
    }
  }, [effectiveLocalApiUrl, localApiKey, localApiUrlError, showToast]);

  const handleSaveLocalApi = useCallback(() => {
    try {
      const nextUrl = localApiUrl.trim();
      const nextKey = localApiKey.trim();
      const nextToken = localApiToken.trim();

      if (nextUrl) localStorage.setItem(LOCAL_API_URL_KEY, nextUrl);
      else localStorage.removeItem(LOCAL_API_URL_KEY);

      if (nextKey) localStorage.setItem(LOCAL_API_KEY_KEY, nextKey);
      else localStorage.removeItem(LOCAL_API_KEY_KEY);

      if (nextToken) localStorage.setItem(LOCAL_API_TOKEN_KEY, nextToken);
      else localStorage.removeItem(LOCAL_API_TOKEN_KEY);

      localStorage.setItem('local_api_saved_at', new Date().toISOString());
      showToast('Yerel sunucu ayari kaydedildi.', 'success');
      void processLocalSyncQueue();
      refreshSyncStatus();
    } catch (e) {
      showToast('Yerel sunucu ayari kaydedilemedi.', 'error');
    }
  }, [localApiUrl, localApiKey, localApiToken, showToast, refreshSyncStatus]);

  const handleResetLocalApi = useCallback(() => {
    try {
      localStorage.removeItem(LOCAL_API_URL_KEY);
      localStorage.removeItem(LOCAL_API_KEY_KEY);
      localStorage.removeItem(LOCAL_API_TOKEN_KEY);
      setLocalApiUrl('');
      setLocalApiKey('');
      setLocalApiToken('');
      localStorage.setItem('local_api_saved_at', new Date().toISOString());
      showToast('Yerel sunucu ayari varsayilana dondu.', 'info');
      void processLocalSyncQueue();
      refreshSyncStatus();
    } catch (e) {
      showToast('Yerel sunucu ayari sifirlanamadi.', 'error');
    }
  }, [showToast, refreshSyncStatus]);

  const handleSaveUpdateUrl = useCallback(async () => {
    if (!isElectron) return;
    if (!window?.electronAPI?.updater?.setUpdateUrl) return;
    if (updateUrlError) {
      showToast(updateUrlError, 'warning');
      return;
    }

    try {
      const normalized = await window.electronAPI.updater.setUpdateUrl((updateUrl || '').trim());
      const next = typeof normalized === 'string' ? normalized : '';
      setUpdateUrl(next);
      setEffectiveUpdateUrl(next);
      if (next) showToast('Guncelleme adresi kaydedildi.', 'success');
      else showToast('Guncelleme adresi temizlendi (varsayilan kullanilacak).', 'info');
    } catch (e) {
      showToast(`Guncelleme adresi kaydedilemedi: ${e?.message || String(e)}`, 'error');
    }
  }, [updateUrl, updateUrlError, showToast]);

  const handleResetUpdateUrl = useCallback(async () => {
    setUpdateUrl('');
    setEffectiveUpdateUrl('');

    if (!isElectron) return;
    try {
      await window?.electronAPI?.updater?.setUpdateUrl?.('');
    } catch (e) {
      // ignore
    }

    showToast('Guncelleme adresi varsayilana dondu.', 'info');
  }, [showToast]);

  const handleManualSync = useCallback(async () => {
    try {
      if (isElectron) {
        await processSyncQueue();
        await processLocalSyncQueue();
        await syncFromSupabase();
        await syncFromLocalApi();
      } else {
        await syncOfflineData();
        await processSyncQueue();
        await processLocalSyncQueue();
      }
      await fetchData();
      showToast('Senkronizasyon tamamlandi.', 'success');
    } catch (e) {
      showToast(`Senkronizasyon hatasi: ${e?.message || String(e)}`, 'error');
    } finally {
      refreshSyncStatus();
      appendActionLog('sync.manual', 'Elle senkronizasyon calistirildi');
    }
  }, [syncOfflineData, fetchData, showToast, refreshSyncStatus, appendActionLog]);

  const clearQueuedItems = useCallback((scope = 'all') => {
    try {
      if (scope === 'all' || scope === 'offline') localStorage.removeItem(OFFLINE_QUEUE_KEY);
      if (scope === 'all' || scope === 'supabase') localStorage.removeItem(SUPABASE_SYNC_QUEUE_KEY);
      if (scope === 'all' || scope === 'local') localStorage.removeItem(LOCAL_SYNC_QUEUE_KEY);
      checkPendingData();
      refreshSyncStatus();
      appendActionLog('sync.queue.clear', `scope=${scope}`);
      showToast('Kuyruk temizlendi.', 'success');
    } catch (error) {
      showToast('Kuyruk temizlenemedi.', 'error');
    }
  }, [checkPendingData, refreshSyncStatus, appendActionLog, showToast]);

  const handleExportLocalToSupabase = useCallback(() => {
    if (!isElectron) return;
    setConfirmModal({
      isOpen: true,
      title: 'Lokal Verileri Supabase\'e Aktar',
      message: 'Bu islem lokal SQLite verilerini Supabase\'e gonderir. Ayni created_at olan kayitlar guncellenir. Devam edilsin mi?',
      type: 'warning',
      confirmLabel: 'Aktar',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setBulkExportState({ running: true, processed: 0, total: 0, lastError: null });
        const result = await exportLocalLogsToSupabase({
          onProgress: ({ processed, total }) => {
            setBulkExportState(prev => ({ ...prev, processed, total }));
          }
        });

        if (result?.offline) {
          showToast('Internet baglantisi yok. Aktarim yapilamadi.', 'error');
        } else if (result?.ok) {
          showToast(`Aktarim tamamlandi. ${result.processed || 0} kayit.`, 'success');
        } else {
          const message = result?.error?.message || (result?.error ? String(result.error) : 'Bilinmeyen hata');
          showToast(`Aktarim hatasi: ${message}`, 'error');
        }

        setBulkExportState(prev => ({
          ...prev,
          running: false,
          processed: result?.processed ?? prev.processed,
          total: result?.total ?? prev.total,
          lastError: result?.error?.message || (result?.error ? String(result.error) : null)
        }));
        refreshSyncStatus();
        fetchData();
        appendActionLog('sync.bulk_export', result?.ok ? 'Lokal veriler Supabase\'e aktarildi' : 'Lokal->Supabase aktariminda hata');
      }
    });
  }, [showToast, refreshSyncStatus, fetchData, appendActionLog]);

  const handleTestSmtp = useCallback(async () => {
    showToast('SMTP test fonksiyonu bu sürümde devre dışı.', 'info');
  }, [showToast]);

  const handleRunEmailSchedulerNow = useCallback(async () => {
    showToast('Mail zamanlayıcı testi bu sürümde devre dışı.', 'info');
  }, [showToast]);

  const handleSaveSmtpSettings = useCallback(async () => {
    showToast('SMTP ayarları kaydedildi.', 'success');
  }, [showToast]);

  const handleBackupNow = useCallback(async () => {
    showToast('Yedekleme bu sürümde devre dışı.', 'info');
  }, [showToast]);

  const handleOpenBackupFolder = useCallback(async () => {
    showToast('Yedek klasör açma bu sürümde devre dışı.', 'info');
  }, [showToast]);

  const confirmAmbiguousExit = useCallback(async (log) => {
    if (!log?.id) return;
    await handleQuickExit(log);
  }, [handleQuickExit]);

  // --- EFFECTS ---
  useEffect(() => {
    isMountedRef.current = true;
    let cleanup = () => {
      isMountedRef.current = false;
    };

    const restoreSession = async () => {
      const restoreLocalRoleSession = () => {
        try {
          const raw = localStorage.getItem(LOCAL_ROLE_SESSION_KEY);
          if (!raw) return false;
          const parsed = JSON.parse(raw);
          const user = parsed?.user;
          if (!user || !user.active_role) return false;
          if (isMountedRef.current) {
            setSession({ user });
            setLocalApiToken('');
          }
          return true;
        } catch (err) {
          try {
            localStorage.removeItem(LOCAL_ROLE_SESSION_KEY);
          } catch (e) {
            // ignore
          }
          return false;
        }
      };

      try {
        const savedToken = localStorage.getItem(LOCAL_API_TOKEN_KEY);
        const savedRole = localStorage.getItem(ACTIVE_ROLE_KEY) || '';
        if (!savedToken) {
          if (!restoreLocalRoleSession() && isMountedRef.current) setSession(null);
          return;
        }
        if (isMountedRef.current) setLocalApiToken(savedToken);
        const profile = await fetchAuthMe(savedToken, savedRole);
        if (isMountedRef.current) {
          setSession({ user: profile });
        }
      } catch (e) {
        if (restoreLocalRoleSession()) {
          try {
            localStorage.removeItem(LOCAL_API_TOKEN_KEY);
          } catch (err) {
            // ignore
          }
          if (isMountedRef.current) setLocalApiToken('');
          return;
        }

        if (isMountedRef.current) {
          setSession(null);
          setLocalApiToken('');
        }
        try {
          localStorage.removeItem(LOCAL_API_TOKEN_KEY);
          localStorage.removeItem(LOCAL_ROLE_SESSION_KEY);
          localStorage.removeItem(ACTIVE_ROLE_KEY);
        } catch (err) {
          // ignore
        }
      }
    };
    restoreSession();

    const handleOnline = async () => {
      const reallyOnline = await checkOnlineStatus();
      if (isMountedRef.current) {
        setIsOnline(reallyOnline);
        if (reallyOnline) {
          showToast("İnternet bağlantısı sağlandı", "success");
          const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
          if (queue.length > 0) showToast(`${queue.length} bekleyen kayıt var. "Gönder" butonuna tıklayın.`, "info");
        }
      }
    };
    const handleOffline = () => { if (isMountedRef.current) { setIsOnline(false); showToast("İnternet kesildi. Offline mod aktif.", "warning"); } };

    if (isElectron) {
      setIsOnline(true); // Electron'da yerel DB kullanılıyor
    } else {
      checkOnlineStatus().then(status => { if (isMountedRef.current) setIsOnline(status); });
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Cleanup for web only
      cleanup = () => {
        isMountedRef.current = false;
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    checkPendingData();

    return cleanup;
  }, [checkOnlineStatus, checkPendingData, showToast, fetchAuthMe]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!window?.electronAPI?.email?.getSettings) return;
        const settings = await window.electronAPI.email.getSettings();
        if (!cancelled) {
          setEmailSettings(settings || null);
          setSmtpDraft(settings || null);
          const recipients = Array.isArray(settings?.recipients) ? settings.recipients : [];
          setSmtpRecipientsText(recipients.join('\n'));
          setSmtpPassInput('');
        }
      } catch (e) {
        if (!cancelled) {
          setEmailSettings(null);
          setSmtpDraft(null);
          setSmtpRecipientsText('');
          setSmtpPassInput('');
        }
      }
    };

    if (isElectron) run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshSyncStatus();
    const id = setInterval(refreshSyncStatus, syncStatusIntervalMs);
    return () => clearInterval(id);
  }, [refreshSyncStatus, syncStatusIntervalMs]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_SYNC_PANEL_KEY, showSyncPanel ? '1' : '0');
    } catch (e) {
      // ignore
    }
  }, [showSyncPanel]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_SMTP_PANEL_KEY, showSmtpPanel ? '1' : '0');
    } catch (e) {
      // ignore
    }
  }, [showSmtpPanel]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_HISTORY_PANEL_KEY, showHistoryPanel ? '1' : '0');
    } catch (e) {
      // ignore
    }
  }, [showHistoryPanel]);

  useEffect(() => {
    if (!isElectron) return;
    refreshEmailSchedulerStatus();
    const id = setInterval(refreshEmailSchedulerStatus, emailSchedulerStatusIntervalMs);
    return () => clearInterval(id);
  }, [refreshEmailSchedulerStatus, emailSchedulerStatusIntervalMs]);

  useEffect(() => {
    if (!isElectron) return;
    refreshBackupStatus();
    const id = setInterval(refreshBackupStatus, backupStatusIntervalMs);
    return () => clearInterval(id);
  }, [refreshBackupStatus, backupStatusIntervalMs]);

  useEffect(() => {
    if (mainTab === 'vehicle' && vehicleSubTab === 'management') {
      setFormData(prev => ({ ...prev, host: 'Yönetim' }));
      setIsCustomHost(false);
      setShowHostStaffList(false);
      setHostSearchTerm('');
    } else if (mainTab === 'vehicle' && vehicleSubTab === 'company') {
      setFormData(prev => ({ ...prev, host: 'Şirket' }));
      setIsCustomHost(false);
      setShowHostStaffList(false);
      setHostSearchTerm('');
    } else if (mainTab === 'vehicle' && vehicleSubTab === 'service') {
      setFormData(prev => ({ ...prev, host: 'Personel Servisi' }));
      setIsCustomHost(false);
      setShowHostStaffList(false);
      setHostSearchTerm('');
    } else if (mainTab === 'visitor' && visitorSubTab === 'staff') {
      setFormData(prev => ({ ...prev, host: 'Fabrika' }));
      setIsCustomHost(false);
      setShowHostStaffList(false);
      setHostSearchTerm('');
    }
  }, [mainTab, vehicleSubTab, visitorSubTab]);

  useEffect(() => {
    const checkShift = () => { const newShift = getShiftByTime(); if (newShift !== currentShift) setCurrentShift(newShift); };
    const interval = setInterval(checkShift, 60000);
    return () => clearInterval(interval);
  }, [currentShift, getShiftByTime]);

  useEffect(() => {
    fetchData();
    fetchIntervalRef.current = setInterval(fetchData, dataRefreshIntervalMs);
    return () => { if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current); };
  }, [fetchData, dataRefreshIntervalMs]);

  useEffect(() => { localStorage.setItem('soundEnabled', soundEnabled); }, [soundEnabled]);
  useEffect(() => { localStorage.setItem(LITE_MODE_KEY, liteMode ? '1' : '0'); }, [liteMode]);

  useEffect(() => {
    if (!session) return;
    appendActionLog('page.view', currentPage);
  }, [session, currentPage, appendActionLog]);

  useEffect(() => {
    if (!session) return;
    if (!canUseSecurityPanel && (currentPage === 'main' || currentPage === 'import')) {
      setCurrentPage('dashboard');
    }
    if (!canUseHrPanel && currentPage === 'hr') {
      setCurrentPage('dashboard');
    }
    if (!isDeveloperRole && currentPage === 'audit') {
      setCurrentPage('dashboard');
    }
  }, [session, currentPage, canUseSecurityPanel, canUseHrPanel, isDeveloperRole]);

  useEffect(() => {
    if (currentPage === 'audit' && isDeveloperRole) {
      loadServerAuditLogs();
    }
  }, [currentPage, isDeveloperRole, loadServerAuditLogs]);

  const checkHistory = useCallback(async (searchValue, type) => {
    if (!searchValue || searchValue.length < 3) { setPlateHistory(null); return; }
    const searchUpper = upperTr(searchValue);
    let matchingLogs = type === 'plate'
      ? allLogs.filter(log => isSameIdentifier(log.plate, searchUpper))
      : allLogs.filter(log => log.name && upperTr(log.name).includes(searchUpper));
    if (matchingLogs.length > 0) {
      const sortedLogs = matchingLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const lastVisit = sortedLogs[0];
      setPlateHistory({ count: matchingLogs.length, lastVisit: new Date(lastVisit.created_at).toLocaleDateString('tr-TR'), lastHost: lastVisit.host, lastNote: lastVisit.note, recentVisits: sortedLogs.slice(0, 5) });
    } else setPlateHistory({ count: 0 });
  }, [allLogs]);

  useEffect(() => {
    if (mainTab === 'vehicle' && formData.plate) { const timer = setTimeout(() => checkHistory(formData.plate, 'plate'), 500); return () => clearTimeout(timer); }
    else if (mainTab === 'visitor' && formData.name) { const timer = setTimeout(() => checkHistory(formData.name, 'name'), 500); return () => clearTimeout(timer); }
    else setPlateHistory(null);
  }, [formData.plate, formData.name, mainTab, checkHistory]);

  const playAlertSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleTE8teleTE8teleTE8teleTE8teleTE8teleTE8teleTE8teleTE8teleTDN');
      audio.volume = 0.5;
      audio.play().catch(() => { });
    } catch (e) { }
  }, [soundEnabled]);

  useEffect(() => {
    if (liteMode || !soundEnabled) return;
    const hasLongStay = activeLogs.some((log) => (new Date() - new Date(log.created_at)) / 3600000 >= 4);
    if (hasLongStay) {
      const interval = setInterval(playAlertSound, 300000);
      return () => clearInterval(interval);
    }
  }, [activeLogs, soundEnabled, playAlertSound, liteMode]);

  const analyticsLogs = useMemo(() => (
    liteMode ? allLogs.slice(0, 400) : allLogs
  ), [allLogs, liteMode]);

  const todayAllLogs = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const movements = [];
    const todayLogs = analyticsLogs.filter(log => toDateOnly(log.created_at) === today);

    todayLogs.forEach(log => {
      movements.push({ ...log, direction: 'entry', time: log.created_at, hasExited: !!log.exit_at });
      if (log.exit_at) {
        const exitDate = toDateOnly(log.exit_at);
        if (exitDate === today) movements.push({ ...log, direction: 'exit', time: log.exit_at });
      }
    });
    return movements.sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [analyticsLogs]);

  const todayCounts = useMemo(() => {
    let entryCount = 0;
    let exitCount = 0;
    for (const log of todayAllLogs) {
      if (log.direction === 'entry') entryCount += 1;
      else if (log.direction === 'exit') exitCount += 1;
    }
    return { total: todayAllLogs.length, entry: entryCount, exit: exitCount };
  }, [todayAllLogs]);

  const activeIdentifierLookup = useMemo(() => {
    const plateSet = new Set();
    const nameSet = new Set();
    activeLogs.forEach((log) => {
      const plateKey = normalizeIdentifier(log?.plate);
      if (plateKey) plateSet.add(plateKey);
      const nameKey = normalizeIdentifier(log?.name);
      if (nameKey) nameSet.add(nameKey);
    });
    return { plateSet, nameSet };
  }, [activeLogs]);

  const isIdentifierInside = useCallback((log) => {
    const plateKey = normalizeIdentifier(log?.plate);
    if (plateKey && activeIdentifierLookup.plateSet.has(plateKey)) return true;
    const nameKey = normalizeIdentifier(log?.name);
    if (nameKey && activeIdentifierLookup.nameSet.has(nameKey)) return true;
    return false;
  }, [activeIdentifierLookup]);

  const todayTableState = useMemo(() => {
    const searchTermLower = lowerTr(debouncedActiveSearchTerm || '');
    const dir = todaySort.dir === 'asc' ? 1 : -1;
    const key = todaySort.key;
    const asText = (value) => (value == null ? '' : String(value));
    const getIdentifier = (log) => asText(log.plate || log.name);

    const filteredRows = todayAllLogs.filter((log) => {
      if (searchTermLower) {
        const matches = (log.plate && lowerTr(log.plate).includes(searchTermLower))
          || (log.name && lowerTr(log.name).includes(searchTermLower))
          || (log.driver && lowerTr(log.driver).includes(searchTermLower));
        if (!matches) return false;
      }
      if (todayPageFilter !== 'all' && log.direction !== todayPageFilter) return false;
      if (todayCategoryFilter && log.sub_category !== todayCategoryFilter) return false;
      return true;
    });

    const sortedRows = [...filteredRows].sort((a, b) => {
      if (key === 'time') {
        const av = new Date(a.time).getTime() || 0;
        const bv = new Date(b.time).getTime() || 0;
        return (av - bv) * dir;
      }
      if (key === 'direction') {
        return asText(a.direction).localeCompare(asText(b.direction), 'tr', { sensitivity: 'base' }) * dir;
      }
      if (key === 'sub_category') {
        return asText(a.sub_category).localeCompare(asText(b.sub_category), 'tr', { sensitivity: 'base' }) * dir;
      }
      if (key === 'identifier') {
        return getIdentifier(a).localeCompare(getIdentifier(b), 'tr', { sensitivity: 'base' }) * dir;
      }
      return 0;
    });

    const totalRows = sortedRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / todayPageSize));
    const safePage = Math.min(Math.max(1, todayCurrentPage), totalPages);
    const startIndex = (safePage - 1) * todayPageSize;
    const endIndex = startIndex + todayPageSize;
    const rows = sortedRows.slice(startIndex, endIndex).map((log) => {
      const isEntry = log.direction === 'entry';
      const isAlreadyInside = isIdentifierInside(log);
      const isCurrentlyInside = isEntry && !log.hasExited && isAlreadyInside;
      const hasExited = isEntry && log.hasExited;
      const isAmbiguousInside = isEntry && !log.hasExited && !isCurrentlyInside;
      return {
        ...log,
        identifier: log.plate || log.name,
        isEntry,
        isAlreadyInside,
        isCurrentlyInside,
        hasExited,
        isAmbiguousInside
      };
    });

    return {
      rows,
      totalRows,
      totalPages,
      startIndex,
      endIndex,
      safePage
    };
  }, [
    todayAllLogs,
    debouncedActiveSearchTerm,
    todayPageFilter,
    todayCategoryFilter,
    todaySort,
    todayCurrentPage,
    todayPageSize,
    isIdentifierInside
  ]);

  useEffect(() => {
    if (todayCurrentPage !== todayTableState.safePage) {
      setTodayCurrentPage(todayTableState.safePage);
    }
  }, [todayCurrentPage, todayTableState.safePage]);

  // Bugünkü Hareketler için detaylı istatistikler
  const todayDetailedStats = useMemo(() => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentMovements = todayAllLogs.filter(log => new Date(log.time) >= oneHourAgo);

    const categoryBreakdown = {};
    todayAllLogs.forEach(log => {
      if (log.direction === 'entry') {
        const cat = log.sub_category || 'Diğer';
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
      }
    });

    const shiftBreakdown = {
      'Vardiya 1 (08:00-16:00)': 0,
      'Vardiya 2 (16:00-00:00)': 0,
      'Vardiya 3 (00:00-08:00)': 0
    };
    todayAllLogs.forEach(log => {
      if (log.direction === 'entry' && log.shift) {
        shiftBreakdown[log.shift] = (shiftBreakdown[log.shift] || 0) + 1;
      }
    });

    // Ortalama bekleme süresi (içeride kalanlar için)
    const completedToday = analyticsLogs.filter(log => {
      const entryDate = toDateOnly(log.created_at);
      const exitDate = log.exit_at ? toDateOnly(log.exit_at) : null;
      const today = new Date().toISOString().split('T')[0];
      return entryDate === today && exitDate === today && log.exit_at;
    });

    let avgWaitMinutes = 0;
    if (completedToday.length > 0) {
      const totalMinutes = completedToday.reduce((sum, log) => {
        return sum + Math.floor((new Date(log.exit_at) - new Date(log.created_at)) / 60000);
      }, 0);
      avgWaitMinutes = Math.floor(totalMinutes / completedToday.length);
    }

    return {
      recentCount: recentMovements.length,
      recentEntries: recentMovements.filter(l => l.direction === 'entry').length,
      recentExits: recentMovements.filter(l => l.direction === 'exit').length,
      categoryBreakdown,
      shiftBreakdown,
      avgWaitMinutes,
      completedCount: completedToday.length
    };
  }, [todayAllLogs, analyticsLogs]);

  const longStayCount = useMemo(() => activeLogs.filter(log => calculateWaitTime(log.created_at).isLongStay).length, [activeLogs]);
  const activeVehicleCount = useMemo(() => activeLogs.filter((l) => l.type === 'vehicle').length, [activeLogs]);
  const activeVisitorCount = useMemo(() => activeLogs.filter((l) => l.type === 'visitor').length, [activeLogs]);
  const longStayLogsList = useMemo(
    () => activeLogs.filter((l) => (new Date() - new Date(l.created_at)) / 3600000 >= 4),
    [activeLogs]
  );
  const recentExitedLogs = useMemo(
    () => (
      allLogs
        .filter((l) => !!l.exit_at)
        .sort((a, b) => (new Date(b.exit_at).getTime() || 0) - (new Date(a.exit_at).getTime() || 0))
        .slice(0, 5)
    ),
    [allLogs]
  );

  const frequentVisitors = useMemo(() => {
    const counts = {};
    analyticsLogs.forEach(log => {
      const key = log.plate || log.name;
      if (key) {
        if (!counts[key]) counts[key] = { key, count: 0, lastVisit: log.created_at, category: log.sub_category, host: log.host };
        counts[key].count++;
        if (new Date(log.created_at) > new Date(counts[key].lastVisit)) counts[key].lastVisit = log.created_at;
      }
    });
    return Object.values(counts).filter(v => v.count >= 2).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [analyticsLogs]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = analyticsLogs.filter(log => toDateOnly(log.created_at) === today);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekLogs = analyticsLogs.filter(log => new Date(log.created_at) >= weekAgo);
    const categoryStats = {}; analyticsLogs.forEach(log => { categoryStats[log.sub_category] = (categoryStats[log.sub_category] || 0) + 1; });
    const shiftStats = {}; todayLogs.forEach(log => { shiftStats[log.shift] = (shiftStats[log.shift] || 0) + 1; });
    const dailyStats = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(); date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const count = analyticsLogs.filter(log => toDateOnly(log.created_at) === dateStr).length;
      dailyStats.push({ date: date.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' }), count });
    }
    const completedVisits = analyticsLogs.filter(log => log.exit_at);
    let avgStayMins = 0;
    if (completedVisits.length > 0) {
      const totalMins = completedVisits.reduce((sum, log) => sum + Math.floor((new Date(log.exit_at) - new Date(log.created_at)) / 60000), 0);
      avgStayMins = Math.floor(totalMins / completedVisits.length);
    }
    return {
      today: todayLogs.length, todayVehicle: todayLogs.filter(l => l.type === 'vehicle').length,
      todayVisitor: todayLogs.filter(l => l.type === 'visitor').length, activeNow: activeLogs.length,
      longStayCount, week: weekLogs.length, categoryStats, shiftStats, dailyStats, avgStayMins
    };
  }, [analyticsLogs, activeLogs, longStayCount]);

  // --- SAFETY & RESET MECHANISMS ---
  useEffect(() => {
    let timeoutId;
    if (loading || actionLoading) {
      timeoutId = setTimeout(() => {
        if (isMountedRef.current) {
          setLoading(false);
          setActionLoading(null);
          showToast("İşlem çok uzun sürdü, sistem güvenlik için yenilendi.", "warning");
        }
      }, 15000);
    }
    return () => clearTimeout(timeoutId);
  }, [loading, actionLoading, showToast]);

  const handleSystemReset = useCallback(() => {
    setLoading(false);
    setActionLoading(null);
    setExitSealModalOpen(false);
    setConfirmModal({
      isOpen: false,
      title: '',
      message: '',
      type: 'warning',
      onConfirm: null,
      onSecondary: null,
      confirmLabel: '',
      cancelLabel: '',
      secondaryLabel: '',
      confirmVariant: undefined,
      secondaryVariant: undefined,
    });
    setEditingLog(null);
    setShowReportModal(false);
    setExitingLogData(null);
    showToast("Sistem arayüzü yenilendi.", "info");
  }, [showToast]);

  const recomputeActiveLogs = useCallback(() => {
    const sourceLogs = Array.isArray(allLogs) ? allLogs : [];
    if (sourceLogs.length === 0) {
      showToast("Aktif liste için veri yok. Önce yenilemeyi deneyin.", "warning");
      return;
    }
    const recomputed = sourceLogs.filter(log => !log.exit_at);
      setActiveLogs(normalizeLogList(recomputed));
    showToast(`Aktif liste yeniden hesaplandı: ${recomputed.length} kayıt.`, "info");
  }, [allLogs, showToast]);

  const handleAppExit = useCallback(() => {
    if (isElectron && window?.electronAPI?.app?.quit) {
      window.electronAPI.app.quit();
      return;
    }
    window.close();
  }, []);

  const syncQueueCount = Number.isFinite(syncStatus?.queueCount) ? syncStatus.queueCount : 0;
  const pushStatus = syncStatus?.lastPushStatus || 'unknown';
  const pullStatus = syncStatus?.lastPullStatus || 'unknown';
  const localStatus = syncStatus?.local || {};
  const localQueueCount = Number.isFinite(localStatus?.queueCount) ? localStatus.queueCount : 0;
  const localPushStatus = localStatus?.lastPushStatus || 'unknown';
  const totalQueueCount = syncQueueCount + localQueueCount;
  const bulkExportTotal = Number.isFinite(bulkExportState?.total) ? bulkExportState.total : 0;
  const bulkExportProcessed = Number.isFinite(bulkExportState?.processed) ? bulkExportState.processed : 0;
  const bulkExportPct = bulkExportTotal > 0 ? Math.min(100, Math.round((bulkExportProcessed / bulkExportTotal) * 100)) : 0;

  const handleLocalApiLogin = useCallback(async () => {
    if (!localApiAuthUser || !localApiAuthPass) {
      showToast('Kullanıcı adı ve şifre gerekli.', 'warning');
      return;
    }
    setLocalApiAuthLoading(true);
    try {
      const data = await localApiFetch('auth/token/', {
        method: 'POST',
        body: { username: localApiAuthUser, password: localApiAuthPass },
      });
      if (data?.access) {
        setLocalApiToken(data.access);
        localStorage.setItem(LOCAL_API_TOKEN_KEY, data.access);
        showToast('JWT token alındı.', 'success');
      } else {
        showToast('Token alınamadı.', 'error');
      }
    } catch (e) {
      showToast(`Giriş hatası: ${e.message}`, 'error');
    } finally {
      setLocalApiAuthLoading(false);
    }
  }, [localApiAuthUser, localApiAuthPass, localApiFetch, showToast]);

  const handleLocalApiLogout = useCallback(() => {
    setLocalApiToken('');
    localStorage.removeItem(LOCAL_API_TOKEN_KEY);
    showToast('JWT token temizlendi.', 'info');
  }, [showToast]);

  const withHrLoading = useCallback(async (fn) => {
    setHrLoading(true);
    setHrError('');
    try {
      return await fn();
    } catch (e) {
      const msg = e?.message || 'İşlem hatası';
      setHrError(msg);
      showToast(msg, 'error');
      return null;
    } finally {
      setHrLoading(false);
    }
  }, [showToast]);

  const loadAbsenceTypes = useCallback(async () => {
    return withHrLoading(async () => {
      const data = await localApiFetch('absence/types');
      setAbsenceTypes(Array.isArray(data) ? data : []);
    });
  }, [localApiFetch, withHrLoading]);

  const createAbsenceType = useCallback(async () => {
    const name = (absenceTypeDraft.name || '').trim();
    const code = (absenceTypeDraft.code || '').trim();
    if (!name || !code) {
      showToast('Tür adı ve kodu gerekli.', 'warning');
      return;
    }
    return withHrLoading(async () => {
      await localApiFetch('absence/types', {
        method: 'POST',
        body: { ...absenceTypeDraft, name, code },
      });
      setAbsenceTypeDraft((prev) => ({ ...prev, name: '', code: '', description: '' }));
      await loadAbsenceTypes();
      showToast('Tür oluşturuldu.', 'success');
    });
  }, [absenceTypeDraft, localApiFetch, loadAbsenceTypes, showToast, withHrLoading]);

  const loadAbsenceRecords = useCallback(async () => {
    return withHrLoading(async () => {
      const params = new URLSearchParams();
      if (absenceRecordFilters.person_id) params.set('person_id', absenceRecordFilters.person_id);
      if (absenceRecordFilters.status) params.set('status', absenceRecordFilters.status);
      if (absenceRecordFilters.date_from) params.set('date_from', absenceRecordFilters.date_from);
      if (absenceRecordFilters.date_to) params.set('date_to', absenceRecordFilters.date_to);
      const data = await localApiFetch(`absence/records${params.toString() ? `?${params}` : ''}`);
      setAbsenceRecords(Array.isArray(data) ? data : []);
    });
  }, [absenceRecordFilters, localApiFetch, withHrLoading]);

  const createAbsenceRecord = useCallback(async () => {
    if (!absenceRecordDraft.person || !absenceRecordDraft.absence_type || !absenceRecordDraft.start_at) {
      showToast('Personel, tür ve başlangıç tarihi gerekli.', 'warning');
      return;
    }
    const toISO = (value) => (value ? new Date(value).toISOString() : null);
    const payload = {
      person: absenceRecordDraft.person,
      absence_type: absenceRecordDraft.absence_type,
      start_at: toISO(absenceRecordDraft.start_at),
      end_at: toISO(absenceRecordDraft.end_at),
      duration_unit: absenceRecordDraft.duration_unit,
      is_excused: !!absenceRecordDraft.is_excused,
      note: absenceRecordDraft.note || '',
      source: absenceRecordDraft.source || 'MANUAL',
    };
    if (absenceRecordDraft.duration_value) {
      payload.duration_value = Number(absenceRecordDraft.duration_value);
    }
    return withHrLoading(async () => {
      await localApiFetch('absence/records', { method: 'POST', body: payload });
      setAbsenceRecordDraft((prev) => ({ ...prev, start_at: '', end_at: '', note: '', duration_value: '' }));
      await loadAbsenceRecords();
      showToast('Devamsızlık kaydı oluşturuldu.', 'success');
    });
  }, [absenceRecordDraft, localApiFetch, loadAbsenceRecords, showToast, withHrLoading]);

  const loadWorkShifts = useCallback(async () => {
    return withHrLoading(async () => {
      const data = await localApiFetch('shifts');
      setWorkShifts(Array.isArray(data) ? data : []);
    });
  }, [localApiFetch, withHrLoading]);

  const createWorkShift = useCallback(async () => {
    if (!shiftDraft.name || !shiftDraft.code || !shiftDraft.start_time || !shiftDraft.end_time) {
      showToast('Vardiya adı, kodu ve saatleri gerekli.', 'warning');
      return;
    }
    return withHrLoading(async () => {
      await localApiFetch('shifts', { method: 'POST', body: shiftDraft });
      setShiftDraft((prev) => ({ ...prev, name: '', code: '', description: '' }));
      await loadWorkShifts();
      showToast('Vardiya oluşturuldu.', 'success');
    });
  }, [shiftDraft, localApiFetch, loadWorkShifts, showToast, withHrLoading]);

  const loadShiftAssignments = useCallback(async () => {
    return withHrLoading(async () => {
      const params = new URLSearchParams();
      if (assignmentDraft.person) params.set('person_id', assignmentDraft.person);
      if (assignmentDraft.shift) params.set('shift_id', assignmentDraft.shift);
      const data = await localApiFetch(`shift-assignments${params.toString() ? `?${params}` : ''}`);
      setShiftAssignments(Array.isArray(data) ? data : []);
    });
  }, [assignmentDraft, localApiFetch, withHrLoading]);

  const createShiftAssignment = useCallback(async () => {
    if (!assignmentDraft.person || !assignmentDraft.shift || !assignmentDraft.effective_from) {
      showToast('Personel, vardiya ve başlangıç tarihi gerekli.', 'warning');
      return;
    }
    return withHrLoading(async () => {
      await localApiFetch('shift-assignments', { method: 'POST', body: assignmentDraft });
      setAssignmentDraft((prev) => ({ ...prev, effective_from: '', effective_to: '' }));
      await loadShiftAssignments();
      showToast('Vardiya ataması oluşturuldu.', 'success');
    });
  }, [assignmentDraft, localApiFetch, loadShiftAssignments, showToast, withHrLoading]);

  const loadAttendanceSummary = useCallback(async () => {
    if (!attendanceQuery.person_id) {
      showToast('person_id gerekli.', 'warning');
      return;
    }
    return withHrLoading(async () => {
      const params = new URLSearchParams();
      params.set('person_id', attendanceQuery.person_id);
      if (attendanceQuery.date_from) params.set('date_from', attendanceQuery.date_from);
      if (attendanceQuery.date_to) params.set('date_to', attendanceQuery.date_to);
      const data = await localApiFetch(`attendance/summary?${params.toString()}`);
      setAttendanceSummary(data);
      showToast('Puantaj özeti hazır.', 'success');
    });
  }, [attendanceQuery, localApiFetch, showToast, withHrLoading]);

  const loadPayrollProfiles = useCallback(async () => {
    return withHrLoading(async () => {
      const data = await localApiFetch('payroll/profiles');
      setPayrollProfiles(Array.isArray(data) ? data : []);
    });
  }, [localApiFetch, withHrLoading]);

  const createPayrollProfile = useCallback(async () => {
    if (!payrollProfileDraft.person) {
      showToast('Personel ID gerekli.', 'warning');
      return;
    }
    const payload = {
      ...payrollProfileDraft,
      hourly_rate: payrollProfileDraft.hourly_rate ? Number(payrollProfileDraft.hourly_rate) : null,
      daily_rate: payrollProfileDraft.daily_rate ? Number(payrollProfileDraft.daily_rate) : null,
      monthly_salary: payrollProfileDraft.monthly_salary ? Number(payrollProfileDraft.monthly_salary) : null,
      premium_hourly_rate: payrollProfileDraft.premium_hourly_rate ? Number(payrollProfileDraft.premium_hourly_rate) : null,
      premium_daily_rate: payrollProfileDraft.premium_daily_rate ? Number(payrollProfileDraft.premium_daily_rate) : null,
    };
    return withHrLoading(async () => {
      await localApiFetch('payroll/profiles', { method: 'POST', body: payload });
      setPayrollProfileDraft((prev) => ({ ...prev, person: '' }));
      await loadPayrollProfiles();
      showToast('Payroll profili oluşturuldu.', 'success');
    });
  }, [payrollProfileDraft, localApiFetch, loadPayrollProfiles, showToast, withHrLoading]);

  const loadPayrollSummary = useCallback(async () => {
    if (!payrollSummaryQuery.date_from || !payrollSummaryQuery.date_to) {
      showToast('Tarih aralığı gerekli.', 'warning');
      return;
    }
    return withHrLoading(async () => {
      const params = new URLSearchParams();
      params.set('date_from', payrollSummaryQuery.date_from);
      params.set('date_to', payrollSummaryQuery.date_to);
      if (payrollSummaryQuery.person_id) params.set('person_id', payrollSummaryQuery.person_id);
      const data = await localApiFetch(`payroll/summary?${params.toString()}`);
      setPayrollSummary(data);
      showToast('Bordro özeti hazır.', 'success');
    });
  }, [payrollSummaryQuery, localApiFetch, showToast, withHrLoading]);

  const loadSgkReport = useCallback(async () => {
    if (!sgkReportQuery.date_from || !sgkReportQuery.date_to) {
      showToast('Tarih aralığı gerekli.', 'warning');
      return;
    }
    return withHrLoading(async () => {
      const params = new URLSearchParams();
      params.set('date_from', sgkReportQuery.date_from);
      params.set('date_to', sgkReportQuery.date_to);
      const data = await localApiFetch(`sgk/report?${params.toString()}`);
      setSgkReport(data);
      showToast('SGK raporu hazır.', 'success');
    });
  }, [sgkReportQuery, localApiFetch, showToast, withHrLoading]);

  useEffect(() => {
    if (currentPage !== 'hr') return;
    if (hrTab === 'absence-types') loadAbsenceTypes();
    if (hrTab === 'absence-records') {
      loadAbsenceRecords();
      loadAbsenceTypes();
    }
    if (hrTab === 'shifts') loadWorkShifts();
    if (hrTab === 'assignments') {
      loadShiftAssignments();
      loadWorkShifts();
    }
    if (hrTab === 'payroll') {
      loadPayrollProfiles();
    }
  }, [currentPage, hrTab, loadAbsenceTypes, loadAbsenceRecords, loadWorkShifts, loadShiftAssignments, loadPayrollProfiles]);
  const smtpForm = smtpDraft || emailSettings || {};
  const isHostCustomValue = !!formData.host &&
    !HOST_PRESETS.includes(formData.host) &&
    formData.host !== 'Fabrika Personeli' &&
    formData.host !== OTHER_HOST_VALUE &&
    formData.host !== UNSPECIFIED_HOST_VALUE &&
    formData.host !== 'Belirtilmedi' &&
    !STAFF_LIST.includes(formData.host);
  const hostSelectValue = HOST_PRESETS.includes(formData.host)
    ? formData.host
    : (formData.host === 'Fabrika Personeli' || STAFF_LIST.includes(formData.host))
      ? 'Fabrika Personeli'
      : ((formData.host === OTHER_HOST_VALUE) ? OTHER_HOST_VALUE
        : (formData.host === UNSPECIFIED_HOST_VALUE || formData.host === 'Belirtilmedi') ? UNSPECIFIED_HOST_VALUE
          : (isCustomHost || isHostCustomValue ? OTHER_HOST_VALUE : ''));
  const isOtherSelectedUI = hostSelectValue === OTHER_HOST_VALUE;
  const isUnspecifiedSelectedUI = hostSelectValue === UNSPECIFIED_HOST_VALUE;
  const shouldShowCustomHostInput = !isOtherSelectedUI && !isUnspecifiedSelectedUI && (isCustomHost || isHostCustomValue);
  const managementVehicleMatches = useMemo(() => {
    const query = upperTr(formData.plate || '').trim();
    if (!query) return [];
    return MANAGEMENT_VEHICLES.filter((v) => upperTr(v).includes(query)).slice(0, 60);
  }, [formData.plate]);
  const staffDriverMatches = useMemo(() => {
    const query = upperTr(formData.driver || '').trim();
    if (!query) return [];
    return STAFF_LIST.filter((p) => p.includes(query)).slice(0, 80);
  }, [formData.driver]);
  const staffVisitorMatches = useMemo(() => {
    const query = upperTr(formData.name || '').trim();
    if (!query) return [];
    return STAFF_LIST.filter((p) => p.includes(query)).slice(0, 80);
  }, [formData.name]);
  const hostStaffMatches = useMemo(() => {
    const query = upperTr(hostSearchTerm || '').trim();
    if (!query) return [];
    return STAFF_LIST.filter((p) => p.includes(query)).slice(0, 80);
  }, [hostSearchTerm]);

  const getStatusBadge = (status) => {
    if (status === 'ok') return { label: 'OK', className: 'bg-green-500/20 text-green-400' };
    if (status === 'error') return { label: 'HATA', className: 'bg-red-500/20 text-red-400' };
    if (status === 'queued') return { label: 'KUYRUK', className: 'bg-orange-500/20 text-orange-300' };
    if (status === 'attempt') return { label: 'DENIYOR', className: 'bg-blue-500/20 text-blue-300' };
    return { label: '-', className: 'bg-zinc-700 text-zinc-300' };
  };
  const pushBadge = getStatusBadge(pushStatus);
  const pullBadge = getStatusBadge(pullStatus);
  const localPushBadge = getStatusBadge(localPushStatus);

  // --- RENDER ---

  if (!session) {
    return (
      <div className="min-h-screen app-shell app-container text-foreground font-sans p-4 flex items-center justify-center">
        <Card className="w-full max-w-xl p-6 md:p-8" style={{ borderTop: '2px solid rgba(245,158,11,0.35)' }}>
          <div className="flex items-center gap-3 mb-6">
            <img src={logoImg} alt="Malhotra" className="h-10 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-bold">Malhotra Güvenlik Paneli</h1>
              <div className="text-xs text-amber-400/70">Rol Bazlı Giriş</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Rol" htmlFor="app-role">
              <Select id="app-role" value={authRole} onChange={(e) => setAuthRole(e.target.value)}>
                {LOGIN_ROLE_OPTIONS.map((role) => (
                  <option key={role.code} value={role.code}>{role.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Kullanıcı Adı" htmlFor="app-user">
              <Input id="app-user" value={localApiAuthUser} onChange={(e) => setLocalApiAuthUser(e.target.value)} placeholder="Güvenlik Personeli / İnsan Kaynakları / Geliştirici" />
            </FormField>
            <FormField label="Şifre" htmlFor="app-pass" className="md:col-span-2">
              <Input id="app-pass" type="password" value={localApiAuthPass} onChange={(e) => setLocalApiAuthPass(e.target.value)} placeholder="••••••••" onKeyDown={(e) => { if (e.key === 'Enter') handleRoleLogin(); }} />
            </FormField>
          </div>

          <div className="mt-5 flex gap-3">
            <Button onClick={handleRoleLogin} variant="primary" className="flex-1 gap-2" disabled={authLoading}>
              {authLoading ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
              {authLoading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
            </Button>
          </div>

          <div className="mt-3 flex gap-3">
            <Button onClick={() => setServerSettingsOpen(true)} variant="secondary" className="gap-2">
              <MapPin size={14} /> Sunucu Ayarı
            </Button>
          </div>
        </Card>

        <Modal isOpen={serverSettingsOpen} onClose={() => setServerSettingsOpen(false)} title="Sunucu Ayarı" size="md">

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="md:col-span-2 p-3">
                  <FormField
                    label="Yerel API URL"
                    htmlFor="login-local-api-url"
                    helper={<span>Örnek: <span className="font-mono text-zinc-300">http://10.166.1.23:18267/api</span></span>}
                    error={localApiUrlError}
                  >
                    <input
                      id="login-local-api-url"
                      value={localApiUrl}
                      onChange={(e) => setLocalApiUrl(e.target.value)}
                      placeholder={LOCAL_API_DEFAULT_URL}
                      className="ui-input"
                    />
                  </FormField>
                  <div className="text-[10px] text-zinc-500 mt-2 break-all">
                    Aktif: {effectiveLocalApiUrl || '-'}
                  </div>
                </Card>
                <Card className="p-3">
                  <FormField
                    label="API Key (Opsiyonel)"
                    htmlFor="login-local-api-key"
                    helper={<span>Header: <span className="font-mono text-zinc-300">X-Api-Key</span></span>}
                  >
                    <input
                      type="password"
                      id="login-local-api-key"
                      value={localApiKey}
                      onChange={(e) => setLocalApiKey(e.target.value)}
                      placeholder="X-Api-Key"
                      className="ui-input"
                    />
                  </FormField>
                </Card>
              </div>

              {isElectron && (
                <Card className="p-3 mt-3">
                  <FormField
                    label="Güncelleme URL (Desktop)"
                    htmlFor="desktop-update-url"
                    helper={<span>Örnek: <span className="font-mono text-zinc-300">http://10.166.1.23:3001/updates/desktop/</span></span>}
                    error={updateUrlError}
                  >
                    <input
                      id="desktop-update-url"
                      value={updateUrl}
                      onChange={(e) => setUpdateUrl(e.target.value)}
                      placeholder="http://.../updates/desktop/"
                      className="ui-input"
                    />
                  </FormField>
                  <div className="text-[10px] text-zinc-500 mt-2 break-all">
                    Aktif: {effectiveUpdateUrl || '(varsayılan)'}
                  </div>
                  <div className="mt-2">
                    <Button onClick={handleResetUpdateUrl} variant="secondary" size="sm">
                      Varsayılan
                    </Button>
                  </div>
                </Card>
              )}

              <div className="flex flex-col md:flex-row gap-2 mt-4">
                <Button
                  onClick={testLocalApiConnection}
                  variant="secondary"
                  className="flex-1 gap-2"
                  disabled={serverPingLoading}
                >
                  {serverPingLoading ? <RefreshCw size={14} className="animate-spin" /> : <Wifi size={14} />}
                  {serverPingLoading ? 'Test Ediliyor...' : 'Test Et'}
                </Button>
                <Button onClick={handleResetLocalApi} variant="secondary" className="flex-1">
                  Varsayılan
                </Button>
                <Button
                  onClick={async () => {
                    handleSaveLocalApi();
                    await handleSaveUpdateUrl();
                    setServerSettingsOpen(false);
                  }}
                  variant="primary"
                  className="flex-1"
                  disabled={!!localApiUrlError || !!updateUrlError}
                >
                  Kaydet
                </Button>
              </div>
        </Modal>
      </div>
    );
  }

  // === DASHBOARD ===
  if (currentPage === 'dashboard') {
    return (
      <div className="min-h-screen app-shell app-container text-foreground font-sans p-2 md:p-4">
        <header className="ui-header mb-6">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Malhotra" className="h-12 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-bold">Malhotra Güvenlik Paneli</h1>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                {isOnline ? <span className="text-green-400 flex items-center gap-1"><Wifi size={12} /> Online</span> : <span className="text-red-400 flex items-center gap-1"><WifiOff size={12} /> Offline</span>}
                <span>| {session?.user?.email || 'local'}</span>
                {totalQueueCount > 0 && (
                  <span className="ui-pill">Kuyruk: {totalQueueCount}</span>
                )}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1 break-all">
                Supabase: {supabaseUrl}
                {supabaseDebug.lastError ? ` | Error: ${supabaseDebug.lastError}` : ''}
                {supabaseDebug.lastCheckedAt ? ` | Check: ${new Date(supabaseDebug.lastCheckedAt).toLocaleTimeString('tr-TR')}` : ''}
              </div>
              <div className="text-[10px] text-zinc-500">Build: {BUILD_TIME}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <Button onClick={handleSystemReset} variant="secondary" className="gap-2" title="Takili kalirsa sistemi yeniler">
              <RefreshCw size={16} /> Yenile
            </Button>
            <Button onClick={recomputeActiveLogs} variant="secondary" className="gap-2" title="Aktif listeyi yeniden hesaplar">
              <RotateCcw size={16} /> Aktifleri Yenile
            </Button>
            {canUseSecurityPanel && (
              <Button onClick={() => setCurrentPage('import')} variant="secondary" className="gap-2">
                <Upload size={16} /> Veri Yükle
              </Button>
            )}
            {canUseSecurityPanel && (
              <Button onClick={() => setCurrentPage('main')} variant="primary" className="gap-2">
                <LogIn size={18} /> Giriş Paneli
              </Button>
            )}
             {canUseHrPanel && (
               <Button onClick={() => setCurrentPage('hr')} variant="secondary" className="gap-2">
                 <Briefcase size={16} /> İK Paneli
               </Button>
             )}
            {isDeveloperRole && (
              <Button onClick={() => setCurrentPage('audit')} variant="secondary" className="gap-2">
                <History size={16} /> Audit
              </Button>
            )}
            {enhancedAuditEnabled && (
              <>
                <Button onClick={exportAuditLogs} variant="secondary" className="gap-2">
                  <FileText size={14} /> Export
                </Button>
                <Button onClick={clearAuditLogs} variant="secondary" className="gap-2">
                  <Trash2 size={14} /> Temizle
                </Button>
              </>
            )}
            <Button onClick={handleRoleLogout} variant="destructive" className="gap-2">
              <LogOut size={16} /> Çıkış Yap
            </Button>
            {isElectron && (
              <Button onClick={handleAppExit} variant="destructive" className="gap-2">
                <LogOut size={18} /> Uygulamayı Kapat
              </Button>
            )}
          </div>
        </header>

        <main className="mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="text-blue-400" /> Dashboard & İstatistikler</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setSoundEnabled(!soundEnabled)}
                variant="ghost"
                className={`gap-2 ${soundEnabled ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted-foreground'}`}
              >
                {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </Button>
              <Button
                onClick={() => setLiteMode((prev) => !prev)}
                variant="ghost"
                className={`gap-2 ${liteMode ? 'bg-amber-500/20 text-amber-200' : 'text-muted-foreground'}`}
                title="Arayuz performans ayari"
              >
                <Zap size={16} />
                {liteMode ? 'Lite Acik' : 'Lite Kapali'}
              </Button>
              <Button
                onClick={() => (enabledFeatureCount > 0 ? disableNewFeatures() : enableNewFeatures())}
                variant="ghost"
                className={`gap-2 ${enabledFeatureCount > 0 ? 'bg-cyan-500/20 text-cyan-200' : 'text-muted-foreground'}`}
                title="Yeni ozellikleri tek tusla ac/kapat"
              >
                <Layers size={16} />
                {enabledFeatureCount > 0 ? 'Yeni Ozellikler Acik' : 'Yeni Ozellikler Kapali'}
              </Button>
              <Button onClick={() => setShowReportModal(true)} variant="secondary" size="sm" className="gap-2">
                <Calendar size={16} /> Tarih Seç
              </Button>
              <Button onClick={() => sendDailyReport(new Date().toISOString().split('T')[0])} disabled={sendingReport} variant="primary" size="sm" className="gap-2">
                {sendingReport ? <RefreshCw size={16} className="animate-spin" /> : <Mail size={16} />} {sendingReport ? 'Gönderiliyor...' : 'Bugünü Gönder'}
              </Button>
              <Button onClick={() => { const y = new Date(); y.setDate(y.getDate() - 1); sendDailyReport(y.toISOString().split('T')[0]); }} disabled={sendingReport} variant="secondary" size="sm" className="gap-2">
                {sendingReport ? <RefreshCw size={16} className="animate-spin" /> : <Mail size={16} />} {sendingReport ? 'Gönderiliyor...' : 'Dünü Gönder'}
              </Button>
            </div>
          </div>

          <div className="ui-panel mb-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="text-sm text-zinc-300">
                Ekstra Ozellikler: {enabledFeatureCount}/4 aktif
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={optionalAttachmentsEnabled ? 'primary' : 'secondary'} onClick={() => toggleFeatureFlag('optionalAttachments')}>Ekler</Button>
                <Button size="sm" variant={advancedReportEnabled ? 'primary' : 'secondary'} onClick={() => toggleFeatureFlag('advancedReport')}>Gelismis Rapor</Button>
                <Button size="sm" variant={offlineQueueInspectorEnabled ? 'primary' : 'secondary'} onClick={() => toggleFeatureFlag('offlineQueueInspector')}>Offline Kuyruk</Button>
                <Button size="sm" variant={enhancedAuditEnabled ? 'primary' : 'secondary'} onClick={() => toggleFeatureFlag('enhancedAudit')}>Audit+</Button>
              </div>
            </div>
            <div className="text-[11px] text-zinc-500 mt-2">
              Begenmezseniz tek tusla kapatabilirsiniz. Veriler korunur.
            </div>
          </div>

          {!showSyncPanel ? (
            <div className="mb-6">
              <Button onClick={() => setShowSyncPanel(true)} variant="secondary" className="gap-2">
                <Zap size={16} className="text-yellow-400" /> Sync Durumu Göster
              </Button>
            </div>
          ) : (
            <div className="ui-card p-4 mb-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <h3 className="text-lg font-bold flex items-center gap-2"><Zap className="text-yellow-400" /> Sync Durumu</h3>
                <div className="flex gap-2">
                  <Button onClick={handleManualSync} variant="secondary" className="gap-2">
                    <RefreshCw size={16} /> Şimdi Eşitle
                  </Button>
                  <Button onClick={() => setShowSyncPanel(false)} variant="ghost" className="text-muted-foreground">
                    Gizle
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Kuyruk</div>
                  <div className="text-xl font-bold">{syncQueueCount}</div>
                </div>
                <div className="ui-panel">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>Push</span>
                    <span className={`px-2 py-0.5 rounded ${pushBadge.className}`}>{pushBadge.label}</span>
                  </div>
                  <div className="text-sm mt-1">{formatSyncTime(syncStatus?.lastPushAt)}</div>
                </div>
                <div className="ui-panel">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>Pull</span>
                    <span className={`px-2 py-0.5 rounded ${pullBadge.className}`}>{pullBadge.label}</span>
                  </div>
                  <div className="text-sm mt-1">{formatSyncTime(syncStatus?.lastPullAt)}</div>
                  {syncStatus?.lastPullCount != null && (<div className="text-[10px] text-zinc-500">Çekilen: {syncStatus.lastPullCount}</div>)}
                </div>
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Son Hata</div>
                  <div className="text-[11px] text-red-300 break-words">{syncStatus?.lastPushError || syncStatus?.lastPullError || '-'}</div>
                </div>
              </div>

              {offlineQueueInspectorEnabled && (
                <div className="mt-4 border-t border-zinc-700 pt-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
                    <div className="text-sm text-zinc-300">Offline Kuyruk Denetimi</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => clearQueuedItems('offline')}>Offline Temizle</Button>
                      <Button size="sm" variant="secondary" onClick={() => clearQueuedItems('supabase')}>Supabase Temizle</Button>
                      <Button size="sm" variant="secondary" onClick={() => clearQueuedItems('local')}>Yerel Temizle</Button>
                      <Button size="sm" variant="destructive" onClick={() => clearQueuedItems('all')}>Tumunu Temizle</Button>
                    </div>
                  </div>
                  <div className="ui-table-wrap max-h-[220px]">
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th className="p-2 text-left text-[11px]">Kaynak</th>
                          <th className="p-2 text-left text-[11px]">Islem</th>
                          <th className="p-2 text-left text-[11px]">Kimlik</th>
                          <th className="p-2 text-left text-[11px]">Deneme</th>
                          <th className="p-2 text-left text-[11px]">Zaman</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueInspectorRows.slice(0, 50).map((row) => (
                          <tr key={`${row.source}-${row.idx}-${row.createdAt}`}>
                            <td className="p-2 text-xs">{row.source}</td>
                            <td className="p-2 text-xs">{row.action}</td>
                            <td className="p-2 text-xs break-all">{String(row.localId || '-')}</td>
                            <td className="p-2 text-xs">{row.attempts || 0}</td>
                            <td className="p-2 text-xs">{formatSyncTime(row.createdAt ? new Date(row.createdAt).toISOString() : null)}</td>
                          </tr>
                        ))}
                        {queueInspectorRows.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-3 text-xs text-zinc-500">Kuyrukta bekleyen kayit yok.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {isElectron && (
                <div className="mt-4 border-t border-zinc-700 pt-4">
                  <div className="text-sm text-zinc-400 mb-2">Lokal -> Supabase</div>
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                    <Button onClick={handleExportLocalToSupabase} variant="secondary" className="gap-2" disabled={bulkExportState.running}>
                      {bulkExportState.running ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                      {bulkExportState.running ? 'Aktariliyor...' : 'Lokal Verileri Supabase\'e Aktar'}
                    </Button>
                    <div className="text-xs text-zinc-400">
                      {bulkExportTotal > 0 ? `${bulkExportProcessed}/${bulkExportTotal} (${bulkExportPct}%)` : 'Hazir'}
                      {bulkExportState.lastError ? ` | Hata: ${bulkExportState.lastError}` : ''}
                    </div>
                  </div>
                  {bulkExportState.running && (
                    <div className="mt-2 h-2 w-full bg-zinc-800 rounded">
                      <div className="h-2 bg-blue-500 rounded" style={{ width: `${bulkExportPct}%` }} />
                    </div>
                  )}
                </div>
              )}

              {LOCAL_SYNC_ENABLED && (
                <div className="mt-4 border-t border-zinc-700 pt-4">
                  <div className="text-sm text-zinc-400 mb-2">Yerel Sunucu Sync</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400">Yerel Kuyruk</div>
                    <div className="text-xl font-bold">{localQueueCount}</div>
                  </div>
                  <div className="ui-panel">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span>Yerel Push</span>
                      <span className={`px-2 py-0.5 rounded ${localPushBadge.className}`}>{localPushBadge.label}</span>
                    </div>
                    <div className="text-sm mt-1">{formatSyncTime(localStatus?.lastPushAt)}</div>
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400">Yerel Son Hata</div>
                    <div className="text-[11px] text-red-300 break-words">{localStatus?.lastPushError || '-'}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <Card className="md:col-span-2 p-3">
                    <FormField
                      label="Yerel API URL"
                      htmlFor="local-api-url"
                      helper={<span>Örnek: <span className="font-mono text-zinc-300">http://localhost:8000/api</span> (sonunda <span className="font-mono text-zinc-300">/api</span> olmalı)</span>}
                      error={localApiUrlError}
                    >
                      <input
                        id="local-api-url"
                        value={localApiUrl}
                        onChange={(e) => setLocalApiUrl(e.target.value)}
                        placeholder={LOCAL_API_DEFAULT_URL}
                        className="ui-input"
                      />
                    </FormField>
                    <div className="text-[10px] text-zinc-500 mt-2 break-all">
                      Aktif: {effectiveLocalApiUrl || '-'}
                    </div>
                  </Card>
                  <Card className="p-3">
                    <FormField
                      label="API Key (Opsiyonel)"
                      htmlFor="local-api-key"
                      helper={<span>Gonderilen header: <span className="font-mono text-zinc-300">X-Api-Key</span>. Backend'de zorunluysa burada doldurun.</span>}
                    >
                      <input
                        type="password"
                        id="local-api-key"
                        value={localApiKey}
                        onChange={(e) => setLocalApiKey(e.target.value)}
                        placeholder="X-Api-Key"
                        className="ui-input"
                      />
                    </FormField>
                    <FormField
                      label="JWT Token (Opsiyonel)"
                      htmlFor="local-api-token"
                      helper={<span>Gonderilen header: <span className="font-mono text-zinc-300">Authorization: Bearer &lt;token&gt;</span></span>}
                    >
                      <input
                        type="password"
                        id="local-api-token"
                        value={localApiToken}
                        onChange={(e) => setLocalApiToken(e.target.value)}
                        placeholder="Bearer token"
                        className="ui-input"
                      />
                    </FormField>
                    <div className="flex gap-2 mt-3">
                      <Button onClick={handleSaveLocalApi} variant="primary" className="flex-1">
                        Kaydet
                      </Button>
                      <Button onClick={handleResetLocalApi} variant="secondary" className="flex-1">
                        Varsayılan
                      </Button>
                    </div>
                  </Card>
                </div>
                </div>
              )}
            </div>
          )}

          {isElectron && (
            !showSmtpPanel ? (
              <div className="mb-6">
                <Button onClick={() => setShowSmtpPanel(true)} variant="secondary" className="gap-2">
                  <Mail size={16} className="text-purple-400" /> SMTP Ayarlarını Göster
                </Button>
              </div>
            ) : (
              <div className="ui-card p-4 mb-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                  <h3 className="text-lg font-bold flex items-center gap-2"><Mail className="text-purple-400" /> E-posta (SMTP)</h3>
                  <div className="flex gap-2">
                    <Button onClick={handleTestSmtp} variant="secondary" className="gap-2">
                      <CheckCircle size={16} /> Test
                    </Button>
                    <Button onClick={handleRunEmailSchedulerNow} variant="secondary" className="gap-2" disabled={smtpRunNowLoading}>
                      <Send size={16} /> {smtpRunNowLoading ? 'Calisiyor...' : 'Gunluk Tetikle'}
                    </Button>
                    <Button onClick={handleSaveSmtpSettings} variant="primary" className="gap-2">
                      <CheckCircle size={16} /> Kaydet
                    </Button>
                    <Button onClick={() => setShowSmtpPanel(false)} variant="ghost" className="text-muted-foreground">
                      Gizle
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400 mb-2">SMTP Host</div>
                    <input
                      value={smtpForm.host || ''}
                      onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), host: e.target.value }))}
                      placeholder="smtp.example.com"
                      className="ui-input"
                    />
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400 mb-2">Port</div>
                    <input
                      type="number"
                      value={smtpForm.port ?? ''}
                      onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), port: Number(e.target.value) }))}
                      placeholder="587"
                      className="ui-input"
                    />
                    <div className="flex items-center gap-2 mt-3 text-sm">
                      <input
                        id="smtp-secure"
                        type="checkbox"
                        checked={!!smtpForm.secure}
                        onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), secure: e.target.checked }))}
                        className="ui-checkbox"
                      />
                      <label htmlFor="smtp-secure" className="text-zinc-300">SSL/TLS (465)</label>
                    </div>
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400 mb-2">Gönderici (User)</div>
                    <input
                      value={smtpForm.user || ''}
                      onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), user: e.target.value }))}
                      placeholder="mail@domain.com"
                      className="ui-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400 mb-2">Şifre</div>
                    <input
                      type="password"
                      value={smtpPassInput}
                      onChange={(e) => setSmtpPassInput(e.target.value)}
                      placeholder={smtpForm.pass ? '⬢⬢⬢⬢⬢⬢ (değiştirmek için yazın)' : 'Şifre'}
                      className="ui-input"
                    />
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400 mb-2">Gönderen Adı</div>
                    <input
                      value={smtpForm.fromName || ''}
                      onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), fromName: e.target.value }))}
                      placeholder="Güvenlik Paneli"
                      className="ui-input"
                    />
                    <div className="flex items-center gap-2 mt-3 text-sm">
                      <input
                        id="smtp-enabled"
                        type="checkbox"
                        checked={!!smtpForm.enabled}
                        onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), enabled: e.target.checked }))}
                        className="ui-checkbox"
                      />
                      <label htmlFor="smtp-enabled" className="text-zinc-300">Zamanlayıcı aktif</label>
                    </div>
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400 mb-2">Zaman</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        value={smtpForm.scheduleHour ?? ''}
                        onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), scheduleHour: Number(e.target.value) }))}
                        placeholder="Saat"
                        className="ui-input"
                      />
                      <input
                        type="number"
                        value={smtpForm.scheduleMinute ?? ''}
                        onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), scheduleMinute: Number(e.target.value) }))}
                        placeholder="Dakika"
                        className="ui-input"
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-sm">
                      <input
                        id="smtp-allow-invalid"
                        type="checkbox"
                        checked={!!smtpForm.allowInvalidCerts}
                        onChange={(e) => setSmtpDraft(prev => ({ ...(prev || smtpForm), allowInvalidCerts: e.target.checked }))}
                        className="ui-checkbox"
                      />
                      <label htmlFor="smtp-allow-invalid" className="text-zinc-300">Sertifika doğrulama kapalı</label>
                    </div>
                  </div>
                </div>

                <div className="ui-panel mt-3">
                  <div className="text-xs text-zinc-400 mb-2">Alıcılar (satır satır veya virgülle)</div>
                  <textarea
                    value={smtpRecipientsText}
                    onChange={(e) => setSmtpRecipientsText(e.target.value)}
                    placeholder="ornek@domain.com\nornek2@domain.com"
                    className="ui-input min-h-[90px]"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400">Son calisma</div>
                    <div className="text-sm mt-1">{formatSyncTime(emailSchedulerStatus?.lastRunTime)}</div>
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400">Durum</div>
                    <div className="text-sm mt-1">{emailSchedulerStatus?.lastRunStatus || '-'}</div>
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400">Sonraki</div>
                    <div className="text-sm mt-1">{formatSyncTime(emailSchedulerStatus?.nextRun)}</div>
                  </div>
                  <div className="ui-panel">
                    <div className="text-xs text-zinc-400">Son hata</div>
                    <div className="text-[11px] text-red-300 break-words">{emailSchedulerStatus?.lastRunError || '-'}</div>
                  </div>
                </div>
                <div className="text-[10px] text-zinc-500 mt-2 break-all">
                  Plan: {emailSchedulerStatus?.schedule || '-'} | Aktif: {emailSchedulerStatus?.enabled ? 'Evet' : 'Hayir'} | Son basarili rapor: {emailSchedulerStatus?.lastSuccessDateISO || '-'} | Dry-run: {smtpForm.dryRun ? 'Acik' : 'Kapali'}
                </div>
              </div>
            )
          )}

          {isElectron && (
            <div className="ui-card p-4 mb-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <h3 className="text-lg font-bold flex items-center gap-2"><FileText className="text-green-400" /> Yedekleme</h3>
                <div className="flex gap-2">
                  <Button onClick={handleBackupNow} variant="secondary" size="sm" className="gap-2">
                    <CheckCircle size={16} /> Yedek Al
                  </Button>
                  <Button onClick={handleOpenBackupFolder} variant="secondary" size="sm" className="gap-2">
                    <Folder size={16} /> Klasör
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Son Yedek</div>
                  <div className="text-sm mt-1">{formatSyncTime(backupStatus?.lastRunTime)}</div>
                </div>
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Durum</div>
                  <div className="text-sm mt-1">{backupStatus?.lastRunStatus || '-'}</div>
                </div>
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Sonraki</div>
                  <div className="text-sm mt-1">{formatSyncTime(backupStatus?.nextRun)}</div>
                </div>
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Son Hata</div>
                  <div className="text-[11px] text-red-300 break-words">{backupStatus?.lastRunError || '-'}</div>
                </div>
              </div>
              <div className="text-[10px] text-zinc-500 mt-2 break-all">
                Klasör: {backupStatus?.folder || '-'} | Saklama: {backupStatus?.retention ?? '-'}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-gradient-to-br from-amber-600/90 to-amber-800/80 p-5 rounded-xl shadow-lg border border-amber-500/20"><div className="flex items-center justify-between"><div><p className="text-amber-200 text-sm font-medium">Bugün Toplam</p><p className="text-3xl font-bold text-white mt-1">{stats.today}</p></div><Activity className="text-amber-300" size={40} /></div></div>
            <div className="bg-gradient-to-br from-emerald-600/90 to-emerald-800/80 p-5 rounded-xl shadow-lg border border-emerald-500/20"><div className="flex items-center justify-between"><div><p className="text-emerald-200 text-sm font-medium">Şu An İçeride</p><p className="text-3xl font-bold text-white mt-1">{stats.activeNow}</p></div><Users className="text-emerald-300" size={40} /></div></div>
            <div className={`bg-gradient-to-br ${stats.longStayCount > 0 ? 'from-red-600/90 to-red-800/80 border-red-500/20' : 'from-zinc-700/80 to-zinc-800/80 border-zinc-600/20'} p-5 rounded-xl shadow-lg border`}><div className="flex items-center justify-between"><div><p className={stats.longStayCount > 0 ? 'text-red-200' : 'text-zinc-300'}>4+ Saat İçeride</p><p className="text-3xl font-bold text-white mt-1">{stats.longStayCount}</p></div><AlertCircle className={stats.longStayCount > 0 ? 'text-red-300 animate-pulse' : 'text-zinc-400'} size={40} /></div></div>
            <div className="bg-gradient-to-br from-orange-600/90 to-orange-800/80 p-5 rounded-xl shadow-lg border border-orange-500/20"><div className="flex items-center justify-between"><div><p className="text-orange-200 text-sm font-medium">Bu Hafta</p><p className="text-3xl font-bold text-white mt-1">{stats.week}</p></div><TrendingUp className="text-orange-300" size={40} /></div></div>
            <div className="bg-gradient-to-br from-yellow-600/90 to-amber-800/80 p-5 rounded-xl shadow-lg border border-yellow-500/20"><div className="flex items-center justify-between"><div><p className="text-yellow-200 text-sm font-medium">Ort. Kalış Süresi</p><p className="text-2xl font-bold text-white mt-1">{Math.floor(stats.avgStayMins / 60)}s {stats.avgStayMins % 60}dk</p></div><Timer className="text-yellow-300" size={40} /></div></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="ui-card p-5">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Clock className="text-blue-400" /> Bugün Detay</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-zinc-900 rounded"><span className="flex items-center gap-2"><Car className="text-blue-400" size={18} /> Araç Girişi</span><span className="font-bold text-xl">{stats.todayVehicle}</span></div>
                <div className="flex justify-between items-center p-3 bg-zinc-900 rounded"><span className="flex items-center gap-2"><User className="text-purple-400" size={18} /> Ziyaretçi</span><span className="font-bold text-xl">{stats.todayVisitor}</span></div>
              </div>
            </div>

            <div className="ui-card p-5">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><PieChart className="text-green-400" /> Kategori Dağılımı</h3>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {Object.entries(stats.categoryStats).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([cat, count]) => (
                  <div key={cat} className="flex justify-between items-center p-2 bg-zinc-900 rounded text-sm"><span className="truncate">{cat}</span><span className="font-bold bg-zinc-700 px-2 py-1 rounded">{count}</span></div>
                ))}
              </div>
            </div>

            <div className="ui-card p-5">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><TrendingUp className="text-orange-400" /> Son 7 Gün</h3>
              <div className="flex items-end justify-between h-[150px] gap-2">
                {stats.dailyStats.map((day, idx) => {
                  const maxCount = Math.max(...stats.dailyStats.map(d => d.count), 1);
                  const height = (day.count / maxCount) * 100;
                  return (
                    <div key={idx} className="flex flex-col items-center flex-1"><span className="text-xs font-bold mb-1">{day.count}</span><div className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t transition-all" style={{ height: `${Math.max(height, 5)}%` }}></div><span className="text-[10px] text-zinc-400 mt-1 text-center">{day.date}</span></div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-6 ui-card p-5">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Layers className="text-yellow-400" /> Bugünkü Vardiya Dağılımı</h3>
            <div className="grid grid-cols-3 gap-4">
              {['Vardiya 1 (08:00-16:00)', 'Vardiya 2 (16:00-00:00)', 'Vardiya 3 (00:00-08:00)'].map(shift => (
                <div key={shift} className={`p-4 rounded-xl text-center ${currentShift === shift ? 'bg-blue-600' : 'bg-zinc-900'}`}><p className="text-sm text-zinc-300">{shift.split(' ')[0]} {shift.split(' ')[1]}</p><p className="text-2xl font-bold mt-1">{stats.shiftStats[shift] || 0}</p></div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="ui-card p-5">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Star className="text-yellow-400" /> Sık Gelen Araç/Ziyaretçiler</h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {frequentVisitors.length > 0 ? frequentVisitors.map((visitor, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-zinc-900 rounded-lg hover:bg-zinc-700 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${idx < 3 ? 'bg-yellow-500 text-black' : 'bg-zinc-700 text-white'}`}>{idx + 1}</div>
                      <div><p className="font-bold text-white">{visitor.key}</p><p className="text-xs text-zinc-400">{visitor.category} • {visitor.host}</p></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right"><p className="font-bold text-blue-400">{visitor.count} kez</p><p className="text-[10px] text-zinc-500">Son: {new Date(visitor.lastVisit).toLocaleDateString('tr-TR')}</p></div>
                      <button onClick={() => quickEntry(visitor.key, visitor.category, visitor.host)} className="opacity-0 group-hover:opacity-100 bg-green-600 hover:bg-green-500 text-white p-2 rounded transition-all" title="Hızlı Giriş"><Zap size={14} /></button>
                    </div>
                  </div>
                )) : <div className="text-center text-zinc-500 py-8 italic">Henüz yeterli veri yok</div>}
              </div>
            </div>

            <div className="ui-card p-5">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Zap className="text-green-400" /> Hızlı İşlemler</h3>
              <div className="space-y-4">
                <div className="ui-panel-lg">
                  <div className="flex justify-between items-center mb-3"><span className="text-zinc-400 text-sm">Şu an içeride</span><span className="text-2xl font-bold text-green-400">{activeLogs.length}</span></div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-zinc-800 p-2 rounded flex justify-between"><span className="text-zinc-400">Araç</span><span className="font-bold">{activeVehicleCount}</span></div>
                    <div className="bg-zinc-800 p-2 rounded flex justify-between"><span className="text-zinc-400">Ziyaretçi</span><span className="font-bold">{activeVisitorCount}</span></div>
                  </div>
                </div>
                {longStayLogsList.length > 0 && (
                  <div className="bg-red-900/30 border border-red-500/50 p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-2"><AlertTriangle className="text-red-400" size={18} /><span className="text-red-300 font-bold">4+ Saat İçeride</span></div>
                    <div className="space-y-1 max-h-[120px] overflow-y-auto">
                      {longStayLogsList.map(log => (
                        <div key={log.id} className="flex justify-between items-center text-sm bg-red-900/30 p-2 rounded">
                          <span className="text-red-200">{log.plate || log.name}</span>
                          <span className="text-red-400 font-mono">{Math.floor((new Date() - new Date(log.created_at)) / 3600000)}s {Math.floor(((new Date() - new Date(log.created_at)) % 3600000) / 60000)}dk</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="ui-panel-lg">
                  <p className="text-zinc-400 text-sm mb-2">Son Çıkışlar</p>
                  <div className="space-y-1 max-h-[100px] overflow-y-auto">
                    {recentExitedLogs.map(log => (
                      <div key={log.id} className="flex justify-between items-center text-sm text-zinc-300">
                        <span>{log.plate || log.name}</span>
                        <span className="text-zinc-500">{new Date(log.exit_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <Toast notification={notification} onClose={closeToast} />
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          type={confirmModal.type}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          secondaryLabel={confirmModal.secondaryLabel}
          secondaryVariant={confirmModal.secondaryVariant}
          confirmVariant={confirmModal.confirmVariant}
          onSecondary={confirmModal.onSecondary}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        />

        <Modal isOpen={showReportModal} onClose={() => setShowReportModal(false)} title={<span className="flex gap-2 items-center"><Mail className="text-purple-500" /> Tarih Seçerek Rapor Gönder</span>} size="sm">
          <div className="space-y-4">
            <FormField label="RAPOR TARİHİ"><Input type="date" value={reportDateFrom} onChange={e => setReportDateFrom(e.target.value)} max={new Date().toISOString().split('T')[0]} /></FormField>
            <div className="ui-panel-lg">
              <p className="text-zinc-400 text-sm mb-2">Alıcılar:</p>
              {isElectron ? (
                (emailSettings?.recipients?.length || 0) > 0 ? (
                  <ul className="text-sm space-y-1">
                    {emailSettings.recipients.map((r) => (
                      <li key={r} className="text-zinc-300">• {r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-500 italic">SMTP alıcıları ayarlanmamış</p>
                )
              ) : (
                <p className="text-sm text-zinc-500 italic">Web modunda rapor Excel olarak indirilir</p>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={() => setShowReportModal(false)} variant="secondary" className="flex-1">İptal</Button>
              <Button onClick={() => { if (!reportDateFrom) { showToast("Lütfen tarih seçin", "error"); return; } setShowReportModal(false); sendDailyReport(reportDateFrom); }} disabled={sendingReport || !reportDateFrom} variant="primary" className="flex-1 gap-2"><Send size={18} /> Rapor Gönder</Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // === CSV İÇE AKTAR ===
  if (currentPage === 'import') {
    const progressTotal = importProgress?.total || 0;
    const progressDone = importProgress?.processed || 0;
    const progressPct = progressTotal > 0 ? Math.min(100, Math.round((progressDone / progressTotal) * 100)) : 0;

    return (
      <div className="min-h-screen app-shell app-container text-foreground font-sans p-2 md:p-4">
        <header className="ui-header mb-6">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Malhotra" className="h-12 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-bold">Verileri Yükle</h1>
              <div className="text-[10px] text-zinc-500">Build: {BUILD_TIME}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setCurrentPage('dashboard')} variant="secondary" className="gap-2">
              <BarChart3 size={16} /> Dashboard
            </Button>
            <Button onClick={() => setCurrentPage('import')} variant="secondary" className="gap-2">
              <Upload size={16} /> Veri Yükle
            </Button>
            <Button onClick={() => setCurrentPage('main')} variant="primary" className="gap-2">
              <LogIn size={16} /> Giriş Paneli
            </Button>
          </div>
        </header>

        <main className="space-y-6">
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Folder className="text-blue-400" />
              <h2 className="text-xl font-bold">CSV İçeri Aktar</h2>
            </div>
            <p className="text-sm text-zinc-400">
              CSV dosyası seçin. Kayıtlar <code className="text-xs">created_at</code> alanına göre eşleştirilir; aynı zaman damgası varsa güncellenir.
            </p>
            <p className="text-xs text-zinc-500">
              Beklenen kolonlar: event_type, type, sub_category, shift, plate, driver, name, host, note, location, seal_number,
              seal_number_entry, seal_number_exit, tc_no, phone, user_email, created_at, exit_at.
            </p>

            {!isElectron && (
              <div className="ui-panel bg-blue-900/20 border border-blue-500/40 text-blue-200 text-sm">
                Web modunda yükleme Supabase'e yapılır. İnternet bağlantısı gereklidir.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <FormField label="CSV Dosyası" htmlFor="csv-import-file">
                <input
                  id="csv-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="ui-input"
                  onChange={handleImportFileChange}
                  disabled={importing}
                />
              </FormField>
              <div className="text-xs text-zinc-400">
                {importFileName ? <>Seçilen dosya: <span className="text-zinc-200">{importFileName}</span></> : 'Dosya seçilmedi'}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={runCsvImport} variant="primary" className="gap-2" disabled={importing || !importFile}>
                {importing ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                {importing ? 'Yükleniyor...' : 'Yüklemeyi Başlat'}
              </Button>
              <Button
                onClick={() => { setImportFile(null); setImportFileName(''); setImportResult(null); setImportError(''); setImportProgress({ processed: 0, total: 0 }); }}
                variant="secondary"
                disabled={importing}
              >
                Temizle
              </Button>
            </div>

            {importing && (
              <div className="space-y-2">
                <div className="text-xs text-zinc-400">İşleniyor: {progressDone}/{progressTotal}</div>
                <div className="h-2 w-full bg-zinc-800 rounded">
                  <div className="h-2 bg-blue-500 rounded" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            {importResult && (
              <div className="ui-panel bg-emerald-900/20 border border-emerald-500/40 text-emerald-200 text-sm space-y-1">
                <div>Toplam: {importResult.total ?? 0}</div>
                <div>Eklenen: {importResult.inserted ?? 0}</div>
                <div>Güncellenen: {importResult.updated ?? 0}</div>
                <div>Geçersiz: {importResult.invalid ?? 0}</div>
                <div>Hatalı: {importResult.errors ?? 0}</div>
              </div>
            )}

            {importError && (
              <div className="ui-panel bg-red-900/20 border border-red-500/40 text-red-200 text-sm">
                Hata: {importError}
              </div>
            )}
          </Card>
        </main>
      </div>
    );
  }

  // === AUDIT ===
  if (currentPage === 'audit') {
    return (
      <div className="min-h-screen app-shell app-container text-foreground font-sans p-2 md:p-4">
        <header className="ui-header mb-6">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Malhotra" className="h-12 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-bold">Geliştirici Audit Paneli</h1>
              <div className="text-xs text-zinc-400">{session?.user?.username || session?.user?.email} | {activeRole}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setCurrentPage('dashboard')} variant="secondary" className="gap-2">
              <BarChart3 size={16} /> Dashboard
            </Button>
            <Button onClick={loadServerAuditLogs} variant="primary" className="gap-2" disabled={serverAuditLoading}>
              {serverAuditLoading ? <RefreshCw size={14} className="animate-spin" /> : <History size={14} />} Sunucu Loglarını Yenile
            </Button>
            {enhancedAuditEnabled && (
              <>
                <Button onClick={exportAuditLogs} variant="secondary" className="gap-2">
                  <FileText size={14} /> Export
                </Button>
                <Button onClick={clearAuditLogs} variant="secondary" className="gap-2">
                  <Trash2 size={14} /> Temizle
                </Button>
              </>
            )}
            <Button onClick={handleRoleLogout} variant="destructive" className="gap-2">
              <LogOut size={16} /> Çıkış Yap
            </Button>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-4">
            <h3 className="text-lg font-bold mb-3">Uygulama İşlem Logları</h3>
            {enhancedAuditEnabled && (
              <div className="ui-panel mb-3">
                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <input
                    type="text"
                    placeholder="Audit ara..."
                    value={auditSearchTerm}
                    onChange={(e) => setAuditSearchTerm(e.target.value)}
                    className="ui-input"
                  />
                  <select value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)} className="ui-input md:max-w-[220px]">
                    <option value="all">Tum Islem Tipleri</option>
                    <option value="auth">auth.*</option>
                    <option value="log">log.*</option>
                    <option value="sync">sync.*</option>
                    <option value="page">page.*</option>
                  </select>
                </div>
                <div className="text-[11px] mt-2">
                  Butunluk: {auditIntegrity.ok ? <span className="text-emerald-300">OK</span> : <span className="text-red-300">Bozuk (#{auditIntegrity.brokenIndex})</span>}
                </div>
              </div>
            )}
            <div className="max-h-[520px] overflow-y-auto space-y-2">
              {(enhancedAuditEnabled ? filteredAuditLogs : auditLogs).map((item) => (
                <div key={item.id} className="ui-panel text-xs">
                  <div className="text-zinc-300 font-semibold">{item.action}</div>
                  <div className="text-zinc-500">{new Date(item.at).toLocaleString('tr-TR')}</div>
                  <div className="text-zinc-400">{item.user} | {item.role}</div>
                  {item.message ? <div className="text-zinc-300 break-words mt-1">{item.message}</div> : null}
                  {enhancedAuditEnabled && item.hash ? <div className="text-[10px] text-zinc-500 mt-1">#{item.hash}</div> : null}
                </div>
              ))}
              {(enhancedAuditEnabled ? filteredAuditLogs.length : auditLogs.length) === 0 ? <div className="text-sm text-zinc-500">Kayit yok.</div> : null}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-lg font-bold mb-3">Sunucu Audit Logları</h3>
            <div className="max-h-[520px] overflow-y-auto space-y-2">
              {serverAuditLogs.map((item) => (
                <div key={item.id} className="ui-panel text-xs">
                  <div className="text-zinc-300 font-semibold">{item.action}</div>
                  <div className="text-zinc-500">{new Date(item.created_at).toLocaleString('tr-TR')}</div>
                  <div className="text-zinc-400">
                    {(item.actor_user?.username || item.actor_user?.email || 'system')} | {item.object_type || '-'} | {item.object_id || '-'}
                  </div>
                  {item.message ? <div className="text-zinc-300 break-words mt-1">{item.message}</div> : null}
                </div>
              ))}
              {serverAuditLogs.length === 0 ? <div className="text-sm text-zinc-500">Sunucudan log gelmedi. Yenile butonuna basın.</div> : null}
            </div>
          </Card>
        </main>
      </div>
    );
  }

  // === HR / PUANTAJ ===
  if (currentPage === 'hr') {
    const legacyHrEnabled = true;
    if (!legacyHrEnabled) {
      return (
        <div className="min-h-screen app-shell app-container text-foreground font-sans p-2 md:p-4">
          <header className="ui-header mb-6">
            <div className="flex items-center gap-3">
              <img src={logoImg} alt="Malhotra" className="h-12 w-auto object-contain" />
              <div>
                <h1 className="text-xl font-bold">Malhotra Güvenlik Paneli</h1>
                <div className="text-[10px] text-zinc-500">Build: {BUILD_TIME}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setCurrentPage('dashboard')} variant="secondary" className="gap-2">
                <BarChart3 size={16} /> Dashboard
              </Button>
              <Button onClick={() => setCurrentPage('import')} variant="secondary" className="gap-2">
                <Upload size={16} /> Veri Yükle
              </Button>
              <Button onClick={() => setCurrentPage('main')} variant="primary" className="gap-2">
                <LogIn size={16} /> Giriş Paneli
              </Button>
            </div>
          </header>

          <main className="space-y-6">
            <Card className="p-5">
              <h2 className="text-2xl font-bold mb-2">HR / Puantaj kaldırıldı</h2>
              <p className="text-sm text-muted-foreground">
                Bu bölüm hatalı/istenmeyen bir özellik olarak devre dışı bırakıldı.
              </p>
              <div className="flex gap-2 mt-4">
                <Button onClick={() => setCurrentPage('dashboard')} variant="secondary">Dashboard'a dön</Button>
                <Button onClick={() => setCurrentPage('main')} variant="primary">Giriş paneline git</Button>
              </div>
            </Card>
          </main>
        </div>
      );
    }

    return (
      <div className="min-h-screen app-shell app-container text-foreground font-sans p-2 md:p-4">
        <header className="ui-header mb-6">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Malhotra" className="h-12 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-bold">HR & Puantaj Paneli</h1>
              <div className="text-xs text-zinc-400">API: {effectiveLocalApiUrl}</div>
              <div className="text-[10px] text-zinc-500">Build: {BUILD_TIME}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setCurrentPage('dashboard')} variant="secondary" className="gap-2">
              <BarChart3 size={16} /> Dashboard
            </Button>
            <Button onClick={() => setCurrentPage('main')} variant="primary" className="gap-2">
              <LogIn size={16} /> Giriş Paneli
            </Button>
          </div>
        </header>

        <main className="space-y-6">
          <Card className="p-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div>
                <h3 className="text-lg font-bold">Yerel API Kimlik</h3>
                <p className="text-xs text-zinc-400">JWT token ile HR API'lerine erişim.</p>
              </div>
              <div className="text-xs text-zinc-500">Token: {localApiToken ? 'Hazır' : 'Yok'}</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
              <FormField label="JWT Token" htmlFor="hr-jwt-token">
                <input
                  id="hr-jwt-token"
                  type="password"
                  value={localApiToken}
                  onChange={(e) => setLocalApiToken(e.target.value)}
                  placeholder="Bearer token"
                  className="ui-input"
                />
              </FormField>
              <FormField label="Kullanıcı" htmlFor="hr-api-user">
                <input
                  id="hr-api-user"
                  value={localApiAuthUser}
                  onChange={(e) => setLocalApiAuthUser(e.target.value)}
                  placeholder="admin"
                  className="ui-input"
                />
              </FormField>
              <FormField label="Şifre" htmlFor="hr-api-pass">
                <input
                  id="hr-api-pass"
                  type="password"
                  value={localApiAuthPass}
                  onChange={(e) => setLocalApiAuthPass(e.target.value)}
                  placeholder="••••••"
                  className="ui-input"
                />
              </FormField>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button onClick={handleSaveLocalApi} variant="secondary">Token Kaydet</Button>
              <Button onClick={handleLocalApiLogin} variant="primary" className="gap-2" disabled={localApiAuthLoading}>
                {localApiAuthLoading ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />} Giriş Yap
              </Button>
              <Button onClick={handleLocalApiLogout} variant="ghost">Token Temizle</Button>
            </div>
          </Card>

          <div className="ui-card p-3 flex flex-wrap gap-2">
            <Button onClick={() => setHrTab('absence-types')} variant={hrTab === 'absence-types' ? 'primary' : 'secondary'} size="sm">Devamsızlık Türleri</Button>
            <Button onClick={() => setHrTab('absence-records')} variant={hrTab === 'absence-records' ? 'primary' : 'secondary'} size="sm">Devamsızlık Kayıtları</Button>
            <Button onClick={() => setHrTab('shifts')} variant={hrTab === 'shifts' ? 'primary' : 'secondary'} size="sm">Vardiyalar</Button>
            <Button onClick={() => setHrTab('assignments')} variant={hrTab === 'assignments' ? 'primary' : 'secondary'} size="sm">Vardiya Atamaları</Button>
            <Button onClick={() => setHrTab('attendance')} variant={hrTab === 'attendance' ? 'primary' : 'secondary'} size="sm">Puantaj Özeti</Button>
            <Button onClick={() => setHrTab('payroll')} variant={hrTab === 'payroll' ? 'primary' : 'secondary'} size="sm">Bordro / SGK</Button>
          </div>

          {hrError && (
            <div className="ui-card p-3 border border-red-500 text-red-300 text-sm">
              {hrError}
            </div>
          )}

          {hrTab === 'absence-types' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-4">
                <h3 className="text-lg font-bold mb-4">Yeni Tür</h3>
                <div className="space-y-3">
                  <FormField label="Tür Adı">
                    <input className="ui-input" value={absenceTypeDraft.name} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, name: e.target.value })} />
                  </FormField>
                  <FormField label="Kod (slug)">
                    <input className="ui-input" value={absenceTypeDraft.code} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, code: e.target.value })} />
                  </FormField>
                  <FormField label="Süre Birimi">
                    <select className="ui-input" value={absenceTypeDraft.default_unit} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, default_unit: e.target.value })}>
                      <option value="FULL_DAY">Tam Gün</option>
                      <option value="HALF_DAY">Yarım Gün</option>
                      <option value="HOURLY">Saatlik</option>
                    </select>
                  </FormField>
                  <FormField label="SGK Kodu (opsiyonel)">
                    <input className="ui-input" value={absenceTypeDraft.sgk_code} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, sgk_code: e.target.value })} />
                  </FormField>
                  <FormField label="Açıklama">
                    <textarea className="ui-input h-24 resize-none" value={absenceTypeDraft.description} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, description: e.target.value })} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-2 text-sm text-zinc-300">
                    <label className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={absenceTypeDraft.is_paid} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, is_paid: e.target.checked })} /> Ücretli</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={absenceTypeDraft.affects_payroll} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, affects_payroll: e.target.checked })} /> Bordroya Etki</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={absenceTypeDraft.affects_sgk} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, affects_sgk: e.target.checked })} /> SGK Etkisi</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={absenceTypeDraft.affects_premium} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, affects_premium: e.target.checked })} /> Prim Etkisi</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={absenceTypeDraft.requires_document} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, requires_document: e.target.checked })} /> Belge Gerekli</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={absenceTypeDraft.is_excused_default} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, is_excused_default: e.target.checked })} /> Mazeretli</label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={absenceTypeDraft.is_active} onChange={(e) => setAbsenceTypeDraft({ ...absenceTypeDraft, is_active: e.target.checked })} /> Aktif</label>
                  </div>
                  <Button onClick={createAbsenceType} className="w-full" variant="primary" disabled={hrLoading}>Tür Ekle</Button>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold">Tür Listesi</h3>
                  <Button onClick={loadAbsenceTypes} size="sm" variant="secondary">Yenile</Button>
                </div>
                <div className="ui-table-wrap max-h-[360px]">
                  <table className="ui-table">
                    <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                      <tr>
                        <th className="p-3">Ad</th>
                        <th className="p-3">Kod</th>
                        <th className="p-3">Birim</th>
                        <th className="p-3">Ücret/SGK</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-700">
                      {absenceTypes.map((t) => (
                        <tr key={t.id}>
                          <td className="p-3 text-sm font-semibold">{t.name}</td>
                          <td className="p-3 text-xs text-zinc-300">{t.code}</td>
                          <td className="p-3 text-xs">{t.default_unit}</td>
                          <td className="p-3 text-xs text-zinc-400">{t.is_paid ? 'Ücretli' : 'Ücretsiz'} / {t.affects_sgk ? 'SGK' : '-'}</td>
                        </tr>
                      ))}
                      {absenceTypes.length === 0 && (
                        <tr><td colSpan={4} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {hrTab === 'absence-records' && (
            <div className="space-y-6">
              <Card className="p-4">
                <h3 className="text-lg font-bold mb-3">Yeni Devamsızlık Kaydı</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField label="Personel ID">
                    <input className="ui-input" value={absenceRecordDraft.person} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, person: e.target.value })} placeholder="UUID" />
                  </FormField>
                  <FormField label="Tür">
                    <select className="ui-input" value={absenceRecordDraft.absence_type} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, absence_type: e.target.value })}>
                      <option value="">Seçin</option>
                      {absenceTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                  </FormField>
                  <FormField label="Süre Birimi">
                    <select className="ui-input" value={absenceRecordDraft.duration_unit} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, duration_unit: e.target.value })}>
                      <option value="FULL_DAY">Tam Gün</option>
                      <option value="HALF_DAY">Yarım Gün</option>
                      <option value="HOURLY">Saatlik</option>
                    </select>
                  </FormField>
                  <FormField label="Başlangıç">
                    <input type="datetime-local" className="ui-input" value={absenceRecordDraft.start_at} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, start_at: e.target.value })} />
                  </FormField>
                  <FormField label="Bitiş (opsiyonel)">
                    <input type="datetime-local" className="ui-input" value={absenceRecordDraft.end_at} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, end_at: e.target.value })} />
                  </FormField>
                  <FormField label="Süre (opsiyonel)">
                    <input type="number" step="0.25" className="ui-input" value={absenceRecordDraft.duration_value} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, duration_value: e.target.value })} />
                  </FormField>
                  <FormField label="Not">
                    <input className="ui-input" value={absenceRecordDraft.note} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, note: e.target.value })} />
                  </FormField>
                  <div className="flex items-center gap-2 text-sm text-zinc-300">
                    <input type="checkbox" className="ui-checkbox" checked={absenceRecordDraft.is_excused} onChange={(e) => setAbsenceRecordDraft({ ...absenceRecordDraft, is_excused: e.target.checked })} />
                    Mazeretli
                  </div>
                </div>
                <div className="mt-3">
                  <Button onClick={createAbsenceRecord} variant="primary" disabled={hrLoading}>Kaydet</Button>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold">Kayıtlar</h3>
                  <Button onClick={loadAbsenceRecords} size="sm" variant="secondary">Yenile</Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                  <input className="ui-input" placeholder="Personel ID" value={absenceRecordFilters.person_id} onChange={(e) => setAbsenceRecordFilters({ ...absenceRecordFilters, person_id: e.target.value })} />
                  <select className="ui-input" value={absenceRecordFilters.status} onChange={(e) => setAbsenceRecordFilters({ ...absenceRecordFilters, status: e.target.value })}>
                    <option value="">Durum: Tümü</option>
                    <option value="SUBMITTED">Gönderildi</option>
                    <option value="APPROVED">Onaylandı</option>
                    <option value="REJECTED">Reddedildi</option>
                    <option value="CANCELLED">İptal</option>
                  </select>
                  <input type="date" className="ui-input" value={absenceRecordFilters.date_from} onChange={(e) => setAbsenceRecordFilters({ ...absenceRecordFilters, date_from: e.target.value })} />
                  <input type="date" className="ui-input" value={absenceRecordFilters.date_to} onChange={(e) => setAbsenceRecordFilters({ ...absenceRecordFilters, date_to: e.target.value })} />
                </div>
                <div className="ui-table-wrap max-h-[360px]">
                  <table className="ui-table">
                    <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                      <tr>
                        <th className="p-3">Personel</th>
                        <th className="p-3">Tür</th>
                        <th className="p-3">Başlangıç</th>
                        <th className="p-3">Bitiş</th>
                        <th className="p-3">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-700">
                      {absenceRecords.map((r) => (
                        <tr key={r.id}>
                          <td className="p-3 text-xs">{r.person_name || r.person}</td>
                          <td className="p-3 text-xs">{r.absence_type_name || r.absence_type}</td>
                          <td className="p-3 text-xs">{r.start_at ? new Date(r.start_at).toLocaleString('tr-TR') : '-'}</td>
                          <td className="p-3 text-xs">{r.end_at ? new Date(r.end_at).toLocaleString('tr-TR') : '-'}</td>
                          <td className="p-3 text-xs">{r.status}</td>
                        </tr>
                      ))}
                      {absenceRecords.length === 0 && (
                        <tr><td colSpan={5} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {hrTab === 'shifts' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-4">
                <h3 className="text-lg font-bold mb-3">Yeni Vardiya</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="Ad">
                    <input className="ui-input" value={shiftDraft.name} onChange={(e) => setShiftDraft({ ...shiftDraft, name: e.target.value })} />
                  </FormField>
                  <FormField label="Kod">
                    <input className="ui-input" value={shiftDraft.code} onChange={(e) => setShiftDraft({ ...shiftDraft, code: e.target.value })} />
                  </FormField>
                  <FormField label="Başlangıç">
                    <input type="time" className="ui-input" value={shiftDraft.start_time} onChange={(e) => setShiftDraft({ ...shiftDraft, start_time: e.target.value })} />
                  </FormField>
                  <FormField label="Bitiş">
                    <input type="time" className="ui-input" value={shiftDraft.end_time} onChange={(e) => setShiftDraft({ ...shiftDraft, end_time: e.target.value })} />
                  </FormField>
                  <FormField label="Geç Kalma Toleransı (dk)">
                    <input type="number" className="ui-input" value={shiftDraft.late_tolerance_minutes} onChange={(e) => setShiftDraft({ ...shiftDraft, late_tolerance_minutes: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="Erken Çıkış Toleransı (dk)">
                    <input type="number" className="ui-input" value={shiftDraft.early_leave_tolerance_minutes} onChange={(e) => setShiftDraft({ ...shiftDraft, early_leave_tolerance_minutes: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="Açıklama">
                    <input className="ui-input" value={shiftDraft.description} onChange={(e) => setShiftDraft({ ...shiftDraft, description: e.target.value })} />
                  </FormField>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input type="checkbox" className="ui-checkbox" checked={shiftDraft.is_active} onChange={(e) => setShiftDraft({ ...shiftDraft, is_active: e.target.checked })} />
                    Aktif
                  </label>
                </div>
                <div className="mt-3">
                  <Button onClick={createWorkShift} variant="primary" disabled={hrLoading}>Vardiya Ekle</Button>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold">Vardiya Listesi</h3>
                  <Button onClick={loadWorkShifts} size="sm" variant="secondary">Yenile</Button>
                </div>
                <div className="ui-table-wrap max-h-[360px]">
                  <table className="ui-table">
                    <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                      <tr>
                        <th className="p-3">Ad</th>
                        <th className="p-3">Saat</th>
                        <th className="p-3">Tolerans</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-700">
                      {workShifts.map((s) => (
                        <tr key={s.id}>
                          <td className="p-3 text-sm font-semibold">{s.name}</td>
                          <td className="p-3 text-xs">{s.start_time} - {s.end_time}</td>
                          <td className="p-3 text-xs">Geç: {s.late_tolerance_minutes}dk / Erken: {s.early_leave_tolerance_minutes}dk</td>
                        </tr>
                      ))}
                      {workShifts.length === 0 && (
                        <tr><td colSpan={3} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {hrTab === 'assignments' && (
            <div className="space-y-6">
              <Card className="p-4">
                <h3 className="text-lg font-bold mb-3">Vardiya Atama</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField label="Personel ID">
                    <input className="ui-input" value={assignmentDraft.person} onChange={(e) => setAssignmentDraft({ ...assignmentDraft, person: e.target.value })} />
                  </FormField>
                  <FormField label="Vardiya">
                    <select className="ui-input" value={assignmentDraft.shift} onChange={(e) => setAssignmentDraft({ ...assignmentDraft, shift: e.target.value })}>
                      <option value="">Seçin</option>
                      {workShifts.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                    </select>
                  </FormField>
                  <FormField label="Başlangıç">
                    <input type="date" className="ui-input" value={assignmentDraft.effective_from} onChange={(e) => setAssignmentDraft({ ...assignmentDraft, effective_from: e.target.value })} />
                  </FormField>
                  <FormField label="Bitiş (opsiyonel)">
                    <input type="date" className="ui-input" value={assignmentDraft.effective_to} onChange={(e) => setAssignmentDraft({ ...assignmentDraft, effective_to: e.target.value })} />
                  </FormField>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input type="checkbox" className="ui-checkbox" checked={assignmentDraft.is_active} onChange={(e) => setAssignmentDraft({ ...assignmentDraft, is_active: e.target.checked })} />
                    Aktif
                  </label>
                </div>
                <div className="mt-3">
                  <Button onClick={createShiftAssignment} variant="primary" disabled={hrLoading}>Atama Ekle</Button>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold">Atamalar</h3>
                  <Button onClick={loadShiftAssignments} size="sm" variant="secondary">Yenile</Button>
                </div>
                <div className="ui-table-wrap max-h-[360px]">
                  <table className="ui-table">
                    <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                      <tr>
                        <th className="p-3">Personel</th>
                        <th className="p-3">Vardiya</th>
                        <th className="p-3">Başlangıç</th>
                        <th className="p-3">Bitiş</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-700">
                      {shiftAssignments.map((a) => (
                        <tr key={a.id}>
                          <td className="p-3 text-xs">{a.person_name || a.person}</td>
                          <td className="p-3 text-xs">{a.shift_name || a.shift_code}</td>
                          <td className="p-3 text-xs">{a.effective_from}</td>
                          <td className="p-3 text-xs">{a.effective_to || '-'}</td>
                        </tr>
                      ))}
                      {shiftAssignments.length === 0 && (
                        <tr><td colSpan={4} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {hrTab === 'attendance' && (
            <div className="space-y-6">
              <Card className="p-4">
                <h3 className="text-lg font-bold mb-3">Puantaj Özeti</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField label="Personel ID">
                    <input className="ui-input" value={attendanceQuery.person_id} onChange={(e) => setAttendanceQuery({ ...attendanceQuery, person_id: e.target.value })} />
                  </FormField>
                  <FormField label="Başlangıç Tarihi">
                    <input type="date" className="ui-input" value={attendanceQuery.date_from} onChange={(e) => setAttendanceQuery({ ...attendanceQuery, date_from: e.target.value })} />
                  </FormField>
                  <FormField label="Bitiş Tarihi">
                    <input type="date" className="ui-input" value={attendanceQuery.date_to} onChange={(e) => setAttendanceQuery({ ...attendanceQuery, date_to: e.target.value })} />
                  </FormField>
                </div>
                <div className="mt-3">
                  <Button onClick={loadAttendanceSummary} variant="primary" disabled={hrLoading}>Getir</Button>
                </div>
              </Card>

              {attendanceSummary && (
                <Card className="p-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="ui-panel">
                      <div className="text-xs text-zinc-400">Toplam Dakika</div>
                      <div className="text-lg font-bold">{attendanceSummary.totals?.total_minutes || 0}</div>
                    </div>
                    <div className="ui-panel">
                      <div className="text-xs text-zinc-400">Geç Kalma</div>
                      <div className="text-lg font-bold">{attendanceSummary.totals?.late_minutes || 0}</div>
                    </div>
                    <div className="ui-panel">
                      <div className="text-xs text-zinc-400">Erken Çıkma</div>
                      <div className="text-lg font-bold">{attendanceSummary.totals?.early_leave_minutes || 0}</div>
                    </div>
                    <div className="ui-panel">
                      <div className="text-xs text-zinc-400">Devamsız Gün</div>
                      <div className="text-lg font-bold">{attendanceSummary.totals?.absent_days || 0}</div>
                    </div>
                  </div>
                  <div className="ui-table-wrap max-h-[420px]">
                    <table className="ui-table">
                      <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                        <tr>
                          <th className="p-3">Tarih</th>
                          <th className="p-3">Vardiya</th>
                          <th className="p-3">Giriş</th>
                          <th className="p-3">Çıkış</th>
                          <th className="p-3">Süre (dk)</th>
                          <th className="p-3">Geç</th>
                          <th className="p-3">Erken</th>
                          <th className="p-3">Devamsız</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-700">
                        {attendanceSummary.days?.map((d) => (
                          <tr key={d.date}>
                            <td className="p-3 text-xs">{d.date}</td>
                            <td className="p-3 text-xs">{d.shift?.name || '-'}</td>
                            <td className="p-3 text-xs">{d.first_in ? new Date(d.first_in).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                            <td className="p-3 text-xs">{d.last_out ? new Date(d.last_out).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                            <td className="p-3 text-xs">{d.total_minutes}</td>
                            <td className="p-3 text-xs">{d.late_minutes}</td>
                            <td className="p-3 text-xs">{d.early_leave_minutes}</td>
                            <td className="p-3 text-xs">{d.absent ? 'Evet' : 'Hayır'}</td>
                          </tr>
                        ))}
                        {(attendanceSummary.days || []).length === 0 && (
                          <tr><td colSpan={8} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {hrTab === 'payroll' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="p-4">
                  <h3 className="text-lg font-bold mb-3">Payroll Profil Oluştur</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField label="Personel ID">
                      <input className="ui-input" value={payrollProfileDraft.person} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, person: e.target.value })} placeholder="UUID" />
                    </FormField>
                    <FormField label="Ücret Tipi">
                      <select className="ui-input" value={payrollProfileDraft.salary_type} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, salary_type: e.target.value })}>
                        <option value="DAILY">Günlük</option>
                        <option value="HOURLY">Saatlik</option>
                        <option value="MONTHLY">Aylık</option>
                      </select>
                    </FormField>
                    <FormField label="Saatlik Ücret">
                      <input type="number" className="ui-input" value={payrollProfileDraft.hourly_rate} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, hourly_rate: e.target.value })} />
                    </FormField>
                    <FormField label="Günlük Ücret">
                      <input type="number" className="ui-input" value={payrollProfileDraft.daily_rate} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, daily_rate: e.target.value })} />
                    </FormField>
                    <FormField label="Aylık Ücret">
                      <input type="number" className="ui-input" value={payrollProfileDraft.monthly_salary} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, monthly_salary: e.target.value })} />
                    </FormField>
                    <FormField label="Prim (Saatlik)">
                      <input type="number" className="ui-input" value={payrollProfileDraft.premium_hourly_rate} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, premium_hourly_rate: e.target.value })} />
                    </FormField>
                    <FormField label="Prim (Günlük)">
                      <input type="number" className="ui-input" value={payrollProfileDraft.premium_daily_rate} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, premium_daily_rate: e.target.value })} />
                    </FormField>
                    <FormField label="Para Birimi">
                      <input className="ui-input" value={payrollProfileDraft.currency} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, currency: e.target.value })} />
                    </FormField>
                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                      <input type="checkbox" className="ui-checkbox" checked={payrollProfileDraft.is_active} onChange={(e) => setPayrollProfileDraft({ ...payrollProfileDraft, is_active: e.target.checked })} />
                      Aktif
                    </label>
                  </div>
                  <div className="mt-3">
                    <Button onClick={createPayrollProfile} variant="primary" disabled={hrLoading}>Profil Ekle</Button>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold">Payroll Profilleri</h3>
                    <Button onClick={loadPayrollProfiles} size="sm" variant="secondary">Yenile</Button>
                  </div>
                  <div className="ui-table-wrap max-h-[360px]">
                    <table className="ui-table">
                      <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                        <tr>
                          <th className="p-3">Personel</th>
                          <th className="p-3">Tip</th>
                          <th className="p-3">Saatlik</th>
                          <th className="p-3">Günlük</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-700">
                        {payrollProfiles.map((p) => (
                          <tr key={p.id}>
                            <td className="p-3 text-xs">{p.person_name || p.person}</td>
                            <td className="p-3 text-xs">{p.salary_type}</td>
                            <td className="p-3 text-xs">{p.hourly_rate || '-'}</td>
                            <td className="p-3 text-xs">{p.daily_rate || '-'}</td>
                          </tr>
                        ))}
                        {payrollProfiles.length === 0 && (
                          <tr><td colSpan={4} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              <Card className="p-4">
                <h3 className="text-lg font-bold mb-3">Bordro Özeti</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField label="Personel ID (opsiyonel)">
                    <input className="ui-input" value={payrollSummaryQuery.person_id} onChange={(e) => setPayrollSummaryQuery({ ...payrollSummaryQuery, person_id: e.target.value })} />
                  </FormField>
                  <FormField label="Başlangıç">
                    <input type="date" className="ui-input" value={payrollSummaryQuery.date_from} onChange={(e) => setPayrollSummaryQuery({ ...payrollSummaryQuery, date_from: e.target.value })} />
                  </FormField>
                  <FormField label="Bitiş">
                    <input type="date" className="ui-input" value={payrollSummaryQuery.date_to} onChange={(e) => setPayrollSummaryQuery({ ...payrollSummaryQuery, date_to: e.target.value })} />
                  </FormField>
                </div>
                <div className="mt-3">
                  <Button onClick={loadPayrollSummary} variant="primary" disabled={hrLoading}>Özet Getir</Button>
                </div>
                {payrollSummary && (
                  <div className="ui-table-wrap max-h-[420px] mt-4">
                    <table className="ui-table">
                      <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                        <tr>
                          <th className="p-3">Personel</th>
                          <th className="p-3">Devamsız Gün</th>
                          <th className="p-3">Devamsız Saat</th>
                          <th className="p-3">Kesinti</th>
                          <th className="p-3">Prim Kesintisi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-700">
                        {payrollSummary.persons?.map((p) => (
                          <tr key={p.person.id}>
                            <td className="p-3 text-xs">{p.person.full_name}</td>
                            <td className="p-3 text-xs">{p.totals?.absence_days || 0}</td>
                            <td className="p-3 text-xs">{p.totals?.absence_hours || 0}</td>
                            <td className="p-3 text-xs">{p.totals?.payroll_deduction || 0} {payrollSummary.currency}</td>
                            <td className="p-3 text-xs">{p.totals?.premium_deduction || 0} {payrollSummary.currency}</td>
                          </tr>
                        ))}
                        {(payrollSummary.persons || []).length === 0 && (
                          <tr><td colSpan={5} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h3 className="text-lg font-bold mb-3">SGK Raporu</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField label="Başlangıç">
                    <input type="date" className="ui-input" value={sgkReportQuery.date_from} onChange={(e) => setSgkReportQuery({ ...sgkReportQuery, date_from: e.target.value })} />
                  </FormField>
                  <FormField label="Bitiş">
                    <input type="date" className="ui-input" value={sgkReportQuery.date_to} onChange={(e) => setSgkReportQuery({ ...sgkReportQuery, date_to: e.target.value })} />
                  </FormField>
                  <div className="flex items-end">
                    <Button onClick={loadSgkReport} variant="primary" disabled={hrLoading}>Rapor Getir</Button>
                  </div>
                </div>
                {sgkReport && (
                  <div className="ui-table-wrap max-h-[420px] mt-4">
                    <table className="ui-table">
                      <thead className="bg-zinc-900 text-zinc-200 sticky top-0">
                        <tr>
                          <th className="p-3">SGK Kodu</th>
                          <th className="p-3">Personel</th>
                          <th className="p-3">Eksik Gün</th>
                          <th className="p-3">Eksik Saat</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-700">
                        {sgkReport.summary?.map((row, idx) => (
                          <tr key={`${row.sgk_code}-${row.person_id}-${idx}`}>
                            <td className="p-3 text-xs">{row.sgk_code}</td>
                            <td className="p-3 text-xs">{row.person_id}</td>
                            <td className="p-3 text-xs">{row.missing_days || 0}</td>
                            <td className="p-3 text-xs">{row.missing_hours || 0}</td>
                          </tr>
                        ))}
                        {(sgkReport.summary || []).length === 0 && (
                          <tr><td colSpan={4} className="ui-empty">Henüz kayıt bulunmuyor.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </main>
      </div>
    );
  }

  // === ANA SAYFA ===
  return (
    <div className="min-h-screen app-shell app-container text-foreground font-sans p-2 md:p-4">
      {!isOnline && (
        <div className="ui-alert ui-alert-danger mb-4">
          <div className="flex items-center gap-2 font-bold">
            <WifiOff size={20} />
            <span>İNTERNET BAĞLANTISI YOK - OFFLINE MOD</span>
          </div>
          <div className="ui-pill">Bekleyen: {pendingCount}</div>
        </div>
      )}
      {isOnline && pendingCount > 0 && (
        <div className="ui-alert ui-alert-warning mb-4">
          <div className="flex items-center gap-2 font-bold">
            <AlertCircle size={20} />
            <span>{pendingCount} bekleyen kayıt var</span>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { localStorage.removeItem(OFFLINE_QUEUE_KEY); checkPendingData(); showToast("Kuyruk temizlendi", "info"); }} variant="destructive" size="sm" className="gap-1">
              <Trash2 size={14} /> Temizle
            </Button>
            <Button onClick={syncOfflineData} variant="secondary" size="sm" className="gap-2">
              <RefreshCw size={16} /> Gönder
            </Button>
          </div>
        </div>
      )}

      <header className="ui-header mb-6">
        <div className="flex items-center gap-3">
          <img src={logoImg} alt="Malhotra" className="h-12 w-auto object-contain" />
          <div>
            <h1 className="text-xl font-bold">Malhotra Güvenlik Paneli</h1>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              {isOnline ? <span className="text-green-400 flex items-center gap-1"><Wifi size={12} /> Online</span> : <span className="text-red-400 flex items-center gap-1"><WifiOff size={12} /> Offline</span>}
              <span>| {session?.user?.email || 'local'}</span>
              {totalQueueCount > 0 && (
                <span className="ui-pill">Kuyruk: {totalQueueCount}</span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1 break-all">
              Supabase: {supabaseUrl}
              {supabaseDebug.lastError ? ` | Error: ${supabaseDebug.lastError}` : ''}
              {supabaseDebug.lastCheckedAt ? ` | Check: ${new Date(supabaseDebug.lastCheckedAt).toLocaleTimeString('tr-TR')}` : ''}
            </div>
            <div className="text-[10px] text-zinc-500">Build: {BUILD_TIME}</div>
          </div>
        </div>
        <div className="ui-chip"><Layers size={18} className="text-orange-400" /><div className="flex flex-col"><span className="text-[10px] text-zinc-400 font-bold uppercase">Aktif Vardiya</span><span className="text-white text-sm font-bold">{currentShift}</span></div></div>
        <div className="flex items-center gap-2">
          {longStayCount > 0 && <div className="bg-red-600 text-white px-3 py-2 rounded-lg font-bold flex items-center gap-2 animate-pulse hidden md:flex"><AlertCircle size={18} /><span>{longStayCount} kişi 4+ saat!</span></div>}
          <button onClick={handleSystemReset} className="ui-btn-secondary" title="Takılı kalırsa sistemi yeniler"><RefreshCw size={16} /> Yenile</button>
          <button onClick={recomputeActiveLogs} className="ui-btn-secondary" title="Aktif listeyi yeniden hesaplar"><RotateCcw size={16} /> Aktifleri Yenile</button>
          <Button onClick={() => setCurrentPage('dashboard')} variant="secondary" className="gap-2"><BarChart3 size={18} /> Dashboard</Button>
          <Button onClick={() => setCurrentPage('import')} variant="secondary" className="gap-2"><Upload size={18} /> Veri Yükle</Button>
          {isElectron && (
            <button onClick={handleAppExit} className="ui-btn-destructive"><LogOut size={18} /> Çıkış</button>
          )}
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* SOL: GİRİŞ/ÇIKIŞ FORMU */}
        <section className="lg:col-span-5 ui-card p-6 h-fit shadow-lg">
          <div className="ui-segment mb-4">
            <button onClick={() => setVehicleDirection('Giriş')} className={cx("ui-segment-btn flex items-center justify-center gap-2 whitespace-nowrap", vehicleDirection === 'Giriş' ? "ui-segment-success" : "ui-segment-inactive")}>
              <ArrowRightCircle size={18} />
              <span className="hidden sm:inline">GİRİŞ İŞLEMİ</span>
              <span className="sm:hidden">GİRİŞ</span>
            </button>
            <button onClick={() => setVehicleDirection('Çıkış')} className={cx("ui-segment-btn flex items-center justify-center gap-2 whitespace-nowrap", vehicleDirection === 'Çıkış' ? "ui-segment-danger" : "ui-segment-inactive")}>
              <ArrowLeftCircle size={18} />
              <span className="hidden sm:inline">ÇIKIŞ İŞLEMİ</span>
              <span className="sm:hidden">ÇIKIŞ</span>
            </button>
          </div>

          <div className="ui-segment mb-6">
            <button onClick={() => setMainTab('vehicle')} className={cx("ui-segment-btn", mainTab === 'vehicle' ? "ui-segment-active" : "ui-segment-inactive")}>ARAÇ</button>
            <button onClick={() => setMainTab('visitor')} className={cx("ui-segment-btn whitespace-nowrap", mainTab === 'visitor' ? "ui-segment-active" : "ui-segment-inactive")}>
              <span className="hidden sm:inline">YAYA / ZİYARETÇİ</span>
              <span className="sm:hidden">YAYA</span>
            </button>
          </div>

          {mainTab === 'vehicle' && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-1 mb-6">
              <SubTabBtn active={vehicleSubTab === 'guest'} onClick={() => { setVehicleSubTab('guest'); setFormData(prev => ({ ...prev, driver_type: 'other' })); }} icon={<Car size={14} />} label="Misafir" />
              <SubTabBtn active={vehicleSubTab === 'staff'} onClick={() => { setVehicleSubTab('staff'); setFormData(prev => ({ ...prev, driver_type: 'other' })); }} icon={<User size={14} />} label="Personel" />
              <SubTabBtn active={vehicleSubTab === 'management'} onClick={() => { setVehicleSubTab('management'); setFormData(prev => ({ ...prev, driver_type: 'owner' })); }} icon={<Crown size={14} />} label="Yönetim" />
              <SubTabBtn active={vehicleSubTab === 'service'} onClick={() => { setVehicleSubTab('service'); setFormData(prev => ({ ...prev, driver_type: 'other' })); }} icon={<Bus size={14} />} label="Servis" />
              <SubTabBtn active={vehicleSubTab === 'sealed'} onClick={() => { setVehicleSubTab('sealed'); setFormData(prev => ({ ...prev, driver_type: 'other' })); }} icon={<Lock size={14} />} label="Mühürlü" />
              <SubTabBtn active={vehicleSubTab === 'company'} onClick={() => { setVehicleSubTab('company'); setFormData(prev => ({ ...prev, driver_type: 'other' })); }} icon={<Briefcase size={14} />} label="Şirket" />
            </div>
          )}
          {mainTab === 'visitor' && (
            <div className="grid grid-cols-3 gap-2 mb-6">
              <SubTabBtn active={visitorSubTab === 'guest'} onClick={() => setVisitorSubTab('guest')} icon={<User size={16} />} label="Misafir" />
              <SubTabBtn active={visitorSubTab === 'staff'} onClick={() => setVisitorSubTab('staff')} icon={<UserCheck size={16} />} label="Fabrika Personeli" />
              <SubTabBtn active={visitorSubTab === 'ex-staff'} onClick={() => setVisitorSubTab('ex-staff')} icon={<UserMinus size={16} />} label="İşten Ayrılan" />
            </div>
          )}

          <div className="space-y-4">
            {mainTab === 'visitor' && visitorSubTab === 'ex-staff' && (<div className="bg-red-900/30 border border-red-500/50 p-3 rounded flex items-start gap-3 animate-pulse"><AlertTriangle className="text-red-500 shrink-0" size={20} /><div><p className="text-red-200 text-sm font-bold">DİKKAT: ESKİ PERSONEL GİRİŞİ</p><p className="text-red-300 text-xs mt-1">Lütfen İnsan Kaynakları biriminden onay almadan içeri almayınız.</p></div></div>)}

            {mainTab === 'vehicle' ? (
              <>
                <div className="relative group">
                  <FormField label="ARAÇ PLAKASI">
                  {(vehicleSubTab === 'management' || vehicleSubTab === 'company') ? (
                    <div className="relative">
                      <Input type="text" placeholder="34 AB 123" value={formData.plate || ''} onChange={(e) => { setFormData({ ...formData, plate: e.target.value.toUpperCase() }); setShowManagementList(true); }} onFocus={() => setShowManagementList(true)} className="uppercase text-lg tracking-widest font-mono border-purple-500/50" autoComplete="off" />
                      {showManagementList && formData.plate && (
                        <div className="absolute z-50 w-full bg-zinc-800 border border-zinc-600 rounded-b-xl shadow-2xl max-h-60 overflow-y-auto mt-1">
                          {managementVehicleMatches.map((veh, idx) => (
                            <div
                              key={idx}
                              className="p-3 hover:bg-purple-600 hover:text-white cursor-pointer border-b border-zinc-700 last:border-0 text-sm transition-all flex items-center gap-2 font-mono"
                              onClick={() => {
                                const [platePart, namePart] = veh.split(' - ');
                                const isCompany = veh.includes('ŞİRKET') || veh.includes('HAVUZ');
                                setFormData({
                                  ...formData,
                                  plate: platePart.trim(),
                                  driver: namePart ? namePart.trim() : '',
                                  driver_type: (vehicleSubTab === 'management' && !isCompany) ? 'owner' : 'other',
                                  host: vehicleSubTab === 'management' ? 'Yönetim' : 'Şirket'
                                });
                                setShowManagementList(false);
                              }}
                            >
                              <Crown size={14} className="text-yellow-400" />
                              {veh}
                            </div>
                          ))}
                          {managementVehicleMatches.length === 0 && (
                            <div className="p-3 text-zinc-500 text-xs italic text-center">Listede bulunamadı.</div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (<Input type="text" placeholder="34 AB 123" value={formData.plate} onChange={e => setFormData({ ...formData, plate: e.target.value.toUpperCase() })} className="uppercase text-lg tracking-widest font-mono" />)}
                  </FormField>
                </div>
                {plateHistory && plateHistory.count > 0 && (<div className="bg-blue-900/30 border border-blue-500/50 p-3 rounded animate-in fade-in slide-in-from-top-2"><div className="flex items-center gap-2 mb-2"><History size={16} className="text-blue-400" /><span className="text-blue-200 text-sm font-bold">Bu plaka {plateHistory.count} kez geldi</span></div><div className="text-xs text-blue-300 space-y-1"><p>Son: <span className="font-bold text-white">{plateHistory.lastVisit}</span></p><p>İlgili: <span className="font-bold text-white">{plateHistory.lastHost}</span></p></div></div>)}

                {(vehicleSubTab === 'management' || vehicleSubTab === 'company') && (
                  <div className="bg-purple-900/20 p-3 rounded border border-purple-500/30 animate-in fade-in slide-in-from-top-2">
                    <label className="text-xs text-purple-300 flex items-center gap-1 mb-2 font-bold"><User size={12} /> {isExitDirection ? 'ÇIKIŞTA ARACI KULLANAN' : 'ARACI KULLANAN'}</label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {vehicleSubTab === 'management' && !MANAGEMENT_VEHICLES.some(v => v.includes(formData.plate) && (v.includes('ŞİRKET') || v.includes('HAVUZ'))) && (<button type="button" onClick={() => setFormData({ ...formData, driver_type: 'owner' })} className={`p-2 rounded text-sm font-bold transition-all ${formData.driver_type === 'owner' ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>Araç Sahibi</button>)}
                      <button type="button" onClick={() => setFormData({ ...formData, driver_type: 'driver', driver: 'MURAT CİK' })} className={`p-2 rounded text-sm font-bold transition-all ${formData.driver_type === 'driver' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>Fabrika Şoförü</button>
                      <button type="button" onClick={() => setFormData({ ...formData, driver_type: 'supervisor', driver: 'AHMET PEKER' })} className={`p-2 rounded text-sm font-bold transition-all ${formData.driver_type === 'supervisor' ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>Vardiya Amiri</button>
                      <button type="button" onClick={() => setFormData({ ...formData, driver_type: 'manual', driver: '' })} className={`p-2 rounded text-sm font-bold transition-all ${formData.driver_type === 'manual' ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>Manuel Giriş</button>
                      <button type="button" onClick={() => setFormData({ ...formData, driver_type: 'other', driver: '' })} className={`p-2 rounded text-sm font-bold transition-all ${formData.driver_type === 'other' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>Diğer</button>
                    </div>
                    {formData.driver_type === 'manual' && (
                      <div className="space-y-2">
                      <Input type="text" placeholder="İsim Soyisim giriniz..." value={formData.driver} onChange={e => setFormData({ ...formData, driver: upperTr(e.target.value) })} className="border-green-500/50" />
                        <p className="text-green-400 text-xs">İsim ve soyisimi büyük harfle giriniz.</p>
                      </div>
                    )}
                    {formData.driver_type !== 'owner' && formData.driver_type !== 'manual' && (<Input type="text" placeholder={formData.driver_type === 'driver' ? "Şoför adı soyadı..." : formData.driver_type === 'supervisor' ? "Vardiya amiri adı..." : "Kullanan kişi adı..."} value={formData.driver} onChange={e => setFormData({ ...formData, driver: e.target.value })} />)}
                    {formData.driver_type === 'owner' && formData.driver && (<p className="text-purple-300 text-sm mt-1">{formData.driver}</p>)}
                  </div>
                )}

                {!(vehicleSubTab === 'management' || vehicleSubTab === 'company') && (
                  <div>
                    <FormField label="SÜRÜCÜ ADI SOYADI">
                    {vehicleSubTab === 'staff' ? (
                      <div className="relative group">
                        <div className="relative"><Input type="text" placeholder="Personel Adı Ara veya Seç..." value={formData.driver || ''} onChange={(e) => { setFormData({ ...formData, driver: upperTr(e.target.value) }); setShowStaffList(true); }} onFocus={() => setShowStaffList(true)} className="pl-10 border-blue-500/50 focus:bg-zinc-800" autoComplete="off" /><Search className="absolute left-3 top-3 text-blue-400" size={18} />{formData.driver && (<button onClick={() => setFormData({ ...formData, driver: '' })} className="absolute right-3 top-3 text-zinc-500 hover:text-red-400 transition-colors"><X size={18} /></button>)}</div>
                        {showStaffList && formData.driver && (
                          <div className="absolute z-50 w-full bg-zinc-800 border border-zinc-600 rounded-b-xl shadow-2xl max-h-60 overflow-y-auto mt-1">
                            {staffDriverMatches.map((person, idx) => (
                              <div
                                key={idx}
                                className="p-3 pl-10 hover:bg-blue-600 hover:text-white cursor-pointer border-b border-zinc-700 last:border-0 text-sm transition-all flex items-center gap-2 group"
                                onClick={() => {
                                  setFormData({ ...formData, driver: person, host: 'Fabrika' });
                                  setShowStaffList(false);
                                }}
                              >
                                <CheckCircle size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
                                {person}
                              </div>
                            ))}
                            {staffDriverMatches.length === 0 && (
                              <div className="p-4 text-zinc-500 text-sm italic text-center">"{formData.driver}" bulunamadı.</div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Input type="text" placeholder="Ad Soyad Giriniz" value={formData.driver} onChange={e => setFormData({ ...formData, driver: e.target.value })} />
                    )}
                    </FormField>
                  </div>
                )}

                {isEntryDirection && (vehicleSubTab === 'company' || vehicleSubTab === 'service' || (vehicleSubTab === 'management' && formData.driver_type !== 'owner')) && (
                  <div className="bg-blue-900/20 p-3 rounded border border-blue-500/30 animate-in fade-in slide-in-from-top-2">
                    <label className="text-xs text-blue-300 flex items-center gap-1 mb-1 font-bold"><MapPin size={12} /> {isEntryDirection ? 'GELDİĞİ LOKASYON (NEREDEN)' : 'GİDECEĞİ LOKASYON'}</label>
                    <Input type="text" placeholder="Örn: Merkez Ofis, Gümrük..." value={formData.entry_location} onChange={e => setFormData({ ...formData, entry_location: e.target.value })} />
                  </div>
                )}

                {isExitDirection && (
                  <>
                    <div className="bg-orange-900/20 p-3 rounded border border-orange-500/30 animate-in fade-in slide-in-from-top-2"><p className="text-orange-300 text-sm flex items-center gap-2"><AlertCircle size={16} />Plakayı girin. Eğer araç içerideyse otomatik çıkış yapılacak.</p></div>
                    <div className="bg-blue-900/20 p-3 rounded border border-blue-500/30 animate-in fade-in slide-in-from-top-2 mt-2">
                      <label className="text-xs text-blue-300 flex items-center gap-1 mb-1 font-bold"><MapPin size={12} /> GİDECEĞİ LOKASYON</label>
                      <Input type="text" placeholder="Nereye gidecek? Örn: Merkez Ofis, Gümrük, Depo..." value={formData.exit_location} onChange={e => setFormData({ ...formData, exit_location: e.target.value })} />
                    </div>
                  </>
                )}

                {vehicleSubTab === 'sealed' && (
                  <div className={`${isEntryDirection ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'} p-3 rounded border animate-in fade-in slide-in-from-top-2`}>
                    <label className={`text-xs ${isEntryDirection ? 'text-green-300' : 'text-red-300'} flex items-center gap-1 mb-1 font-bold`}>
                      <Lock size={12} /> {isEntryDirection ? 'GİRİŞ MÜHÜR NUMARASI' : 'ÇIKIŞ MÜHÜR NUMARASI'}
                      <span className="text-zinc-400 font-normal">(Opsiyonel)</span>
                    </label>
                    <Input
                      type="text"
                      placeholder={isEntryDirection ? "Giriş Mühür No..." : "Çıkış Mühür No..."}
                      value={isEntryDirection ? formData.seal_number_entry : formData.seal_number_exit}
                      onChange={e => isEntryDirection ? setFormData({ ...formData, seal_number_entry: e.target.value }) : setFormData({ ...formData, seal_number_exit: e.target.value })}
                      className={isEntryDirection ? 'border-green-500/50' : 'border-red-500/50'}
                    />

                    {/* HIZLI BUTONLAR */}
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => isEntryDirection ? setFormData({ ...formData, seal_number_entry: 'MÜHÜR YOK' }) : setFormData({ ...formData, seal_number_exit: 'MÜHÜR YOK' })}
                        className="px-3 py-1.5 rounded text-xs font-bold bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-all flex items-center gap-1"
                      >
                        <X size={12} /> Mühür Yok
                      </button>
                      <button
                        type="button"
                        onClick={() => isEntryDirection ? setFormData({ ...formData, seal_number_entry: 'BELİRSİZ' }) : setFormData({ ...formData, seal_number_exit: 'BELİRSİZ' })}
                        className="px-3 py-1.5 rounded text-xs font-bold bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-all"
                      >
                        Belirsiz
                      </button>
                      {(isEntryDirection ? formData.seal_number_entry : formData.seal_number_exit) && (
                        <button
                          type="button"
                          onClick={() => isEntryDirection ? setFormData({ ...formData, seal_number_entry: '' }) : setFormData({ ...formData, seal_number_exit: '' })}
                          className="px-3 py-1.5 rounded text-xs font-bold bg-red-900/50 hover:bg-red-600 text-red-400 hover:text-white transition-all flex items-center gap-1"
                        >
                          <RotateCcw size={12} /> Temizle
                        </button>
                      )}
                    </div>

                    {isEntryDirection && <p className="text-xs text-green-400 mt-2 italic">* Çıkışta ayrıca Çıkış Mührü sorulacaktır.</p>}
                  </div>
                )}
              </>
            ) : (
              <div>
                <FormField label="ADI SOYADI">
                {visitorSubTab === 'staff' ? (
                  <div className="relative group">
                    <div className="relative"><Input type="text" placeholder="Personel Adı Ara veya Seç..." value={formData.name || ''} onChange={(e) => { setFormData({ ...formData, name: upperTr(e.target.value) }); setShowStaffList(true); }} onFocus={() => setShowStaffList(true)} className="pl-10 border-blue-500/50 focus:bg-zinc-800" autoComplete="off" /><Search className="absolute left-3 top-3 text-blue-400" size={18} />{formData.name && (<button onClick={() => setFormData({ ...formData, name: '' })} className="absolute right-3 top-3 text-zinc-500 hover:text-red-400 transition-colors"><X size={18} /></button>)}</div>
                    {showStaffList && formData.name && (
                      <div className="absolute z-50 w-full bg-zinc-800 border border-zinc-600 rounded-b-xl shadow-2xl max-h-60 overflow-y-auto mt-1">
                        {staffVisitorMatches.map((person, idx) => (
                          <div
                            key={idx}
                            className="p-3 pl-10 hover:bg-blue-600 hover:text-white cursor-pointer border-b border-zinc-700 last:border-0 text-sm transition-all flex items-center gap-2 group"
                            onClick={() => {
                              setFormData({ ...formData, name: person, host: 'Fabrika' });
                              setShowStaffList(false);
                            }}
                          >
                            <CheckCircle size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
                            {person}
                          </div>
                        ))}
                        {staffVisitorMatches.length === 0 && (
                          <div className="p-4 text-zinc-500 text-sm italic text-center">"{formData.name}" bulunamadı.</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (<Input type="text" placeholder="Kimlikteki Tam Ad" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />)}
                </FormField>
                {plateHistory && plateHistory.count > 0 && (<div className="bg-purple-900/30 border border-purple-500/50 p-3 rounded mt-2 animate-in fade-in slide-in-from-top-2"><div className="flex items-center gap-2 mb-2"><History size={16} className="text-purple-400" /><span className="text-purple-200 text-sm font-bold">Bu kişi {plateHistory.count} kez geldi</span></div><div className="text-xs text-purple-300 space-y-1"><p>Son: <span className="font-bold text-white">{plateHistory.lastVisit}</span></p><p>İlgili: <span className="font-bold text-white">{plateHistory.lastHost}</span></p></div></div>)}
                {isExitDirection && (
                  <>
                    <div className="bg-orange-900/20 p-3 rounded border border-orange-500/30 mt-2 animate-in fade-in slide-in-from-top-2"><p className="text-orange-300 text-sm flex items-center gap-2"><AlertCircle size={16} />İsmi girin. Eğer kişi içerideyse otomatik çıkış yapılacak.</p></div>
                    <div className="bg-blue-900/20 p-3 rounded border border-blue-500/30 animate-in fade-in slide-in-from-top-2 mt-2">
                      <label className="text-xs text-blue-300 flex items-center gap-1 mb-1 font-bold"><MapPin size={12} /> GİDECEĞİ LOKASYON</label>
                      <Input type="text" placeholder="Nereye gidecek? Opsiyonel..." value={formData.exit_location} onChange={e => setFormData({ ...formData, exit_location: e.target.value })} />
                    </div>
                  </>
                )}
                {isEntryDirection && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div><FormField label="TC KİMLİK NO"><div className="relative"><Select value={formData.tc_no === 'BELİRTİLMEDİ' ? 'BELİRTİLMEDİ' : (formData.tc_no ? 'MANUAL' : '')} onChange={e => { if (e.target.value === 'BELİRTİLMEDİ') setFormData({ ...formData, tc_no: 'BELİRTİLMEDİ' }); else setFormData({ ...formData, tc_no: '' }); }} className="mb-1"><option value="">TC Girmek İstiyorum</option><option value="BELİRTİLMEDİ">Belirtilmedi / Yok</option></Select>{formData.tc_no !== 'BELİRTİLMEDİ' && (<Input type="text" maxLength="11" placeholder="11 Haneli TC" value={formData.tc_no === 'BELİRTİLMEDİ' ? '' : formData.tc_no} onChange={e => setFormData({ ...formData, tc_no: e.target.value.replace(/\D/g, '') })} />)}</div></FormField></div>
                    <div><FormField label="TELEFON"><div className="relative"><Input type="text" placeholder="05XX... (Opsiyonel)" value={formData.phone} onChange={e => setFormData({ ...formData, phone: formatPhone(e.target.value) })} /><Phone size={14} className="absolute right-3 top-3 text-zinc-500" /></div></FormField></div>
                  </div>
                )}
              </div>
            )}

            {isEntryDirection && (
              <div>
                <label className={labelClass}>İLGİLİ BİRİM / KİŞİ</label>
                <Select
                  ref={hostSelectRef}
                  value={hostSelectValue}
                  onChange={e => {
                    const value = e.target.value;
                    if (value === 'Fabrika Personeli') {
                      setFormData({ ...formData, host: 'Fabrika Personeli' });
                      setShowHostStaffList(true);
                      setIsCustomHost(false);
                    } else if (value === OTHER_HOST_VALUE) {
                      setFormData({ ...formData, host: OTHER_HOST_VALUE });
                      setShowHostStaffList(false);
                      setHostSearchTerm('');
                      setIsCustomHost(false);
                    } else if (value === UNSPECIFIED_HOST_VALUE) {
                      setFormData({ ...formData, host: UNSPECIFIED_HOST_VALUE });
                      setShowHostStaffList(false);
                      setHostSearchTerm('');
                      setIsCustomHost(false);
                    } else {
                      setFormData({ ...formData, host: value });
                      setShowHostStaffList(false);
                      setHostSearchTerm('');
                      setIsCustomHost(false);
                    }
                  }}
                >
                  <option value="">Seçiniz</option>
                  {HOST_PRESETS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                  <option value="Fabrika Personeli">Fabrika Personeli (Listeden Seç)</option>
                  <option value={UNSPECIFIED_HOST_VALUE}>Belirtilmedi</option>
                  <option value={OTHER_HOST_VALUE}>Diğer</option>
                </Select>

                {(formData.host === 'Fabrika Personeli' || showHostStaffList) && (
                  <div className="relative mt-2 animate-in fade-in slide-in-from-top-2">
                    <div className="relative">
                      <Input
                        type="text"
                        placeholder="Personel Ara (İsim veya No)..."
                        value={hostSearchTerm}
                        onChange={(e) => {
                          setHostSearchTerm(upperTr(e.target.value));
                          setShowHostStaffList(true);
                        }}
                        className="pl-9 border-green-500/50"
                        autoFocus
                      />
                      <Search className="absolute left-3 top-3 text-green-500" size={16} />
                    </div>
                    {showHostStaffList && hostSearchTerm && (
                      <div className="absolute z-50 w-full bg-zinc-800 border border-zinc-600 rounded-b-xl shadow-2xl max-h-60 overflow-y-auto mt-1">
                        {hostStaffMatches.map((person, idx) => (
                          <div
                            key={idx}
                            className="p-3 hover:bg-green-700 hover:text-white cursor-pointer border-b border-zinc-700 last:border-0 text-sm transition-all flex items-center gap-2"
                            onClick={() => {
                              setFormData({ ...formData, host: person });
                              setShowHostStaffList(false);
                              setHostSearchTerm('');
                              setIsCustomHost(false);
                            }}
                          >
                            <UserCheck size={14} className="text-green-400" />
                            {person}
                          </div>
                        ))}
                        {hostStaffMatches.length === 0 && (
                          <div className="p-3 text-zinc-500 text-xs italic text-center">Bulunamadı.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {shouldShowCustomHostInput && (
                  <Input
                    type="text"
                    placeholder="LÜTFEN AÇIKLAMA GİRİNİZ"
                    value={formData.host || ''}
                    onChange={e => {
                      setFormData({ ...formData, host: upperTr(e.target.value) });
                      setIsCustomHost(true);
                    }}
                    className="mt-2 animate-in fade-in slide-in-from-top-2 border-orange-500/50"
                    autoFocus
                  />
                )}
              </div>
            )}

            <FormField label="NOT / AÇIKLAMA"><Textarea placeholder="Firma adı, görüşme konusu vb." value={formData.note} onChange={e => setFormData({ ...formData, note: e.target.value })} className="h-24" /></FormField>

            {optionalAttachmentsEnabled && (
              <div className="ui-panel">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="ui-label">FOTOĞRAF / EVRAK (OPSİYONEL)</label>
                  {entryAttachments.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={clearEntryAttachments}>Temizle</Button>
                  )}
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={handleEntryAttachmentSelect}
                  className="ui-input"
                />
                <div className="text-[11px] text-zinc-500 mt-2">
                  Maksimum {MAX_ATTACHMENTS_PER_LOG} dosya, dosya başına {humanFileSize(MAX_ATTACHMENT_SIZE_BYTES)}.
                </div>
                {entryAttachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {entryAttachments.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-xs bg-zinc-900/60 rounded p-2">
                        <div className="truncate pr-2">{item.name} ({humanFileSize(item.size)})</div>
                        <button type="button" onClick={() => removeEntryAttachment(item.id)} className="text-red-300 hover:text-red-200">Sil</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button onClick={handleEntry} disabled={loading} className={`w-full font-bold py-4 rounded shadow-lg transition-all active:scale-95 mt-2 flex items-center justify-center gap-2 ${vehicleDirection === 'Çıkış' ? 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white shadow-orange-900/20' : 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/20'}`}>
              {loading ? <><RefreshCw size={20} className="animate-spin" /> KAYDEDİLİYOR...</> : vehicleDirection === 'Çıkış' ? <><LogOut size={20} /> ÇIKIŞI KAYDET</> : <><LogIn size={20} /> GİRİŞİ KAYDET</>}
            </button>
          </div>
        </section>

        {/* SAĞ: BUGÜNKÜ HAREKETLER */}
        <section className="lg:col-span-7 ui-card p-6 min-h-[500px] shadow-lg flex flex-col">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 pb-4 border-b border-zinc-700 gap-3">
            <h2 className="text-lg font-bold flex items-center gap-2">Bugünkü Hareketler</h2>
            <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
              <div className="relative flex-1 md:flex-none">
                <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
                <input
                  type="text"
                  placeholder="Ara..."
                  value={activeSearchTerm}
                  onChange={e => setActiveSearchTerm(e.target.value)}
                  className="bg-zinc-900 border border-zinc-600 rounded pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-orange-500 w-full md:w-48"
                />
              </div>
              <button
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  const todayData = todayAllLogs.map(log => ({
                    Tarih: new Date(log.time).toLocaleDateString('tr-TR'),
                    Saat: new Date(log.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    Durum: log.direction === 'entry' ? 'GİRİŞ' : 'ÇIKIŞ',
                    Kategori: log.sub_category,
                    'Plaka/İsim': log.plate || log.name,
                    'Sürücü': log.driver || '-',
                    'İlgili Birim': log.host,
                    Vardiya: log.shift
                  }));
                  const ws = XLSX.utils.json_to_sheet(todayData);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Bugünkü Hareketler');
                  XLSX.writeFile(wb, `Bugunun_Hareketleri_${today}.xlsx`);
                  showToast('Excel dosyası indirildi!', 'success');
                }}
                className="bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded text-sm font-bold flex items-center gap-1 transition-all"
                title="Bugünkü Hareketleri Excel'e Aktar"
              >
                <FileText size={16} /> Excel
              </button>
              <span className="bg-blue-500/20 text-blue-300 px-3 py-2 rounded text-sm font-bold whitespace-nowrap">
                {todayCounts.total} Kayıt
              </span>
            </div>
          </div>

          {/* DETAYLI İSTATİSTİK KARTLARI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-green-900/30 border border-green-500/30 p-4 rounded-lg hover:scale-105 transition-transform cursor-pointer group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-green-300 flex items-center gap-1 font-bold">
                  <ArrowRightCircle size={16} /> Giriş
                </span>
                <span className="text-3xl font-bold text-green-400 group-hover:scale-110 transition-transform">
                  {todayCounts.entry}
                </span>
              </div>
              <div className="text-[10px] text-green-300/60">Bugün Toplam</div>
            </div>

            <div className="bg-red-900/30 border border-red-500/30 p-4 rounded-lg hover:scale-105 transition-transform cursor-pointer group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-red-300 flex items-center gap-1 font-bold">
                  <ArrowLeftCircle size={16} /> Çıkış
                </span>
                <span className="text-3xl font-bold text-red-400 group-hover:scale-110 transition-transform">
                  {todayCounts.exit}
                </span>
              </div>
              <div className="text-[10px] text-red-300/60">Bugün Toplam</div>
            </div>

            <div className="bg-orange-900/30 border border-orange-500/30 p-4 rounded-lg hover:scale-105 transition-transform cursor-pointer group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-orange-300 flex items-center gap-1 font-bold">
                  <Activity size={16} /> İçeride
                </span>
                <span className="text-3xl font-bold text-orange-400 group-hover:scale-110 transition-transform animate-pulse">{activeLogs.length}</span>
              </div>
              <div className="text-[10px] text-orange-300/60">Şu Anda Aktif</div>
            </div>

            <div className="bg-purple-900/30 border border-purple-500/30 p-4 rounded-lg hover:scale-105 transition-transform cursor-pointer group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-purple-300 flex items-center gap-1 font-bold">
                  <Timer size={16} /> Ort. Süre
                </span>
                <span className="text-2xl font-bold text-purple-400 group-hover:scale-110 transition-transform">
                  {todayDetailedStats.avgWaitMinutes > 0
                    ? `${Math.floor(todayDetailedStats.avgWaitMinutes / 60)}s ${todayDetailedStats.avgWaitMinutes % 60}dk`
                    : '-'
                  }
                </span>
              </div>
              <div className="text-[10px] text-purple-300/60">
                {todayDetailedStats.completedCount} tamamlanan ziyaret
              </div>
            </div>
          </div>

          {/* VARDİYA BAZLI GÖRSEL GRAFİK */}
          <div className="bg-zinc-900/50 p-4 rounded-lg mb-4 border border-zinc-700">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="text-blue-400" size={18} />
              <h3 className="text-sm font-bold text-blue-300">Vardiya Dağılımı (Girişler)</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(todayDetailedStats.shiftBreakdown).map(([shift, count]) => {
                const total = Object.values(todayDetailedStats.shiftBreakdown).reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
                const isActiveShift = shift === currentShift;

                return (
                  <div key={shift} className={`p-3 rounded-lg transition-all ${isActiveShift ? 'bg-blue-600/30 border-2 border-blue-500 scale-105' : 'bg-zinc-800 border border-zinc-700'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-zinc-300">{shift.split(' ')[0]}</span>
                      {isActiveShift && <span className="bg-blue-500 text-white text-[9px] px-2 py-0.5 rounded font-bold animate-pulse">AKTİF</span>}
                    </div>
                    <div className="text-2xl font-bold text-white mb-1">{count}</div>
                    <div className="w-full bg-zinc-700 rounded-full h-2 mb-1">
                      <div className={`h-2 rounded-full transition-all duration-500 ${isActiveShift ? 'bg-blue-500' : 'bg-zinc-500'}`} style={{ width: `${percentage}%` }}></div>
                    </div>
                    <div className="text-[10px] text-zinc-400">{percentage}% / {shift.match(/\(([^)]+)\)/)[1]}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* KATEGORİ BAZLI İSTATİSTİKLER */}
          {Object.keys(todayDetailedStats.categoryBreakdown).length > 0 && (
            <div className="bg-zinc-900/50 p-4 rounded-lg mb-4 border border-zinc-700">
              <div className="flex items-center gap-2 mb-3">
                <PieChart className="text-green-400" size={18} />
                <h3 className="text-sm font-bold text-green-300">Kategori Dağılımı (Girişler)</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(todayDetailedStats.categoryBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([category, count]) => {
                    const total = Object.values(todayDetailedStats.categoryBreakdown).reduce((a, b) => a + b, 0);
                    const percentage = Math.round((count / total) * 100);

                    return (
                      <div key={category} className="bg-zinc-800 p-2 rounded border border-zinc-700 hover:border-zinc-500 transition-colors group">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryStyle(category)}`}>
                            {category.replace(' Aracı', '').replace('Fabrika Personeli', 'Personel')}
                          </span>
                          <span className="text-lg font-bold text-white group-hover:scale-110 transition-transform">{count}</span>
                        </div>
                        <div className="text-[9px] text-zinc-400">%{percentage}</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* SON 1 SAAT İSTATİSTİĞİ - GELİŞTİRİLMİŞ */}
          {todayDetailedStats.recentCount > 0 && (
            <div className="bg-gradient-to-r from-blue-900/30 to-cyan-900/30 border border-blue-500/50 p-4 rounded-lg mb-4 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="text-blue-400 animate-pulse" size={20} />
                  <span className="text-base font-bold text-blue-200">Son 1 Saatteki Hareketlilik</span>
                </div>
                <span className="bg-blue-500 text-white text-xs px-3 py-1 rounded-full font-bold animate-pulse">
                  CANLI
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-900/30 p-3 rounded-lg border border-green-500/30">
                  <div className="flex items-center gap-2 mb-1">
                    <ArrowRightCircle className="text-green-400" size={16} />
                    <span className="text-xs text-green-300 font-bold">Giriş</span>
                  </div>
                  <div className="text-2xl font-bold text-green-400">{todayDetailedStats.recentEntries}</div>
                </div>
                <div className="bg-red-900/30 p-3 rounded-lg border border-red-500/30">
                  <div className="flex items-center gap-2 mb-1">
                    <ArrowLeftCircle className="text-red-400" size={16} />
                    <span className="text-xs text-red-300 font-bold">Çıkış</span>
                  </div>
                  <div className="text-2xl font-bold text-red-400">{todayDetailedStats.recentExits}</div>
                </div>
                <div className="bg-blue-900/30 p-3 rounded-lg border border-blue-500/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="text-blue-400" size={16} />
                    <span className="text-xs text-blue-300 font-bold">Toplam</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-400">{todayDetailedStats.recentCount}</div>
                </div>
              </div>
            </div>
          )}

          {/* FİLTRELEME VE AYARLAR */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4 pb-3 border-b border-zinc-700">
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => { setTodayPageFilter('all'); setTodayCurrentPage(1); }}
                variant={todayPageFilter === 'all' ? 'primary' : 'secondary'}
                size="sm"
                className={todayPageFilter === 'all' ? 'scale-[1.02]' : ''}
              >
                Tümü ({todayCounts.total})
              </Button>
              <Button
                onClick={() => { setTodayPageFilter('entry'); setTodayCurrentPage(1); }}
                variant={todayPageFilter === 'entry' ? 'primary' : 'secondary'}
                size="sm"
                className={cx('gap-1', todayPageFilter === 'entry' ? 'scale-[1.02]' : '')}
              >
                <ArrowRightCircle size={14} /> Girişler ({todayCounts.entry})
              </Button>
              <Button
                onClick={() => { setTodayPageFilter('exit'); setTodayCurrentPage(1); }}
                variant={todayPageFilter === 'exit' ? 'primary' : 'secondary'}
                size="sm"
                className={cx('gap-1', todayPageFilter === 'exit' ? 'scale-[1.02]' : '')}
              >
                <ArrowLeftCircle size={14} /> Çıkışlar ({todayCounts.exit})
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={todayCategoryFilter}
                onChange={(e) => { setTodayCategoryFilter(e.target.value); setTodayCurrentPage(1); }}
                className="w-auto text-xs font-bold py-2"
              >
                <option value="">Tüm Kategoriler</option>
                {Object.entries(todayDetailedStats.categoryBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <option key={cat} value={cat}>
                      {cat} ({count})
                    </option>
                  ))}
              </Select>

              <Select
                value={todayPageSize}
                onChange={() => {}}
                className="w-auto text-xs font-bold py-2"
                disabled
                title="Sayfa başına gösterim ayarı (15 kayıt sabit)"
              >
                <option value={15}>15 kayıt/sayfa</option>
              </Select>
            </div>
          </div>

          {/* TABLO */}
          <div className="flex-1 ui-table-wrap">
            <table className="ui-table">
              <thead className="bg-gradient-to-r from-zinc-900 to-zinc-800 text-zinc-200 sticky top-0 shadow-lg">
                <tr>
                  <TableHeadCell
                    icon={<Clock size={14} className="text-blue-400" />}
                    label="Saat"
                    sortKey="time"
                    sortState={todaySort}
                    onSort={toggleTodaySort}
                  />
                  <TableHeadCell
                    icon={<Activity size={14} className="text-orange-400" />}
                    label="Durum"
                    sortKey="direction"
                    sortState={todaySort}
                    onSort={toggleTodaySort}
                  />
                  <TableHeadCell
                    icon={<Layers size={14} className="text-purple-400" />}
                    label="Kategori"
                    sortKey="sub_category"
                    sortState={todaySort}
                    onSort={toggleTodaySort}
                  />
                  <TableHeadCell
                    icon={<Car size={14} className="text-green-400" />}
                    label="Plaka / İsim"
                    sortKey="identifier"
                    sortState={todaySort}
                    onSort={toggleTodaySort}
                  />
                  <TableHeadCell
                    icon={<Zap size={14} className="text-yellow-400" />}
                    label="Hızlı İşlem"
                    align="right"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700">
                {(() => {
                  const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
                  const {
                    rows: paginatedLogs,
                    totalRows,
                    totalPages,
                    startIndex,
                    endIndex
                  } = todayTableState;

                  return (
                    <>
                      {paginatedLogs.map(log => {
                        const isEntry = log.isEntry;
                        const isCurrentlyInside = log.isCurrentlyInside;
                        const hasExited = log.hasExited;
                        const identifier = log.identifier;
                        const isAlreadyInside = log.isAlreadyInside;
                        const isAmbiguousInside = log.isAmbiguousInside;
                        const isRecent = (new Date(log.time).getTime() || 0) >= oneHourAgoMs;

                        return (
                          <tr
                            key={`${log.id}-${log.direction}`}
                            className={`hover:bg-zinc-700/50 transition-all ${isEntry ? 'bg-green-900/5' : 'bg-red-900/5'} ${isRecent ? 'border-l-4 border-l-blue-500 bg-blue-900/10 animate-in fade-in slide-in-from-left-2' : ''}`}
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-bold">
                                  {new Date(log.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {isRecent && (
                                  <span className="bg-blue-500 text-white px-2 py-0.5 rounded text-[9px] font-bold animate-pulse shadow-lg">
                                    SON 1 SAAT
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3">
                              {isEntry ? (
                                <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-fit">
                                  <ArrowRightCircle size={12} /> GİRİŞ
                                </span>
                              ) : (
                                <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-fit">
                                  <ArrowLeftCircle size={12} /> ÇIKIŞ
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              <span className={`text-[10px] font-bold px-2 py-1 rounded border uppercase ${getCategoryStyle(log.sub_category)}`}>
                                {getShortCategory(log.sub_category)}
                              </span>
                            </td>
                            <td className="p-3 font-bold text-white">
                              <div>{identifier}</div>
                              {log.driver && <div className="text-xs text-zinc-400 font-normal">{log.driver}</div>}
                              {isAmbiguousInside && (
                                <div className="text-[10px] text-yellow-300 font-bold mt-1">BELİRSİZ DURUM</div>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex justify-end gap-1">
                                {isEntry && isCurrentlyInside && (
                                  <button
                                    onClick={() => handleQuickExit(log)}
                                    disabled={actionLoading === log.id}
                                    className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                                    title="Çıkış Yap"
                                  >
                                    {actionLoading === log.id ? <RefreshCw size={12} className="animate-spin" /> : <LogOut size={12} />}
                                    Çıkış Yap
                                  </button>
                                )}
                                {isEntry && isAmbiguousInside && (
                                  <button
                                    onClick={() => confirmAmbiguousExit(log)}
                                    disabled={actionLoading === log.id}
                                    className="px-3 py-1.5 rounded bg-yellow-600/80 hover:bg-yellow-500 text-white text-xs font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                                    title="Belirsiz durum: zorla çıkış"
                                  >
                                    <AlertTriangle size={12} />
                                    Zorla Çıkış
                                  </button>
                                )}
                                {isEntry && hasExited && !isAlreadyInside && (
                                  <button
                                    onClick={() => handleReEntry(log)}
                                    disabled={actionLoading === log.id || loading}
                                    className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                                    title="Tekrar Giriş Yap"
                                  >
                                    {actionLoading === log.id ? <RefreshCw size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                    Tekrar Giriş
                                  </button>
                                )}
                                {!isEntry && !isAlreadyInside && (
                                  <button
                                    onClick={() => handleReEntry(log)}
                                    disabled={actionLoading === log.id || loading}
                                    className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                                    title="Tekrar Giriş Yap"
                                  >
                                    {actionLoading === log.id ? <RefreshCw size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                    Tekrar Giriş
                                  </button>
                                )}
                                {!isEntry && isAlreadyInside && (
                                  <span className="text-xs text-green-400 italic flex items-center h-full px-2">
                                    Zaten içeride
                                  </span>
                                )}

                                {/* DÜZENLE BUTONU */}
                                <button
                                  onClick={() => {
                                    setEditingLog(log);
                                    setEditForm({ ...log, entry_location: getEntryLocation(log), exit_location: getExitLocation(log) });
                                  }}
                                  className="px-2 py-1.5 rounded bg-blue-900/50 hover:bg-blue-600 text-blue-400 hover:text-white transition-all"
                                  title="Kaydı Düzenle"
                                >
                                  <Edit size={14} />
                                </button>

                                {/* SİL BUTONU */}
                                <button
                                  onClick={() => handleDelete(log.id)}
                                  className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-red-900 text-red-500 hover:text-red-300 transition-colors"
                                  title="Kaydı Sil"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {totalRows === 0 && (
                        <tr>
                          <td colSpan={5} className="ui-empty">
                            <div className="flex flex-col items-center gap-2">
                              <Search size={28} className="text-zinc-600" />
                              <div className="font-semibold text-zinc-300">
                                {debouncedActiveSearchTerm || todayPageFilter !== 'all' || todayCategoryFilter
                                  ? 'Filtreye uygun kayıt bulunamadı.'
                                  : 'Bugün henüz kayıt bulunmuyor.'}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {debouncedActiveSearchTerm || todayPageFilter !== 'all' || todayCategoryFilter
                                  ? 'Filtreleri değiştirmeyi deneyin.'
                                  : 'Giriş/çıkış kaydı eklendiğinde burada görünecek.'}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* SAYFALAMA - GELİŞTİRİLMİŞ */}
                      {totalPages > 1 && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 p-4 border-t border-zinc-700">
                              <div className="flex flex-col md:flex-row items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-lg border border-zinc-700">
                                    {totalRows} kayıttan <span className="font-bold text-blue-400">{startIndex + 1}-{Math.min(endIndex, totalRows)}</span> arası
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setTodayCurrentPage(1)}
                                    disabled={todayCurrentPage === 1}
                                    className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    title="İlk Sayfa"
                                  >
                                    İlk
                                  </button>
                                  <button
                                    onClick={() => setTodayCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={todayCurrentPage === 1}
                                    className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1"
                                  >
                                    Önceki
                                  </button>

                                  <div className="flex items-center gap-1">
                                    {[...Array(Math.min(5, totalPages))].map((_, idx) => {
                                      let pageNum;
                                      if (totalPages <= 5) {
                                        pageNum = idx + 1;
                                      } else if (todayCurrentPage <= 3) {
                                        pageNum = idx + 1;
                                      } else if (todayCurrentPage >= totalPages - 2) {
                                        pageNum = totalPages - 4 + idx;
                                      } else {
                                        pageNum = todayCurrentPage - 2 + idx;
                                      }

                                      return (
                                        <button
                                          key={pageNum}
                                          onClick={() => setTodayCurrentPage(pageNum)}
                                          className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${todayCurrentPage === pageNum
                                            ? 'bg-blue-600 text-white scale-110 shadow-lg'
                                            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                            }`}
                                        >
                                          {pageNum}
                                        </button>
                                      );
                                    })}
                                    {totalPages > 5 && todayCurrentPage < totalPages - 2 && (
                                      <>
                                        <span className="text-zinc-500 px-2">...</span>
                                        <button
                                          onClick={() => setTodayCurrentPage(totalPages)}
                                          className="px-3 py-2 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 text-xs font-bold transition-all"
                                        >
                                          {totalPages}
                                        </button>
                                      </>
                                    )}
                                  </div>

                                  <button
                                    onClick={() => setTodayCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={todayCurrentPage === totalPages}
                                    className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1"
                                  >
                                    Sonraki
                                  </button>
                                  <button
                                    onClick={() => setTodayCurrentPage(totalPages)}
                                    disabled={todayCurrentPage === totalPages}
                                    className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    title="Son Sayfa"
                                  >
                                    Son
                                  </button>
                                </div>

                                <div className="text-xs text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-lg border border-zinc-700">
                                  Sayfa <span className="font-bold text-blue-400">{todayCurrentPage}</span> / {totalPages}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </section>

        {/* ALT: RAPOR */}
        <section className="lg:col-span-12 ui-card p-6 shadow-lg mt-2">
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h2 className="text-lg font-bold flex items-center gap-2"><FileText className="text-blue-400" /> Kayıt Geçmişi & Rapor</h2>
              <div className="flex items-center gap-2">
                <Button onClick={() => setShowHistoryPanel((prev) => !prev)} variant="secondary" className="gap-2">
                  {showHistoryPanel ? 'Geçmişi Gizle' : 'Geçmişi Göster'}
                </Button>
                <Button onClick={exportToExcel} variant="secondary" className="gap-2" disabled={!showHistoryPanel}>
                  Excel <CheckCircle size={14} />
                </Button>
              </div>
            </div>
            {showHistoryPanel ? (
              <>
            {advancedReportEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Toplam (Filtreli)</div>
                  <div className="text-2xl font-bold">{advancedReport.total}</div>
                </div>
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Iceride</div>
                  <div className="text-2xl font-bold text-green-300">{advancedReport.insideCount}</div>
                </div>
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Cikis Yapan</div>
                  <div className="text-2xl font-bold text-zinc-200">{advancedReport.exitedCount}</div>
                </div>
                <div className="ui-panel">
                  <div className="text-xs text-zinc-400">Ort. Kalis</div>
                  <div className="text-2xl font-bold text-blue-300">{advancedReport.avgStayMins} dk</div>
                </div>
                <div className="ui-panel md:col-span-2">
                  <div className="text-xs text-zinc-400 mb-2">Top Birimler</div>
                  <div className="space-y-1">
                    {advancedReport.topHosts.map((item) => (
                      <div key={item.label} className="flex justify-between text-xs">
                        <span className="truncate pr-2">{item.label}</span>
                        <span className="text-zinc-300">{item.count}</span>
                      </div>
                    ))}
                    {advancedReport.topHosts.length === 0 && <div className="text-xs text-zinc-500">Veri yok.</div>}
                  </div>
                </div>
                <div className="ui-panel md:col-span-2">
                  <div className="text-xs text-zinc-400 mb-2">Saatlik Yogunluk</div>
                  <div className="grid grid-cols-12 gap-1 items-end h-16">
                    {advancedReport.hourly.map((h) => {
                      const max = Math.max(1, ...advancedReport.hourly.map((x) => x.count || 0));
                      const pct = Math.max(6, Math.round((100 * h.count) / max));
                      return (
                        <div key={h.hour} className="bg-zinc-800 rounded-sm relative" style={{ height: `${pct}%` }} title={`${String(h.hour).padStart(2, '0')}:00 -> ${h.count}`} />
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-2">
                    En yogun saat: {String(advancedReport.busiestHour.hour).padStart(2, '0')}:00 ({advancedReport.busiestHour.count})
                  </div>
                </div>
              </div>
            )}
            <div className="ui-panel flex flex-wrap gap-3">
              <div className="flex items-center gap-2"><Filter size={16} className="text-zinc-400" /><span className="text-xs text-zinc-400 font-bold">FİLTRELE:</span></div>
              <div className="relative flex-1 min-w-[180px] sm:min-w-[200px]">
                <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
                <Input type="text" placeholder="Plaka, İsim, TC, Telefon, Sürücü ara..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9 pr-3" />
              </div>
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-zinc-400" />
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-auto" />
                <span className="text-zinc-500">-</span>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-auto" />
              </div>
              <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-auto min-w-[150px]">{CATEGORIES.map(cat => (<option key={cat.value} value={cat.value}>{cat.label}</option>))}</Select>
              <Button onClick={() => setShowAdvancedFilters(prev => !prev)} variant="secondary" size="sm" className="gap-1">
                <Filter size={14} /> Gelişmiş
              </Button>
              {(searchTerm || dateFrom || dateTo || categoryFilter || statusFilter !== 'all' || typeFilter !== 'all' || shiftFilter || hostFilter || locationFilter || sealFilter) && (
                <Button onClick={() => { setSearchTerm(''); setDateFrom(''); setDateTo(''); setCategoryFilter(''); setStatusFilter('all'); setTypeFilter('all'); setShiftFilter(''); setHostFilter(''); setLocationFilter(''); setSealFilter(''); setShowAdvancedFilters(false); }} variant="destructive" size="sm" className="gap-1">
                  <X size={14} /> Temizle
                </Button>
              )}
              <span className="text-xs text-zinc-500 self-center ml-auto">
                {reportTableState.isTruncated
                  ? `${filteredLogs.length} kayit (ilk ${reportRenderLimit})`
                  : `${filteredLogs.length} kayit`}
              </span>
              {reportTableState.isTruncated && (
                <div className="w-full text-xs text-amber-300">
                  {liteMode
                    ? `Lite mod aktif: performans icin yalnizca ilk ${reportRenderLimit} kayit listeleniyor.`
                    : `Performans icin tabloda yalnizca ilk ${reportRenderLimit} kayit listeleniyor.`}
                </div>
              )}
              {showAdvancedFilters && (
                <div className="flex flex-wrap gap-3 w-full pt-2">
                  <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-auto min-w-[150px]">
                    <option value="all">Durum: Tüm</option>
                    <option value="inside">Durum: İçeride</option>
                    <option value="outside">Durum: Çıktı</option>
                  </Select>
                  <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-auto min-w-[150px]">
                    <option value="all">Tip: Tüm</option>
                    <option value="vehicle">Tip: Araç</option>
                    <option value="visitor">Tip: Ziyaretçi</option>
                  </Select>
                  <Select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)} className="w-auto min-w-[180px]">
                    <option value="">Vardiya: Tüm</option>
                    <option value="Vardiya 1 (08:00-16:00)">Vardiya 1</option>
                    <option value="Vardiya 2 (16:00-00:00)">Vardiya 2</option>
                    <option value="Vardiya 3 (00:00-08:00)">Vardiya 3</option>
                  </Select>
                  <Input type="text" placeholder="İlgili birim" value={hostFilter} onChange={e => setHostFilter(e.target.value)} list="hostOptions" className="w-auto min-w-[200px]" />
                  <Input type="text" placeholder="Lokasyon" value={locationFilter} onChange={e => setLocationFilter(e.target.value)} list="locationOptions" className="w-auto min-w-[180px]" />
                  <Input type="text" placeholder="Mühür no" value={sealFilter} onChange={e => setSealFilter(e.target.value)} className="w-auto min-w-[160px]" />
                </div>
              )}
              <datalist id="hostOptions">
                {hostOptions.map((opt) => (<option key={opt} value={opt} />))}
              </datalist>
              <datalist id="locationOptions">
                {locationOptions.map((opt) => (<option key={opt} value={opt} />))}
              </datalist>
            </div>
            </>
            ) : (
              <div className="ui-panel text-sm text-zinc-400">
                Geçmiş kayıt listesi gizli. İsterseniz "Geçmişi Göster" ile açabilirsiniz.
              </div>
            )}
          </div>
          {showHistoryPanel && (
          <>
          <div className="ui-table-wrap max-h-[400px]">
            <table className="ui-table" id="raporTablosu">
              <thead className="bg-zinc-900 text-zinc-200 sticky top-0 z-10">
                <tr>
                  <TableHeadCell
                    label="Tarih"
                    sortKey="created_at"
                    sortState={reportSort}
                    onSort={toggleReportSort}
                  />
                  <TableHeadCell
                    label="Vardiya"
                    sortKey="shift"
                    sortState={reportSort}
                    onSort={toggleReportSort}
                  />
                  <TableHeadCell
                    label="Kategori"
                    sortKey="sub_category"
                    sortState={reportSort}
                    onSort={toggleReportSort}
                  />
                  <TableHeadCell
                    label="Plaka / İsim"
                    sortKey="identifier"
                    sortState={reportSort}
                    onSort={toggleReportSort}
                  />
                  <TableHeadCell label="Sürücü" />
                  <TableHeadCell label="İlgili / Lokasyon" />
                  <TableHeadCell label="Not" />
                  <TableHeadCell
                    label="Giriş"
                    sortKey="created_at"
                    sortState={reportSort}
                    onSort={toggleReportSort}
                  />
                  <TableHeadCell
                    label="Çıkış"
                    sortKey="exit_at"
                    sortState={reportSort}
                    onSort={toggleReportSort}
                  />
                  {optionalAttachmentsEnabled && <TableHeadCell label="Ekler" />}
                  <TableHeadCell
                    label="Durum"
                    sortKey="status"
                    sortState={reportSort}
                    onSort={toggleReportSort}
                  />
                  <TableHeadCell label="İşlem" align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700">
                {reportTableState.rows.map(log => {
                  const isInside = !log.exit_at;
                  const identifier = log.plate || log.name;
                  const rowAttachments = getAttachmentsForLog(log);
                  const attachmentCount = rowAttachments.length;
                  const isAlreadyInside = isIdentifierInside(log);

                  return (
                    <tr key={log.id} className={`hover:bg-zinc-700/30 ${isInside ? 'bg-green-900/10' : ''}`}>
                      <td className="p-3 text-xs">{new Date(log.created_at).toLocaleDateString('tr-TR')}</td>
                      <td className="p-3 text-xs font-mono text-orange-300">{log.shift?.split(' ')[0]}</td>
                      <td className="p-3 text-xs"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${getCategoryStyle(log.sub_category)}`}>{log.sub_category?.replace(' Aracı', '')}</span></td>
                      <td className="p-3 font-bold text-white">{identifier}</td>
                      <td className="p-3 text-xs text-zinc-300">{log.driver || '-'}</td>
                      <td className="p-3 text-xs"><div>{log.host}</div>{formatLogLocation(log) && <div className="text-blue-400">Lokasyon: {formatLogLocation(log)}</div>}</td>
                      <td className="p-3 text-xs text-zinc-400 max-w-[150px] truncate" title={log.note}>{log.note || '-'}</td>
                      <td className="p-3 font-mono text-xs text-green-400">{new Date(log.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="p-3 font-mono text-xs text-red-400">{log.exit_at ? new Date(log.exit_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                      {optionalAttachmentsEnabled && (
                        <td className="p-3 text-xs">
                          {attachmentCount > 0 ? (
                            <button onClick={() => setAttachmentModalLog(log)} className="px-2 py-1 rounded bg-blue-900/40 hover:bg-blue-700 text-blue-200">
                              {attachmentCount} dosya
                            </button>
                          ) : '-'}
                        </td>
                      )}
                      <td className="p-3">{isInside ? <Badge variant="green" className={isInside ? 'animate-pulse' : ''}>İÇERİDE</Badge> : <Badge>ÇIKTI</Badge>}</td>
                      <td className="p-3 text-right">
                        <div className="flex gap-1 justify-end">
                          {isInside && (<button onClick={() => handleQuickExit(log)} disabled={actionLoading === log.id} className="text-red-400 hover:text-white p-2 bg-red-900/50 rounded hover:bg-red-600 transition text-xs font-bold flex items-center gap-1" title="Çıkış Yap"><LogOut size={14} /></button>)}
                          {!isInside && !isAlreadyInside && (<button onClick={() => handleReEntry(log)} disabled={actionLoading === log.id || loading} className="text-green-400 hover:text-white p-2 bg-green-900/50 rounded hover:bg-green-600 transition text-xs font-bold flex items-center gap-1" title="Tekrar Giriş Yap"><RotateCcw size={14} /></button>)}
                          <button onClick={() => { setEditingLog(log); setEditForm({ ...log, entry_location: getEntryLocation(log), exit_location: getExitLocation(log) }); }} className="text-blue-400 hover:text-blue-300 p-2 bg-zinc-900 rounded hover:bg-zinc-700 transition"><Edit size={14} /></button>
                          <button onClick={() => handleDelete(log.id)} className="text-red-400 hover:text-red-300 p-2 bg-zinc-900 rounded hover:bg-red-900/50 transition"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {reportTableState.rows.length === 0 && (
                  <tr>
                    <td colSpan={optionalAttachmentsEnabled ? 12 : 11} className="ui-empty">
                      <div className="flex flex-col items-center gap-2">
                        <Filter size={28} className="text-zinc-600" />
                        <div className="font-semibold text-zinc-200">Kayıt bulunamadı</div>
                        <div className="text-xs text-zinc-500">Filtreleri temizleyip tekrar deneyin.</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {reportTableState.totalRows > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
              <span>
                {`${reportTableState.startIndex + 1}-${reportTableState.endIndex} / ${reportTableState.totalRows}`}
                {reportTableState.isTruncated ? ` (filtrelenen toplam: ${reportTableState.sourceTotal})` : ''}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReportCurrentPage(1)}
                  disabled={reportTableState.safePage <= 1}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40 transition-colors text-xs font-medium"
                >
                  İlk
                </button>
                <button
                  type="button"
                  onClick={() => setReportCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={reportTableState.safePage <= 1}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40 transition-colors text-xs font-medium"
                >
                  Geri
                </button>
                <span className="px-2">
                  {reportTableState.safePage} / {reportTableState.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setReportCurrentPage((prev) => Math.min(reportTableState.totalPages, prev + 1))}
                  disabled={reportTableState.safePage >= reportTableState.totalPages}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40 transition-colors text-xs font-medium"
                >
                  İleri
                </button>
                <button
                  type="button"
                  onClick={() => setReportCurrentPage(reportTableState.totalPages)}
                  disabled={reportTableState.safePage >= reportTableState.totalPages}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40 transition-colors text-xs font-medium"
                >
                  Son
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </section>
      </main>

      {/* MODALS */}
      <Toast notification={notification} onClose={closeToast} />
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        confirmLabel={confirmModal.confirmLabel}
        cancelLabel={confirmModal.cancelLabel}
        secondaryLabel={confirmModal.secondaryLabel}
        secondaryVariant={confirmModal.secondaryVariant}
        confirmVariant={confirmModal.confirmVariant}
        onSecondary={confirmModal.onSecondary}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      {optionalAttachmentsEnabled && (
        <Modal isOpen={!!attachmentModalLog} onClose={() => setAttachmentModalLog(null)} title="Kayıt Ekleri" size="lg">
          <div className="text-xs text-zinc-400 -mt-2 mb-3">{attachmentModalLog?.plate || attachmentModalLog?.name || '-'} | {new Date(attachmentModalLog?.created_at || Date.now()).toLocaleString('tr-TR')}</div>

          <div className="ui-panel mb-3">
            <div className="text-xs text-zinc-400 mb-2">Yeni dosya ekle</div>
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={handleAttachmentModalSelect} className="ui-input" />
          </div>

          <div className="space-y-2">
            {(attachmentModalLog ? getAttachmentsForLog(attachmentModalLog) : []).map((item) => (
              <div key={item.id} className="ui-panel flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm truncate">{item.name}</div>
                  <div className="text-[11px] text-zinc-500">{humanFileSize(item.size)} | {item.type || '-'}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => downloadDataUrl(item.name, item.dataUrl)}>İndir</Button>
                  <Button size="sm" variant="destructive" onClick={() => removeAttachmentFromLog(attachmentModalLog, item.id)}>Sil</Button>
                </div>
              </div>
            ))}
            {(attachmentModalLog ? getAttachmentsForLog(attachmentModalLog) : []).length === 0 && (
              <div className="text-sm text-zinc-500">Bu kayıt için ek dosya yok.</div>
            )}
          </div>
        </Modal>
      )}

      <Modal isOpen={exitSealModalOpen} onClose={() => { setExitSealModalOpen(false); setExitingLogData(null); }} title={<span className="flex gap-2 items-center"><Lock className="text-red-500" /> Araç Çıkış Mühürü</span>} size="sm" className="border-red-500">
        <p className="text-zinc-300 text-sm mb-2">Lütfen çıkış yapan mühürlü araç için <strong className="text-red-400">ÇIKIŞ MÜHÜR</strong> numarasını giriniz.</p>
        {exitingLogData?.seal_number_entry && (<div className="bg-green-900/30 border border-green-500/50 p-2 rounded mb-4"><p className="text-green-300 text-sm">Giriş Mührü: <strong className="text-white">{exitingLogData.seal_number_entry}</strong></p></div>)}
        <Input type="text" autoFocus placeholder="Çıkış Mühür No Giriniz..." value={exitSealNumber} onChange={(e) => setExitSealNumber(e.target.value)} className="border-red-500/50 focus:border-red-500 mb-4 font-bold text-lg" />
        <div className="flex gap-3">
          <Button onClick={() => { setExitSealModalOpen(false); setExitingLogData(null); }} variant="secondary" className="flex-1">İptal</Button>
          <Button onClick={confirmSealedExit} disabled={actionLoading} variant="destructive" className="flex-1">{actionLoading ? <><RefreshCw size={14} className="animate-spin" /> İŞLENİYOR...</> : 'Çıkışı Onayla'}</Button>
        </div>
      </Modal>

      {editingLog && (
        <Modal isOpen={!!editingLog} onClose={() => setEditingLog(null)} title={<span className="flex gap-2 items-center"><Edit className="text-blue-500" /> Kaydı Düzenle</span>} size="lg">
          <div className="mb-4">
            <FormField label="DURUM">
            <div className="flex bg-zinc-900 rounded p-1">
              <button onClick={() => setEditForm({ ...editForm, exit_at: null })} className={cx('flex-1 py-3 rounded font-bold text-sm transition-all', !editForm.exit_at ? 'bg-green-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800')}>İÇERİDE</button>
              <button onClick={() => setEditForm({ ...editForm, exit_at: editForm.exit_at || new Date().toISOString() })} className={cx('flex-1 py-3 rounded font-bold text-sm transition-all', editForm.exit_at ? 'bg-red-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800')}>DIŞARIDA</button>
            </div>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="col-span-2 bg-zinc-900/50 p-3 rounded border border-zinc-700 mb-2">
              <div className="text-xs font-bold text-orange-400 mb-2 flex items-center gap-1"><CalendarClock size={14} /> ZAMAN DÜZENLEME</div>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="GİRİŞ SAATİ"><Input type="datetime-local" value={formatForInput(editForm.created_at)} onChange={(e) => setEditForm({ ...editForm, created_at: new Date(e.target.value).toISOString() })} className="text-xs" /></FormField>
                <FormField label="ÇIKIŞ SAATİ"><Input type="datetime-local" disabled={!editForm.exit_at} value={formatForInput(editForm.exit_at)} onChange={(e) => setEditForm({ ...editForm, exit_at: e.target.value ? new Date(e.target.value).toISOString() : null })} className={cx('text-xs', !editForm.exit_at && 'opacity-50 cursor-not-allowed')} /></FormField>
              </div>
            </div>
            <div className="col-span-2"><FormField label="VARDİYA"><Select value={editForm.shift || ''} onChange={e => setEditForm({ ...editForm, shift: e.target.value })}><option value="Vardiya 1 (08:00-16:00)">Vardiya 1 (08:00-16:00)</option><option value="Vardiya 2 (16:00-00:00)">Vardiya 2 (16:00-00:00)</option><option value="Vardiya 3 (00:00-08:00)">Vardiya 3 (00:00-08:00)</option></Select></FormField></div>
            <FormField label="PLAKA / İSİM"><Input type="text" value={editForm.plate || editForm.name || ''} onChange={e => editForm.type === 'vehicle' ? setEditForm({ ...editForm, plate: e.target.value }) : setEditForm({ ...editForm, name: e.target.value })} /></FormField>
            <FormField label="SÜRÜCÜ"><Input type="text" value={editForm.driver || ''} onChange={e => setEditForm({ ...editForm, driver: e.target.value })} /></FormField>
            <FormField label="İLGİLİ BİRİM"><Input type="text" value={editForm.host || ''} onChange={e => setEditForm({ ...editForm, host: e.target.value })} /></FormField>
            <FormField label="GİRİŞ LOKASYON"><Input type="text" value={editForm.entry_location || ''} onChange={e => setEditForm({ ...editForm, entry_location: e.target.value, location: buildLegacyLocationValue(e.target.value, editForm.exit_location) })} /></FormField>
            <FormField label="ÇIKIŞ LOKASYON"><Input type="text" value={editForm.exit_location || ''} onChange={e => setEditForm({ ...editForm, exit_location: e.target.value, location: buildLegacyLocationValue(editForm.entry_location, e.target.value) })} /></FormField>
            <FormField label="TC KİMLİK"><Input type="text" value={editForm.tc_no || ''} onChange={e => setEditForm({ ...editForm, tc_no: e.target.value.replace(/\D/g, '').slice(0, 11) })} maxLength={11} /></FormField>
            <FormField label="TELEFON"><Input type="text" value={editForm.phone || ''} onChange={e => setEditForm({ ...editForm, phone: formatPhone(e.target.value) })} maxLength={14} /></FormField>
            {editForm.sub_category?.includes('Mühür') && (<><FormField label="GİRİŞ MÜHRÜ"><Input type="text" value={editForm.seal_number_entry || ''} onChange={e => setEditForm({ ...editForm, seal_number_entry: e.target.value })} className="border-green-500/50" /></FormField><FormField label="ÇIKIŞ MÜHRÜ"><Input type="text" value={editForm.seal_number_exit || ''} onChange={e => setEditForm({ ...editForm, seal_number_exit: e.target.value })} className="border-red-500/50" /></FormField></>)}
            <div className="col-span-2"><FormField label="AÇIKLAMA"><Textarea value={editForm.note || ''} onChange={e => setEditForm({ ...editForm, note: e.target.value })} className="h-24" /></FormField></div>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => handleDelete(editingLog.id)} variant="destructive" className="gap-2"><Trash2 size={16} /> Sil</Button>
            <Button onClick={() => setEditingLog(null)} variant="secondary" className="flex-1">İptal</Button>
            <Button onClick={handleUpdate} disabled={actionLoading === editingLog?.id} variant="primary" className="flex-1">{actionLoading === editingLog?.id ? <><RefreshCw size={14} className="animate-spin" /> Kaydediliyor...</> : 'Değişiklikleri Kaydet'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}





