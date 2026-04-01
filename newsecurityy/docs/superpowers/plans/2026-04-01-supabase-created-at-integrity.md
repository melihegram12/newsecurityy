# Security Logs `created_at` Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the production data-integrity risk caused by Supabase allowing duplicate or null `created_at` values while the application treats `created_at` as the effective sync key.

**Architecture:** Keep the existing application contract intact and repair the database to match it. The rollout uses a Supabase-side quarantine-and-deduplicate migration, then adds `NOT NULL` + a unique index on `security_logs.created_at`, and only after that aligns bootstrap/health scripts.

**Tech Stack:** Supabase Postgres SQL, Django model contract, Electron/React sync clients, operational SQL validation.

---

### Task 1: Audit Current Supabase State

**Files:**
- Create: `supabase/2026-04-01-security-logs-created-at-integrity.sql`
- Modify: `docs/superpowers/plans/2026-04-01-supabase-created-at-integrity.md`
- Verify: `migration_script.sql`

- [ ] **Step 1: Run the duplicate/null discovery queries**

```sql
SELECT created_at, COUNT(*) AS row_count, ARRAY_AGG(id ORDER BY id) AS ids
FROM public.security_logs
GROUP BY created_at
HAVING COUNT(*) > 1
ORDER BY row_count DESC, created_at;

SELECT id, plate, name, exit_at
FROM public.security_logs
WHERE created_at IS NULL
ORDER BY id;
```

- [ ] **Step 2: Save the result counts before mutating data**

Run in Supabase SQL editor and capture:

```text
- duplicate created_at group count
- duplicate row count
- null created_at row count
```

- [ ] **Step 3: Confirm the application contract before migration**

Check these files and verify they still target `created_at`:

```text
src/dbClient.js
src/App.jsx
backend/core/models.py
backend/core/views.py
scripts/import-security-excel-to-supabase.js
scripts/import-supabase-to-local.js
scripts/sync_local_to_supabase.py
migration_script.sql
```

- [ ] **Step 4: Commit the migration scaffold**

```bash
git add docs/superpowers/plans/2026-04-01-supabase-created-at-integrity.md supabase/2026-04-01-security-logs-created-at-integrity.sql
git commit -m "docs: add supabase created_at integrity rollout plan"
```

### Task 2: Repair Existing Supabase Data Safely

**Files:**
- Execute: `supabase/2026-04-01-security-logs-created-at-integrity.sql`
- Verify: `scripts/health_check.py`

- [ ] **Step 1: Pause writes during the migration window**

```text
Disable app writes or schedule a short maintenance window before running the SQL.
Do not create the unique index while the app is still writing to security_logs.
```

- [ ] **Step 2: Run the migration SQL**

Run:

```sql
\i supabase/2026-04-01-security-logs-created-at-integrity.sql
```

Expected result:

```text
- affected duplicate/null rows copied to a dated backup table
- exact duplicate rows removed
- conflicting duplicate rows shifted by +1 ms steps until unique
- created_at set to NOT NULL
- unique index created successfully
```

- [ ] **Step 3: Verify the live table is clean**

```sql
SELECT COUNT(*) AS duplicate_group_count
FROM (
  SELECT created_at
  FROM public.security_logs
  GROUP BY created_at
  HAVING COUNT(*) > 1
) dup;

SELECT COUNT(*) AS null_created_at_count
FROM public.security_logs
WHERE created_at IS NULL;
```

Expected:

```text
duplicate_group_count = 0
null_created_at_count = 0
```

- [ ] **Step 4: Smoke-check write paths after the DB change**

Run:

```bash
npm test -- --watchAll=false
npm run feature:smoke
cd backend && python manage.py test core.tests
```

Expected:

```text
All existing tests stay green because the code already assumes unique created_at.
```

- [ ] **Step 5: Commit the operational migration artifacts**

```bash
git add supabase/2026-04-01-security-logs-created-at-integrity.sql
git commit -m "ops: add supabase created_at integrity migration"
```

### Task 3: Align Bootstrap and Observability

**Files:**
- Modify: `migration_script.sql`
- Modify: `scripts/health_check.py`
- Optional: `src/App.jsx`

- [ ] **Step 1: Make fresh Supabase bootstrap match production reality**

Update `migration_script.sql` so new environments create:

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

and then:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_logs_created_at_unique
ON public.security_logs(created_at);
```

- [ ] **Step 2: Turn duplicate detection into a hard failure signal**

Extend `scripts/health_check.py` so this section fails deployment/maintenance checks when duplicates are found:

```python
if dup_count:
    fail("created_at duplicates", str(dup_count))
else:
    ok("created_at duplicates", "none")
```

- [ ] **Step 3: Optionally surface the backup table count in admin diagnostics**

Low-risk follow-up:

```text
Expose the count of rows in public.security_logs_created_at_backup_20260401
through a maintenance checklist or admin-only diagnostics screen.
```

- [ ] **Step 4: Commit bootstrap/observability alignment**

```bash
git add migration_script.sql scripts/health_check.py
git commit -m "chore: enforce created_at integrity in bootstrap and health checks"
```

### Task 4: Defer Larger Key Refactors

**Files:**
- Optional future design: `src/dbClient.js`
- Optional future design: `src/App.jsx`
- Optional future design: `backend/core/models.py`
- Optional future design: `backend/core/views.py`

- [ ] **Step 1: Explicitly defer `record_uid` migration**

```text
Do not introduce record_uid in this rollout.
The current codebase is deeply coupled to created_at as the sync key.
Changing the key now is a larger cross-layer refactor, not a hot data-integrity repair.
```

- [ ] **Step 2: Revisit only after Supabase is clean and protected**

Entry criteria:

```text
- duplicate_group_count = 0 for at least one full sprint
- created_at unique index present in every environment
- health check blocks regressions
```
