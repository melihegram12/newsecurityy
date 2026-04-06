# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (React + CRA)

```bash
# Dev server (port 3000)
npm start

# Build (uses scripts/build-with-time.js, injects timestamp)
node ./node_modules/react-scripts/bin/react-scripts.js build

# Run all tests
node ./node_modules/react-scripts/bin/react-scripts.js test --watchAll=false

# Run a single test file
node ./node_modules/react-scripts/bin/react-scripts.js test --watchAll=false src/lib/utils.test.js
```

> `npm run build` and `npx` may fail on Windows due to PATH issues — use the `node ./node_modules/...` form directly.

### Django Backend

```bash
docker compose up -d
docker compose exec api python manage.py migrate
docker compose exec api python manage.py bootstrap_users --reset-passwords
docker compose exec api python manage.py seed_roles
docker compose exec api python manage.py seed_absence_types
docker compose exec api python manage.py bootstrap_device <site_id> <gate_id> <label>

# Run backend tests
docker compose exec api python manage.py test core.tests
```

### Electron (Desktop)

```bash
npm run electron:dev        # CRA + Electron concurrently (port 3001)
npm run electron:build      # Production NSIS installer
npm run electron:build:lite # Lightweight build (PowerShell)
```

### Utilities

```bash
npm run cap:sync            # Sync React build → Capacitor Android
npm run sync:supabase:pull  # Pull Supabase data to local SQLite
npm run api:map             # Regenerate docs/api-business-mapping/ docs
npm run feature:smoke       # Full feature smoke test
```

## Architecture

### Multi-Target Platform

Single React codebase deployed to three targets:
- **Web (SPA)** — Nginx in Docker
- **Desktop (Electron 39)** — Windows NSIS installer with auto-updater
- **Mobile (Capacitor 8)** — Android via Gradle

### Dual Backend

| Backend | Purpose |
|---------|---------|
| **Supabase** (cloud) | Primary store, real-time subscriptions (`REACT_APP_SUPABASE_URL/KEY`) |
| **Django 5 + DRF** (self-hosted) | Offline sync, HR/payroll, device auth (port 8000 via Docker) |

`src/dbClient.js` is the dual-sync engine — writes to both backends with idempotency via `client_event_uuid`. All Supabase interaction routes through this file or `src/supabaseClient.js`.

### Frontend Structure

- **`src/App.jsx`** (~8000 lines) — monolithic component: auth, all roles, dashboard, forms, modals. Not split intentionally yet.
- **`src/dbClient.js`** — Supabase + Django sync, offline queue, SQLite cache.
- **`src/lib/constants.js`** — Roles, feature flags, sync intervals.
- **`src/lib/utils.js`** — Formatters, validators, `simpleHash`.
- **`src/lib/audit-utils.js`** — Audit chain: `buildAuditHash`, `verifyAuditChain`. Hash = SHA-like over `prev_hash|at|action|user|role|message`.
- **`src/lib/csv-utils.js`** — Excel/CSV import/export.
- **`src/lib/tokens.js`** — JWT parsing.
- **`src/lib/data.js`** — Hardcoded staff/vehicle lists (planned backend migration).
- **`src/components/ui/`** — Button, Card, Modal, Badge, Input, Select, Textarea, FormField, Toast, ConfirmModal, Dropdown.
- **`src/hooks/useDebounce.js`** — Custom debounce hook.

### Electron Layer

- **`electron/main.js`** — BrowserWindow, IPC handlers, auto-updater.
- **`electron/database.js`** — sql.js SQLite wrapper (in-memory + file persistence).
- **`electron/emailService.js`** — Nodemailer SMTP, scheduled reports.
- **`electron/scheduler.js`** — node-schedule background tasks.
- **`electron/backupScheduler.js`** — Automated local backup scheduling.
- **`electron/preload.js`** — Context bridge (only exposed APIs are available to renderer).

All filesystem/SQLite access from renderer goes through IPC. Check `electron/main.js` for available channels before adding new ones.

### Django Backend (`backend/core/`)

