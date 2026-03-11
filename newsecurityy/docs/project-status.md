# Malhotra Security Panel — Project Status Report

> Generated: 2026-03-09
> App Version: 6.7
> Build Size: 303.9 kB (gzip)
> App.jsx: 6,182 lines

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    DEPLOYMENT TARGETS                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Electron │  │   Web    │  │ Capacitor│  │Netlify │  │
│  │ Desktop  │  │ (Nginx)  │  │ Android  │  │  SPA   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       └──────────────┴─────────────┴─────────────┘      │
│                         │                                │
│              ┌──────────▼──────────┐                     │
│              │   React 19 SPA     │                     │
│              │   (src/App.jsx)    │                     │
│              └──────────┬──────────┘                     │
│           ┌─────────────┼─────────────┐                  │
│     ┌─────▼─────┐ ┌─────▼─────┐ ┌────▼─────┐           │
│     │ Supabase  │ │ Django    │ │ Electron │           │
│     │ (Cloud)   │ │ REST API  │ │ SQLite   │           │
│     │ Optional  │ │ (Local)   │ │ (Offline)│           │
│     └─────┬─────┘ └─────┬─────┘ └────┬─────┘           │
│           │              │             │                 │
│     ┌─────▼─────┐ ┌─────▼─────┐ ┌────▼─────┐           │
│     │ Supabase  │ │PostgreSQL │ │ sql.js   │           │
│     │ Postgres  │ │  (Docker) │ │ In-Mem   │           │
│     └───────────┘ └───────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────┘
```

**Data Sync Strategy:** Offline-first. Data can be stored in any of three backends and synced between them:
- **Supabase** — Cloud PostgreSQL (primary for web deployments)
- **Django API** — On-premise PostgreSQL via Docker (for air-gapped environments)
- **Electron SQLite** — Local in-memory database via sql.js (for offline resilience)

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 19.2.0 |
| Styling | Tailwind CSS | 3.4.1 |
| Icons | Lucide React | 0.555.0 |
| Charts | Recharts | 3.6.0 |
| Excel Export | SheetJS (xlsx) | 0.18.5 |
| Desktop | Electron | 39.2.7 |
| Mobile | Capacitor | 8.0.0 |
| Cloud DB | Supabase | 2.90.1 |
| Backend | Django + DRF | 5.0.10 / 3.15.2 |
| Auth (Backend) | SimpleJWT | 5.3.1 |
| Local DB | sql.js (SQLite) | 1.13.0 |
| Email | Nodemailer | 7.0.12 |
| Scheduler | node-schedule | 2.1.1 |
| Reverse Proxy | Nginx | latest |
| Container | Docker Compose | v3.8 |

---

## 3. Implemented Features

### 3.1 Security Log Management (Core — Fully Functional)
- Vehicle entry/exit tracking with plate recognition
- Visitor entry/exit tracking with name/TC/phone
- Sub-categories: Guest Vehicle, Staff Vehicle, Management Vehicle, Company Vehicle, Service Vehicle, Sealed Vehicle, Visitor, Factory Staff, Ex-Staff
- Direction-aware forms (Entry vs Exit)
- Entry/exit location tracking (legacy `location` + modern `entry_location`/`exit_location`)
- Seal number tracking for sealed vehicles (entry + exit seals)
- Real-time "currently inside" dashboard
- Shift-based logging (3 shifts: 08-16, 16-00, 00-08)
- Plate/name history lookup (repeat visitor detection)

### 3.2 Reporting & Export (Fully Functional)
- Filterable log table with advanced filters (status, type, shift, host, location, seal, date range)
- Excel export (XLSX) with formatted columns
- CSV import with intelligent field mapping and deduplication
- Daily report generation (manual date selection)
- Email report delivery via SMTP (Electron only)
- Scheduled automatic daily reports (node-schedule)

### 3.3 Authentication & Authorization (Fully Functional)
- Role-based login: Security Personnel, HR, Developer
- Supabase auth (cloud) or local role-based session (offline)
- Fallback passwords for offline login
- Session management with auto-logout

### 3.4 Offline Capabilities (Fully Functional)
- Offline queue for pending operations
- Local SQLite storage in Electron
- Sync queue processing (Supabase ↔ Local API)
- Conflict resolution on sync

### 3.5 Desktop App — Electron (Fully Functional)
- Standalone Windows desktop application
- Auto-updater with configurable update URL
- Local SQLite database
- SMTP email service integration
- Backup scheduler for database
- IPC bridge for renderer ↔ main communication

### 3.6 Mobile App — Capacitor (Scaffold Only)
- Android project generated
- Capacitor config present
- **No mobile-specific features implemented**

### 3.7 Backend — Django REST API (Partially Implemented)

**Fully implemented endpoints:**
- Device authentication (`POST /api/device/auth`)
- User role-based login (`POST /api/auth/login`)
- Session info (`GET /api/auth/me`)
- Log sync from frontend (`POST /api/logs/sync`)
- Log listing (`GET /api/logs`)
- Audit log listing (`GET /api/auth/audit`)

**Implemented but not connected to frontend:**
- Absence/Leave management (CRUD + approval workflow)
- Work shift management (CRUD + assignments)
- Payroll profile management (CRUD + calculations)
- Attendance summary calculations
- SGK (Social Security) report generation

### 3.8 UI/UX Design System (In Progress — Phase 2)

**Completed:**
- CSS design tokens (`:root` variables, `ui-*` class system in `index.css`)
- JS design tokens (`src/lib/tokens.js`)
- 13 reusable UI components: Button, Card, Input, Select, Textarea, Modal, ConfirmModal, Dropdown, Badge, FormField, TableHeadCell, Toast, SubTabBtn
- Aurora gradient background with animated conic gradient
- Shadcn-inspired dark theme
- Responsive mobile overrides
- Custom scrollbar styling

**Partially migrated:**
- 4/4 modal overlays migrated to `<Modal>` component
- Edit form migrated to `<FormField>` + `<Input>` + `<Select>` + `<Textarea>`
- Filter bar migrated to `<Input>` + `<Select>`
- Vehicle/Visitor entry forms migrated to `<Input>` + `<FormField>`
- 1 remaining `labelClass` usage (complex host selector)

---

## 4. Important Files & Their Purpose

### Frontend
| File | Purpose | Lines |
|------|---------|-------|
| `src/App.jsx` | Monolithic main component (all views, state, logic) | 6,182 |
| `src/supabaseClient.js` | Supabase client initialization | ~15 |
| `src/dbClient.js` | Electron SQLite client + sync functions | ~200 |
| `src/index.css` | Global styles, design system CSS, aurora theme | 419 |
| `src/lib/constants.js` | All application constants and config | ~100 |
| `src/lib/utils.js` | 30+ utility functions (validation, formatting, etc.) | 355 |
| `src/lib/tokens.js` | Design tokens (colors, styles, status, direction) | ~80 |
| `src/lib/data.js` | Static reference data (staff, vehicles, categories) | ~120 |
| `src/lib/csv-utils.js` | CSV import/export logic | ~150 |
| `src/lib/audit-utils.js` | Audit hash chain functions | ~40 |
| `src/components/ui/` | 13 reusable UI components | ~350 total |

### Backend
| File | Purpose | Lines |
|------|---------|-------|
| `backend/core/models.py` | 16 Django models | ~480 |
| `backend/core/views.py` | 25+ API views | ~600 |
| `backend/core/serializers.py` | DRF serializers | ~150 |
| `backend/core/urls.py` | 35 URL patterns | ~50 |
| `backend/core/authentication.py` | Custom device auth | ~30 |

### Electron
| File | Purpose | Lines |
|------|---------|-------|
| `electron/main.js` | App lifecycle, window, IPC | ~490 |
| `electron/database.js` | SQLite layer (sql.js) | ~600 |
| `electron/emailService.js` | SMTP email service | ~400 |
| `electron/preload.js` | Context isolation bridge | ~80 |
| `electron/scheduler.js` | Cron job scheduler | ~300 |

### Infrastructure
| File | Purpose |
|------|---------|
| `docker-compose.yml` | PostgreSQL + Django + Nginx stack |
| `nginx/default.conf` | Reverse proxy + SPA routing |
| `netlify.toml` | Netlify deployment config |
| `capacitor.config.ts` | Mobile app config |
| `migration_script.sql` | Supabase schema setup |
| `setup_cron.sql` | Supabase cron for daily reports |

---

## 5. Unfinished Systems

### 5.1 Frontend ↔ Backend Integration Gap
The Django backend has fully implemented endpoints for:
- **Absence/Leave Management** — Full CRUD + multi-step approval workflow (manager → HR)
- **Shift Management** — CRUD + person-to-shift assignments
- **Payroll** — Profile management + salary calculations
- **Attendance Summary** — Calculations based on access events
- **SGK Report** — Turkish social security reporting

**None of these are connected to the frontend.** The frontend currently only uses Supabase and/or the Electron SQLite for security logs. The Django API is used only for log sync.

### 5.2 Mobile App (Capacitor/Android)
- Capacitor config exists, Android project scaffolded
- No mobile-specific UI adaptations
- No native feature integration (camera, NFC, etc.)
- Not tested or distributed

### 5.3 Audit System
- `AuditLog` model exists in backend
- `buildAuditHash()` and `verifyAuditChain()` exist in frontend
- Backend `_audit()` helper function exists
- **Not actively used in production flow** — audit entries are not systematically created

### 5.4 Device/Kiosk Mode
- `Device` and `DeviceSession` models exist
- `DeviceAuthView` endpoint exists
- `bootstrap_device` management command exists
- **No kiosk UI mode in frontend**

### 5.5 Person/Badge Management
- `Person` and `Badge` models exist in backend
- No frontend UI for managing persons or badges
- No badge scanning integration

---

## 6. Known Technical Debt

### 6.1 Monolithic App.jsx (Critical)
- **6,182 lines** in a single component
- All state, all views, all business logic in one file
- ~50 useState hooks, ~30 useCallback hooks, ~20 useMemo hooks
- Makes testing, code review, and feature development difficult
- **Recommendation:** Split into route-based page components + shared state (Context or Zustand)

### 6.2 Build Warnings (Low Priority)
```
- 'isMissingColumnError' defined but never used (csv-utils import)
- 'loginError' assigned but never used
- 'fetchLogsFromLocalApi' assigned but never used
- 'setSmtpRunNowLoading' assigned but never used
- 'writeLockRef' assigned but never used
- 'debouncedSearchTerm' assigned but never used
- 'removeAllAttachmentsForLog' assigned but never used
- 'handleLogin' assigned but never used
- 'handleLogout' assigned but never used
- React Hook useCallback missing dependency: 'filteredLogs'
- React Hook useCallback missing dependency: 'isElectronApp'
- React Hook useMemo unnecessary dependency: 'auditLogs'
```

### 6.3 Dual Style Systems
- CSS design tokens (`:root` vars + `ui-*` classes in `index.css`)
- JS design tokens (`src/lib/tokens.js`)
- Inline Tailwind classes throughout App.jsx
- `inputClass`/`labelClass` string constants (legacy)
- These overlap but are not fully unified

### 6.4 Hardcoded Data
- Staff list (100+ employees) hardcoded in `src/lib/data.js`
- Management vehicles hardcoded
- Host presets hardcoded
- **Should come from backend/database**

### 6.5 No Test Coverage
- `App.test.js` exists but contains only default CRA smoke test
- No unit tests for utilities, components, or business logic
- No integration tests for API endpoints
- Backend has no test files

### 6.6 Security Considerations
- Fallback passwords stored in plaintext in `constants.js`
- `ROLE_FALLBACK_PASSWORDS` are shipped in the frontend bundle
- Supabase credentials in `.env` (standard, but should be validated)

### 6.7 Legacy `location` Field
- Database has both `location` (legacy combined) and `entry_location`/`exit_location` (modern)
- `buildLegacyLocationValue()` maintains backward compatibility
- Should eventually migrate to entry/exit only

---

## 7. File Statistics

```
Frontend (src/)
├── App.jsx                    6,182 lines
├── lib/                         745 lines (6 files)
├── components/ui/               350 lines (14 files)
├── hooks/                        15 lines (1 file)
├── index.css                    419 lines
└── Other (clients, config)      ~50 lines

