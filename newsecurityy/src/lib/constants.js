// --- SABİT AYARLAR ---
export const OFFLINE_QUEUE_KEY = 'security_offline_queue';
export const LONG_STAY_HOURS = 4;
export const BUILD_TIME_RAW = process.env.REACT_APP_BUILD_TIME || '';
export const BUILD_TIME = BUILD_TIME_RAW && !Number.isNaN(Date.parse(BUILD_TIME_RAW))
  ? new Date(BUILD_TIME_RAW).toLocaleString('tr-TR')
  : (BUILD_TIME_RAW || 'dev');
export const LOCAL_API_URL_KEY = 'local_api_url';
export const LOCAL_API_KEY_KEY = 'local_api_key';
export const LOCAL_API_TOKEN_KEY = 'local_api_token';
export const LOCAL_ROLE_SESSION_KEY = 'local_role_session';
export const ACTIVE_ROLE_KEY = 'active_role';
export const ACTION_LOGS_KEY = 'app_action_logs';
export const LOCAL_SYNC_ENABLED = String(process.env.REACT_APP_LOCAL_SYNC_ENABLED || process.env.VITE_LOCAL_SYNC_ENABLED || '').toLowerCase() === 'true';
export const LOCAL_API_DEFAULT_URL = process.env.REACT_APP_LOCAL_API_URL || process.env.VITE_LOCAL_API_URL || '';
export const SHOW_SYNC_PANEL_KEY = 'show_sync_panel';
export const SHOW_SMTP_PANEL_KEY = 'show_smtp_panel';
export const SHOW_HISTORY_PANEL_KEY = 'show_history_panel';
export const LITE_MODE_KEY = 'ui_lite_mode';
export const FEATURE_FLAGS_KEY = 'feature_flags_v2';
export const ATTACHMENTS_SETTINGS_KEY = 'log_attachments_v1';
export const SUPABASE_SYNC_QUEUE_KEY = 'supabase_sync_queue';
export const LOCAL_SYNC_QUEUE_KEY = 'local_sync_queue';
export const MAX_ATTACHMENTS_PER_LOG = 4;
export const MAX_ATTACHMENT_SIZE_BYTES = 2 * 1024 * 1024;
export const REPORT_RENDER_LIMIT_NORMAL = 1200;
export const REPORT_PAGE_SIZE_NORMAL = 50;
export const REPORT_PAGE_SIZE_LITE = 50;
export const DIRECTION_ENTRY = 'Giriş';
export const DIRECTION_EXIT = 'Çıkış';
export const DEFAULT_FEATURE_FLAGS = Object.freeze({
  optionalAttachments: true,
  advancedReport: true,
  offlineQueueInspector: true,
  enhancedAudit: true,
});

export const ROLE_SECURITY = 'SECURITY';
export const ROLE_HR = 'HR';
export const ROLE_DEVELOPER = 'DEVELOPER';
export const ROLE_FALLBACK_PASSWORDS = {
  [ROLE_SECURITY]: process.env.REACT_APP_SECURITY_PASSWORD || process.env.VITE_SECURITY_PASSWORD || '',
  [ROLE_HR]: process.env.REACT_APP_HR_PASSWORD || process.env.VITE_HR_PASSWORD || '',
  [ROLE_DEVELOPER]: process.env.REACT_APP_DEVELOPER_PASSWORD || process.env.VITE_DEVELOPER_PASSWORD || '',
};
export const ROLE_FALLBACK_USERS = {
  [ROLE_SECURITY]: { username: 'guvenlik_personeli', email: 'guvenlik@local' },
  [ROLE_HR]: { username: 'insan_kaynaklari', email: 'ik@local' },
  [ROLE_DEVELOPER]: { username: 'gelistirici', email: 'gelistirici@local' },
};
export const LOGIN_ROLE_OPTIONS = [
  { code: ROLE_SECURITY, label: 'Güvenlik Personeli' },
  { code: ROLE_HR, label: 'İnsan Kaynakları' },
  { code: ROLE_DEVELOPER, label: 'Geliştirici' },
];