**Models:** `Site`, `Gate`, `Device`, `DeviceSession`, `User`, `UserRole`, `Person`, `Badge`, `AccessEvent`, `SecurityLog`, `AuditLog`, `AbsenceRecord`, `AbsenceType`, `WorkShift`, `ShiftAssignment`, `PayrollProfile`, `HostPreset`, `VehiclePreset`.

**Key endpoints:**
```
POST /api/auth/login              # Role-based login (SECURITY, HR, MANAGER, ACCOUNTING, ADMIN, DEVELOPER)
GET  /api/auth/me                 # Current user + roles
GET  /api/auth/audit              # AuditLog list (ADMIN/DEVELOPER only)
POST /api/device/auth             # Kiosk device JWT
POST /api/check                   # IN/OUT access event
GET  /api/logs                    # SecurityLog list
POST /api/logs/sync               # Batch sync from frontend
CRUD /api/persons, /api/badges
CRUD /api/host-presets, /api/vehicle-presets
CRUD /api/absence/types, /api/absence/records  # + approve/reject/cancel sub-routes
CRUD /api/shifts, /api/shift-assignments
GET  /api/attendance/summary
CRUD /api/payroll/profiles
GET  /api/payroll/summary
GET  /api/sgk/report
GET  /api/access-events
```

**Migrations:** `0001_initial` → `0010_seed_host_and_vehicle_presets` in `backend/core/migrations/`.

### created_at Integrity System

`SecurityLog.created_at` is treated as immutable once written. The Supabase migration `supabase/2026-04-01-security-logs-created-at-integrity.sql` enforces this with a trigger that blocks updates to `created_at`. The frontend's `audit-utils.js` chain-hashes logs using `prev_hash`. Any mismatch causes a fail-fast error — do not add retry/fallback logic around integrity failures.

### Database Setup

**Supabase:** Run `migration_script.sql` in the Supabase SQL editor. Tables: `access_events`, `logs`, `persons`, `companies` with RLS policies. Also apply `supabase/2026-04-01-security-logs-created-at-integrity.sql`.

**Django:** `docker compose exec api python manage.py migrate`

**Electron SQLite:** Auto-initialized on first launch via `electron/database.js`.

## Known Constraints

- **`filteredLogs` must NOT be in any `useEffect` dependency array** — defined at line ~1902 of App.jsx after callbacks that reference it; adding it causes a TDZ crash at runtime.
- **`_` prefixed vars are intentionally unused**: `_loginError`, `_fetchLogsFromLocalApi`, `_handleLogin`, `_handleLogout`, `_removeAllAttachmentsForLog` — do not remove them.
- **`FormField`** uses `cloneElement` and only supports a single child. Use `labelClass` prop directly for complex nested structures.
- **Fallback passwords** in the frontend bundle are known security debt, not an oversight.
- **`entry_location` / `exit_location`** fields are mid-migration to a new schema; legacy usage still exists.
- **`created_at` on SecurityLog is immutable** — any edit/delete flow must preserve it. Never allow the frontend to send a modified `created_at`.

## Technical Debt (Do Not Fix Without Intent)

1. **`src/App.jsx` is monolithic (~8000 lines)** — planned split: LoginPage, DashboardPage, EntryFormPage, ReportsPage, SettingsPage. Do not split incrementally mid-feature.
2. **Dual style system** — CSS `ui-*` classes + JS `tokens.js` coexist, not yet unified.
3. **`src/lib/data.js`** — Hardcoded staff/vehicle lists, planned Django migration.
4. **Django HR modules** — absence, shift, payroll endpoints exist but have no frontend UI.
5. **Frontend tests** — only `src/lib/utils.test.js` exists; no component or integration tests.

## Environment Variables

Required in `.env`:

```
REACT_APP_SUPABASE_URL=
REACT_APP_SUPABASE_ANON_KEY=
REACT_APP_LOCAL_API_URL=        # Django API, e.g. http://localhost:8000
REACT_APP_LOCAL_API_KEY=        # Device API key for offline sync
```

See `.env.example` for the full list including SMTP and Django settings.