Backend (backend/)
├── core/models.py               480 lines
├── core/views.py                600 lines
├── core/serializers.py          150 lines
├── core/urls.py                  50 lines
├── core/migrations/             ~800 lines (8 files)
└── management/commands/         ~200 lines (4 files)

Electron (electron/)
├── main.js                      490 lines
├── database.js                  600 lines
├── emailService.js              400 lines
├── scheduler.js                 300 lines
├── preload.js                    80 lines
└── backupScheduler.js           ~100 lines

Total estimated: ~12,000+ lines of application code
```

---

## 8. Deployment Configurations

| Target | Config File | Status |
|--------|------------|--------|
| Web (Netlify) | `netlify.toml` | Configured |
| Web (Docker/Nginx) | `docker-compose.yml`, `nginx/default.conf` | Configured |
| Desktop (Electron) | `electron/main.js`, `package.json` | Working |
| Mobile (Android) | `capacitor.config.ts`, `android/` | Scaffold only |
| Backend (Docker) | `backend/Dockerfile`, `docker-compose.yml` | Configured |

---

## 9. Recommended Next Steps

### Short Term (Current Sprint)
1. **Complete Faz 2** — Migrate remaining 1 `labelClass` usage
2. **Clean up build warnings** — Remove unused variables/imports
3. **Unify style systems** — Choose CSS tokens OR JS tokens, not both

### Medium Term
4. **Faz 3: UX Improvements**
   - Form validation feedback (TC, phone, required fields)
   - Table sorting/pagination improvements
   - Loading skeletons for async operations
   - Animations/transitions for form states
5. **Split App.jsx** — Extract into page components:
   - `LoginPage`
   - `DashboardPage` (today's logs)
   - `EntryFormPage` (vehicle/visitor entry)
   - `ReportsPage` (filtered log table)
   - `SettingsPage` (sync, email, feature flags)
6. **Connect Django backend features** — Wire absence, shift, payroll UIs

### Long Term
7. **Add test coverage** — Unit tests for utils, component tests, API tests
8. **Move hardcoded data to backend** — Staff list, vehicles, host presets
9. **Remove legacy `location` field** — Full migration to entry/exit locations
10. **Mobile app development** — Camera for plate/ID scanning, NFC for badges
11. **Kiosk mode** — Dedicated UI for gate devices

---

## 10. Environment Setup

### Frontend Development
```bash
npm install
npm start                    # Development server (port 3000)
node ./node_modules/react-scripts/bin/react-scripts.js build  # Production build
```
> Note: `npm run build` and `npx` have PATH issues on Windows. Use the full node path.

### Backend Development
```bash
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_roles
python manage.py bootstrap_users
python manage.py runserver 0.0.0.0:8000
```

### Docker (Full Stack)
```bash
docker compose up --build
# API: http://localhost:8000
# Web: http://localhost:3001
```

### Electron Desktop
```bash
npm run electron:start       # Development
npm run electron:build       # Production build
```
