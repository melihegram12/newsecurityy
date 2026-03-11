# Performance Analysis Report (Static)

## Most referenced endpoints (proxy for call frequency)
- EXTERNAL SELECT /rest/v1/security_logs: 20 call sites
- IPC invoke db:getActiveLogs: 2 call sites
- IPC invoke db:upsertLogByCreatedAt: 2 call sites
- IPC invoke email:getSettings: 2 call sites
- REST POST /api/logs/sync: 1 call sites
- IPC invoke db:getAllLogs: 1 call sites
- IPC invoke db:getLogsByDateRange: 1 call sites
- IPC invoke db:insertLog: 1 call sites
- IPC invoke db:updateLog: 1 call sites
- IPC invoke db:exitLog: 1 call sites
- IPC invoke db:deleteLog: 1 call sites
- IPC invoke db:searchLogs: 1 call sites
- IPC invoke db:getStats: 1 call sites
- IPC invoke db:setSetting: 1 call sites
- IPC invoke db:getSetting: 1 call sites

## Potentially large-payload endpoints (heuristic)
- POST /api/check (backend(django))
- POST /api/logs/sync (backend(django))

## Notes
- Static call-site counts do not equal runtime frequency; use telemetry for real numbers.
