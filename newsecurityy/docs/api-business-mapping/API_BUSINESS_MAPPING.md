# Project API Business Mapping

## Project Overview
- Backend Framework: Django
- Frontend Framework: React
- API Architecture Pattern: REST
- Authentication Method: JWT (SimpleJWT) + Device Token (custom) + Optional API Key

## 1. API Endpoints Summary
- Total endpoints count: 59
- Endpoints by kind: {"external": 4, "ipc": 30, "rest": 25}
- Endpoints by HTTP method (REST): {"GET": 4, "POST": 9, "(unknown)": 10, "ANY (Netlify handler)": 1, "ANY": 1}
- Public vs authenticated (REST): 4 public / 21 auth/other
- API versioning strategy: (heuristic) path-prefix if present (e.g. `/api/v1`).

## 2. Complete API Registry

### REST APIs
| Endpoint | Method | Purpose | Auth Required | Request Schema | Response Schema | Used By Components | Source |
|---|---|---|---|---|---|---|---|
| /.netlify/functions/send-report | ANY (Netlify handler) | Netlify function: send-report | Env secrets / custom |  |  |  | netfliy/functions/send-report.js:1 |
| /admin/ | GET | Django admin UI | Admin session |  |  |  | backend/security_api/urls.py:7 |
| /api/absence/records |  | AbsenceRecordListCreateView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:33 |
| /api/absence/records/<uuid:pk> |  | AbsenceRecordDetailView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:34 |
| /api/absence/records/<uuid:pk>/approve/hr | POST | AbsenceRecordHRApproveView | JWT Bearer (default) / project defaults |  | {"person_name": {"type": "CharField", "required": true, "allow_blank": false}, "absence_type_name": {"type": "CharField", "required": true, "allow_blank": false}, "id": {"type": "ModelField", "required": false, "allow_blank": false}, "person": {"type": "ModelField", "required": false, "allow_blank": false}, "absence_type": {"type": "ModelField", "required": false, "allow_blank": false}, "status": {"type": "ModelField", "required": false, "allow_blank": false}, "start_at": {"type": "ModelField", "required": false, "allow_blank": false}, "end_at": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_unit": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_value": {"type": "ModelField", "required": false, "allow_blank": false}, "is_excused": {"type": "ModelField", "required": false, "allow_blank": false}, "note": {"type": "ModelField", "required": false, "allow_blank": false}, "source": {"type": "ModelField", "required": false, "allow_blank": false}, "created_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_by": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_at": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_by": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_note": {"type": "ModelField", "required": false, "allow_blank": false}, "created_at": {"type": "ModelField", "required": false, "allow_blank": false}, "updated_at": {"type": "ModelField", "required": false, "allow_blank": false}} |  | backend/core/urls.py:36 |
| /api/absence/records/<uuid:pk>/approve/manager | POST | AbsenceRecordManagerApproveView | JWT Bearer (default) / project defaults |  | {"person_name": {"type": "CharField", "required": true, "allow_blank": false}, "absence_type_name": {"type": "CharField", "required": true, "allow_blank": false}, "id": {"type": "ModelField", "required": false, "allow_blank": false}, "person": {"type": "ModelField", "required": false, "allow_blank": false}, "absence_type": {"type": "ModelField", "required": false, "allow_blank": false}, "status": {"type": "ModelField", "required": false, "allow_blank": false}, "start_at": {"type": "ModelField", "required": false, "allow_blank": false}, "end_at": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_unit": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_value": {"type": "ModelField", "required": false, "allow_blank": false}, "is_excused": {"type": "ModelField", "required": false, "allow_blank": false}, "note": {"type": "ModelField", "required": false, "allow_blank": false}, "source": {"type": "ModelField", "required": false, "allow_blank": false}, "created_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_by": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_at": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_by": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_note": {"type": "ModelField", "required": false, "allow_blank": false}, "created_at": {"type": "ModelField", "required": false, "allow_blank": false}, "updated_at": {"type": "ModelField", "required": false, "allow_blank": false}} |  | backend/core/urls.py:35 |
| /api/absence/records/<uuid:pk>/cancel | POST | AbsenceRecordCancelView | JWT Bearer (default) / project defaults |  | {"person_name": {"type": "CharField", "required": true, "allow_blank": false}, "absence_type_name": {"type": "CharField", "required": true, "allow_blank": false}, "id": {"type": "ModelField", "required": false, "allow_blank": false}, "person": {"type": "ModelField", "required": false, "allow_blank": false}, "absence_type": {"type": "ModelField", "required": false, "allow_blank": false}, "status": {"type": "ModelField", "required": false, "allow_blank": false}, "start_at": {"type": "ModelField", "required": false, "allow_blank": false}, "end_at": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_unit": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_value": {"type": "ModelField", "required": false, "allow_blank": false}, "is_excused": {"type": "ModelField", "required": false, "allow_blank": false}, "note": {"type": "ModelField", "required": false, "allow_blank": false}, "source": {"type": "ModelField", "required": false, "allow_blank": false}, "created_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_by": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_at": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_by": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_note": {"type": "ModelField", "required": false, "allow_blank": false}, "created_at": {"type": "ModelField", "required": false, "allow_blank": false}, "updated_at": {"type": "ModelField", "required": false, "allow_blank": false}} |  | backend/core/urls.py:38 |
| /api/absence/records/<uuid:pk>/reject | POST | AbsenceRecordRejectView | JWT Bearer (default) / project defaults |  | {"person_name": {"type": "CharField", "required": true, "allow_blank": false}, "absence_type_name": {"type": "CharField", "required": true, "allow_blank": false}, "id": {"type": "ModelField", "required": false, "allow_blank": false}, "person": {"type": "ModelField", "required": false, "allow_blank": false}, "absence_type": {"type": "ModelField", "required": false, "allow_blank": false}, "status": {"type": "ModelField", "required": false, "allow_blank": false}, "start_at": {"type": "ModelField", "required": false, "allow_blank": false}, "end_at": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_unit": {"type": "ModelField", "required": false, "allow_blank": false}, "duration_value": {"type": "ModelField", "required": false, "allow_blank": false}, "is_excused": {"type": "ModelField", "required": false, "allow_blank": false}, "note": {"type": "ModelField", "required": false, "allow_blank": false}, "source": {"type": "ModelField", "required": false, "allow_blank": false}, "created_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "manager_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "hr_approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_by": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_at": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_by": {"type": "ModelField", "required": false, "allow_blank": false}, "rejected_at": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_by": {"type": "ModelField", "required": false, "allow_blank": false}, "cancelled_at": {"type": "ModelField", "required": false, "allow_blank": false}, "approved_note": {"type": "ModelField", "required": false, "allow_blank": false}, "created_at": {"type": "ModelField", "required": false, "allow_blank": false}, "updated_at": {"type": "ModelField", "required": false, "allow_blank": false}} |  | backend/core/urls.py:37 |
| /api/absence/types |  | AbsenceTypeListCreateView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:31 |
| /api/absence/types/<uuid:pk> |  | AbsenceTypeDetailView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:32 |
| /api/attendance/summary | GET | AttendanceSummaryView | JWT Bearer (default) / project defaults |  | {"full_name": {"type": "Unknown", "required": false, "allow_blank": false}, "id": {"type": "Unknown", "required": false, "allow_blank": false}, "person": {"type": "Unknown", "required": false, "allow_blank": false}} |  | backend/core/urls.py:43 |
| /api/auth/token/ | POST | Obtain JWT access/refresh tokens | Public |  |  |  | backend/security_api/urls.py:8 |
| /api/auth/token/refresh/ | POST | Refresh JWT access token | Public |  |  |  | backend/security_api/urls.py:9 |
| /api/check | POST | CheckView | Device token (Authorization: Device <token>) | {"client_event_uuid": {"type": "UUIDField", "required": true, "allow_blank": false}, "direction": {"type": "ChoiceField", "required": true, "allow_blank": false}, "badge_code": {"type": "CharField", "required": false, "allow_blank": true}, "person_id": {"type": "UUIDField", "required": false, "allow_blank": false}, "note": {"type": "CharField", "required": false, "allow_blank": true}, "metadata": {"type": "DictField", "required": false, "allow_blank": false}, "person": {"type": "Nested(PersonInputSerializer)", "required": false, "allow_blank": false}} | {"person": {"type": "SerializerMethodField", "required": true, "allow_blank": false}, "badge": {"type": "SerializerMethodField", "required": true, "allow_blank": false}, "id": {"type": "ModelField", "required": false, "allow_blank": false}, "client_event_uuid": {"type": "ModelField", "required": false, "allow_blank": false}, "created_at": {"type": "ModelField", "required": false, "allow_blank": false}, "direction": {"type": "ModelField", "required": false, "allow_blank": false}, "site": {"type": "ModelField", "required": false, "allow_blank": false}, "gate": {"type": "ModelField", "required": false, "allow_blank": false}, "device": {"type": "ModelField", "required": false, "allow_blank": false}, "note": {"type": "ModelField", "required": false, "allow_blank": false}, "metadata": {"type": "ModelField", "required": false, "allow_blank": false}, "duplicate": {"type": "DerivedField", "required": false, "allow_blank": false}} |  | backend/core/urls.py:29 |
| /api/device/auth | POST | DeviceAuthView | Public | {"device_id": {"type": "CharField", "required": true, "allow_blank": false}, "device_key": {"type": "CharField", "required": true, "allow_blank": false}} | {"detail": {"type": "Unknown", "required": false, "allow_blank": false}, "device": {"type": "Unknown", "required": false, "allow_blank": false}, "device_id": {"type": "Unknown", "required": false, "allow_blank": false}, "expires_at": {"type": "Unknown", "required": false, "allow_blank": false}, "gate_id": {"type": "Unknown", "required": false, "allow_blank": false}, "id": {"type": "Unknown", "required": false, "allow_blank": false}, "name": {"type": "Unknown", "required": false, "allow_blank": false}, "site_id": {"type": "Unknown", "required": false, "allow_blank": false}, "token": {"type": "Unknown", "required": false, "allow_blank": false}} |  | backend/core/urls.py:28 |
| /api/logs/sync | POST | LogSyncView | Public (Optional X-Api-Key (env-gated)) | {"action": {"type": "ChoiceField", "required": true, "allow_blank": false}, "data": {"type": "DictField", "required": false, "allow_blank": false}, "local_id": {"type": "CharField", "required": false, "allow_blank": true}} | {"id": {"type": "ModelField", "required": false, "allow_blank": false}, "event_type": {"type": "ModelField", "required": false, "allow_blank": false}, "type": {"type": "ModelField", "required": false, "allow_blank": false}, "sub_category": {"type": "ModelField", "required": false, "allow_blank": false}, "shift": {"type": "ModelField", "required": false, "allow_blank": false}, "plate": {"type": "ModelField", "required": false, "allow_blank": false}, "driver": {"type": "ModelField", "required": false, "allow_blank": false}, "name": {"type": "ModelField", "required": false, "allow_blank": false}, "host": {"type": "ModelField", "required": false, "allow_blank": false}, "note": {"type": "ModelField", "required": false, "allow_blank": false}, "location": {"type": "ModelField", "required": false, "allow_blank": false}, "seal_number": {"type": "ModelField", "required": false, "allow_blank": false}, "seal_number_entry": {"type": "ModelField", "required": false, "allow_blank": false}, "seal_number_exit": {"type": "ModelField", "required": false, "allow_blank": false}, "tc_no": {"type": "ModelField", "required": false, "allow_blank": false}, "phone": {"type": "ModelField", "required": false, "allow_blank": false}, "user_email": {"type": "ModelField", "required": false, "allow_blank": false}, "created_at": {"type": "ModelField", "required": false, "allow_blank": false}, "exit_at": {"type": "ModelField", "required": false, "allow_blank": false}} | src/dbClient.js | backend/core/urls.py:30 |
| /api/payroll/profiles |  | PayrollProfileListCreateView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:44 |
| /api/payroll/profiles/<uuid:pk> |  | PayrollProfileDetailView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:45 |
| /api/payroll/summary | GET | PayrollSummaryView | JWT Bearer (default) / project defaults |  | {"currency": {"type": "Unknown", "required": false, "allow_blank": false}, "date_from": {"type": "Unknown", "required": false, "allow_blank": false}, "date_to": {"type": "Unknown", "required": false, "allow_blank": false}, "persons": {"type": "Unknown", "required": false, "allow_blank": false}} |  | backend/core/urls.py:46 |
| /api/sgk/report | GET | SGKReportView | JWT Bearer (default) / project defaults |  | {"date_from": {"type": "Unknown", "required": false, "allow_blank": false}, "date_to": {"type": "Unknown", "required": false, "allow_blank": false}, "records": {"type": "Unknown", "required": false, "allow_blank": false}, "summary": {"type": "Unknown", "required": false, "allow_blank": false}} |  | backend/core/urls.py:47 |
| /api/shift-assignments |  | ShiftAssignmentListCreateView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:41 |
| /api/shift-assignments/<uuid:pk> |  | ShiftAssignmentDetailView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:42 |
| /api/shifts |  | WorkShiftListCreateView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:39 |
| /api/shifts/<uuid:pk> |  | WorkShiftDetailView | JWT Bearer (default) / project defaults |  |  |  | backend/core/urls.py:40 |
| /functions/v1/send-daily-report | ANY | Supabase Edge Function: send-daily-report | Supabase JWT/service role/env secrets |  |  |  | supabase/functions/send-daily-report/index.ts:1 |

### GraphQL APIs
_No GraphQL schema/resolvers detected by heuristic scan._

### gRPC APIs
_No gRPC `.proto` services detected by heuristic scan._

### WebSocket Events
_No WebSocket server/client detected by heuristic scan._

### Electron IPC (Internal)
| Channel | Direction | Purpose | Payload Schema | Used By Components | Source |
|---|---|---|---|---|---|
| app:getVersion | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:186 |
| app:quit | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:187 |
| backup:getStatus | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:229 |
| backup:openFolder | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:232 |
| backup:runNow | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:230 |
| backup:setSettings | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:231 |
| db:deleteLog | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:177 |
| db:exitLog | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:176 |
| db:getActiveLogs | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:171 |
| db:getAllLogs | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:172 |
| db:getDbPath | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:183 |
| db:getLogsByDateRange | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:173 |
| db:getSetting | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:182 |
| db:getStats | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:180 |
| db:insertLog | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:174 |
| db:searchLogs | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:179 |
| db:setSetting | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:181 |
| db:updateLog | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:175 |
| db:upsertLogByCreatedAt | Renderer -> Main (invoke) | Electron IPC handler |  | src/dbClient.js | electron/main.js:178 |
| email:getSettings | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:216 |
| email:saveSettings | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:217 |
| email:sendDailyReport | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:219 |
| email:sendTestEmail | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:220 |
| email:testSmtp | Renderer -> Main (invoke) | Electron IPC handler |  | src/App.jsx | electron/main.js:218 |
| file:openFolder | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:211 |
| file:saveFile | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:193 |
| scheduler:getStatus | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:226 |
| scheduler:restart | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:225 |
| scheduler:start | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:223 |
| scheduler:stop | Renderer -> Main (invoke) | Electron IPC handler |  |  | electron/main.js:224 |

### External APIs
| Service | Endpoint | Purpose | Authentication | Used By | Source |
|---|---|---|---|---|---|
| Resend | https://api.resend.com/emails | Send transactional email | RESEND_API_KEY |  | netfliy/functions/send-report.js:1 |
| SMTP | smtp:// | Email delivery (SMTP) | SMTP credentials |  | electron/emailService.js:1 |
| Supabase(PostgREST) | /rest/v1/security_logs | Supabase table operation on security_logs | Anon key / RLS policies | src/App.jsx, src/dbClient.js | src/App.jsx:601 |
| external(http) | https://api.resend.com/emails | Direct HTTP call (literal URL) | Unknown |  | netfliy/functions/send-report.js:76 |

## 3. Frontend API Usage Map

### By Component/Page (static scan)
**src/App.jsx**
- EXTERNAL SELECT /rest/v1/security_logs
- IPC invoke app:quit
- IPC invoke backup:getStatus
- IPC invoke backup:openFolder
- IPC invoke backup:runNow
- IPC invoke email:getSettings
- IPC invoke email:saveSettings
- IPC invoke email:sendDailyReport
- IPC invoke email:testSmtp

**src/dbClient.js**
- EXTERNAL SELECT /rest/v1/security_logs
- IPC invoke db:deleteLog
- IPC invoke db:exitLog
- IPC invoke db:getActiveLogs
- IPC invoke db:getAllLogs
- IPC invoke db:getLogsByDateRange
- IPC invoke db:getSetting
- IPC invoke db:getStats
- IPC invoke db:insertLog
- IPC invoke db:searchLogs
- IPC invoke db:setSetting
- IPC invoke db:updateLog
- IPC invoke db:upsertLogByCreatedAt
- REST POST /api/logs/sync

### By API Endpoint (static scan)
**ANY (Netlify handler) /.netlify/functions/send-report**
- Consumed by: (not found by static scan)
- Auth: Env secrets / custom

**GET /admin/**
- Consumed by: (not found by static scan)
- Auth: Admin session

** /api/absence/records**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/absence/records/<uuid:pk>**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**POST /api/absence/records/<uuid:pk>/approve/hr**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**POST /api/absence/records/<uuid:pk>/approve/manager**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**POST /api/absence/records/<uuid:pk>/cancel**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**POST /api/absence/records/<uuid:pk>/reject**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/absence/types**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/absence/types/<uuid:pk>**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**GET /api/attendance/summary**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**POST /api/auth/token/**
- Consumed by: (not found by static scan)
- Auth: Public

**POST /api/auth/token/refresh/**
- Consumed by: (not found by static scan)
- Auth: Public

**POST /api/check**
- Consumed by: (not found by static scan)
- Auth: Device token (Authorization: Device <token>)

**POST /api/device/auth**
- Consumed by: (not found by static scan)
- Auth: Public

**POST /api/logs/sync**
- Consumed by: src/dbClient.js
- Auth: Public (Optional X-Api-Key (env-gated))

** /api/payroll/profiles**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/payroll/profiles/<uuid:pk>**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**GET /api/payroll/summary**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**GET /api/sgk/report**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/shift-assignments**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/shift-assignments/<uuid:pk>**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/shifts**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

** /api/shifts/<uuid:pk>**
- Consumed by: (not found by static scan)
- Auth: JWT Bearer (default) / project defaults

**ANY /functions/v1/send-daily-report**
- Consumed by: (not found by static scan)
- Auth: Supabase JWT/service role/env secrets

## 4. API Architecture Patterns
- Auth flows, middleware/guards/interceptors, caching, and rate limiting are inferred heuristically; verify against runtime config.
- API versioning is inferred via path prefixes (e.g. `/api/v1`).

## 5. Data Flow Analysis
- Component -> API edges are derived from static call-site scanning (fetch/axios/supabase/ipc/graphql/ws).
- For SSR/SSG frameworks, server-side calls may not be fully captured without runtime tracing.

## 6. Dependencies and Configurations
### HTTP/API clients (heuristic)
- `src/supabaseClient.js:24`: supabase | base_url=supabaseUrl | createClient(url, key) args: supabaseUrl, supabaseKey
- `supabase/functions/send-daily-report/index.ts:32`: supabase | base_url=SUPABASE_URL | createClient(url, key) args: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

### Detected tooling/libraries (heuristic)
- auth_libs: python:djangorestframework-simplejwt
- third_party: supabase

## 7. Security Analysis (summary)
- Review secrets management and rotate any keys that were ever committed.
- Review CORS rules, auth guards, and Supabase RLS policies for least privilege.

## 8. Performance Insights
### Most referenced endpoints (static proxy)
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

## 9. API Health Check
- Unused REST endpoints (no call sites found): 24
  - ANY (Netlify handler) /.netlify/functions/send-report (serverless(netlify))
  - GET /admin/ (backend(django))
  -  /api/absence/records (backend(django))
  -  /api/absence/records/<uuid:pk> (backend(django))
  - POST /api/absence/records/<uuid:pk>/approve/hr (backend(django))
  - POST /api/absence/records/<uuid:pk>/approve/manager (backend(django))
  - POST /api/absence/records/<uuid:pk>/cancel (backend(django))
  - POST /api/absence/records/<uuid:pk>/reject (backend(django))
  -  /api/absence/types (backend(django))
  -  /api/absence/types/<uuid:pk> (backend(django))
  - GET /api/attendance/summary (backend(django))
  - POST /api/auth/token/ (backend(django))
  - POST /api/auth/token/refresh/ (backend(django))
  - POST /api/check (backend(django))
  - POST /api/device/auth (backend(django))
  -  /api/payroll/profiles (backend(django))
  -  /api/payroll/profiles/<uuid:pk> (backend(django))
  - GET /api/payroll/summary (backend(django))
  - GET /api/sgk/report (backend(django))
  -  /api/shift-assignments (backend(django))
  - ... (truncated)

## 10. Recommendations
- Add OpenAPI/Swagger (or equivalent) generation to make schemas authoritative.
- Add contract tests for critical endpoints and automate in CI.
- Add centralized error handling and consistent response envelopes where appropriate.
