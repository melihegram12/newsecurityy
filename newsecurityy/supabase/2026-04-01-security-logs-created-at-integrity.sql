-- Security logs created_at integrity migration
-- Purpose:
--   1. Back up rows that already violate the current application contract
--   2. Remove exact duplicates
--   3. Preserve conflicting duplicates by shifting non-keeper rows by +1 ms until unique
--   4. Quarantine rows with NULL created_at instead of inventing timestamps
--   5. Enforce NOT NULL + unique index on public.security_logs.created_at
--
-- Operational note:
--   Run this during a short maintenance window or with writes paused.
--   The application already treats created_at as the effective sync key.

-- 0) Discovery queries
SELECT created_at, COUNT(*) AS row_count, ARRAY_AGG(id ORDER BY id) AS ids
FROM public.security_logs
GROUP BY created_at
HAVING COUNT(*) > 1
ORDER BY row_count DESC, created_at;

SELECT id, plate, name, exit_at
FROM public.security_logs
WHERE created_at IS NULL
ORDER BY id;

-- 1) Create a dated backup table for all rows touched by this migration.
CREATE TABLE IF NOT EXISTS public.security_logs_created_at_backup_20260401 AS
SELECT
  sl.*,
  now()::timestamptz AS backed_up_at,
  'created_at_integrity_migration'::text AS backup_reason,
  sl.created_at AS original_created_at
FROM public.security_logs sl
WHERE false;

CREATE INDEX IF NOT EXISTS idx_security_logs_created_at_backup_20260401_id
  ON public.security_logs_created_at_backup_20260401 (id);

CREATE INDEX IF NOT EXISTS idx_security_logs_created_at_backup_20260401_original_created_at
  ON public.security_logs_created_at_backup_20260401 (original_created_at);

BEGIN;

LOCK TABLE public.security_logs IN SHARE ROW EXCLUSIVE MODE;

-- 2) Back up all rows that either have NULL created_at or belong to a duplicate group.
WITH duplicate_keys AS (
  SELECT created_at
  FROM public.security_logs
  WHERE created_at IS NOT NULL
  GROUP BY created_at
  HAVING COUNT(*) > 1
),
rows_to_backup AS (
  SELECT sl.*
  FROM public.security_logs sl
  JOIN duplicate_keys dk
    ON dk.created_at = sl.created_at
  UNION ALL
  SELECT sl.*
  FROM public.security_logs sl
  WHERE sl.created_at IS NULL
)
INSERT INTO public.security_logs_created_at_backup_20260401
SELECT
  rtb.*,
  now()::timestamptz AS backed_up_at,
  CASE
    WHEN rtb.created_at IS NULL THEN 'null_created_at'
    ELSE 'duplicate_created_at'
  END AS backup_reason,
  rtb.created_at AS original_created_at
FROM rows_to_backup rtb
WHERE NOT EXISTS (
  SELECT 1
  FROM public.security_logs_created_at_backup_20260401 b
  WHERE b.id = rtb.id
    AND b.original_created_at IS NOT DISTINCT FROM rtb.created_at
);

-- 3) Drop exact duplicates first. Keep the lexicographically smallest id for identical payloads.
WITH ranked_exact_duplicates AS (
  SELECT
    sl.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        sl.created_at,
        COALESCE(sl.exit_at::text, ''),
        COALESCE(sl.event_type, ''),
        COALESCE(sl.type, ''),
        COALESCE(sl.sub_category, ''),
        COALESCE(sl.shift, ''),
        COALESCE(sl.plate, ''),
        COALESCE(sl.driver, ''),
        COALESCE(sl.name, ''),
        COALESCE(sl.host, ''),
        COALESCE(sl.note, ''),
        COALESCE(sl.location, ''),
        COALESCE(sl.seal_number, ''),
        COALESCE(sl.seal_number_entry, ''),
        COALESCE(sl.seal_number_exit, ''),
        COALESCE(sl.tc_no, ''),
        COALESCE(sl.phone, ''),
        COALESCE(sl.user_email, '')
      ORDER BY sl.id
    ) AS exact_rn
  FROM public.security_logs sl
  WHERE sl.created_at IS NOT NULL
    AND sl.created_at IN (
      SELECT created_at
      FROM public.security_logs
      WHERE created_at IS NOT NULL
      GROUP BY created_at
      HAVING COUNT(*) > 1
    )
)
DELETE FROM public.security_logs sl
USING ranked_exact_duplicates red
WHERE sl.id = red.id
  AND red.exact_rn > 1;

-- 4) Preserve conflicting duplicates by shifting non-keeper rows by +1 ms until free.
DO $$
DECLARE
  rec RECORD;
  candidate_created_at timestamptz;
BEGIN
  FOR rec IN
    WITH duplicate_keys AS (
      SELECT created_at
      FROM public.security_logs
      WHERE created_at IS NOT NULL
      GROUP BY created_at
      HAVING COUNT(*) > 1
    ),
    ranked_conflicts AS (
      SELECT
        sl.id,
        sl.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY sl.created_at
          ORDER BY
            CASE WHEN sl.exit_at IS NOT NULL THEN 0 ELSE 1 END,
            (
              CASE WHEN NULLIF(BTRIM(COALESCE(sl.plate, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
              CASE WHEN NULLIF(BTRIM(COALESCE(sl.name, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
              CASE WHEN NULLIF(BTRIM(COALESCE(sl.driver, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
              CASE WHEN NULLIF(BTRIM(COALESCE(sl.host, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
              CASE WHEN NULLIF(BTRIM(COALESCE(sl.note, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
              CASE WHEN sl.exit_at IS NOT NULL THEN 1 ELSE 0 END
            ) DESC,
            sl.id
        ) AS conflict_rn
      FROM public.security_logs sl
      JOIN duplicate_keys dk
        ON dk.created_at = sl.created_at
    )
    SELECT id, created_at
    FROM ranked_conflicts
    WHERE conflict_rn > 1
    ORDER BY created_at, conflict_rn, id
  LOOP
    candidate_created_at := rec.created_at;

    LOOP
      candidate_created_at := candidate_created_at + INTERVAL '1 millisecond';
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.security_logs sl
        WHERE sl.created_at = candidate_created_at
      );
    END LOOP;

    UPDATE public.security_logs
    SET created_at = candidate_created_at
    WHERE id = rec.id;
  END LOOP;
END $$;

-- 5) Quarantine NULL created_at rows out of the operational table.
DELETE FROM public.security_logs
WHERE created_at IS NULL;

COMMIT;

-- 6) Enforce the invariant expected by the codebase.
ALTER TABLE public.security_logs
  ALTER COLUMN created_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_logs_created_at_unique
  ON public.security_logs (created_at);

-- 7) Post-migration verification.
SELECT COUNT(*) AS null_created_at_count
FROM public.security_logs
WHERE created_at IS NULL;

SELECT COUNT(*) AS duplicate_group_count
FROM (
  SELECT created_at
  FROM public.security_logs
  GROUP BY created_at
  HAVING COUNT(*) > 1
) dup;

SELECT
  COUNT(*) FILTER (WHERE backup_reason = 'duplicate_created_at') AS duplicate_rows_backed_up,
  COUNT(*) FILTER (WHERE backup_reason = 'null_created_at') AS null_rows_backed_up
FROM public.security_logs_created_at_backup_20260401;

-- 8) Rollback guide (run only if you need to revert immediately after this migration).
-- BEGIN;
-- DROP INDEX IF EXISTS idx_security_logs_created_at_unique;
--
-- DELETE FROM public.security_logs sl
-- USING public.security_logs_created_at_backup_20260401 b
-- WHERE sl.id = b.id;
--
-- INSERT INTO public.security_logs (
--   id, created_at, exit_at, event_type, type, sub_category, shift, plate, driver, name,
--   host, note, location, seal_number, seal_number_entry, seal_number_exit, tc_no, phone, user_email
-- )
-- SELECT
--   id, original_created_at, exit_at, event_type, type, sub_category, shift, plate, driver, name,
--   host, note, location, seal_number, seal_number_entry, seal_number_exit, tc_no, phone, user_email
-- FROM public.security_logs_created_at_backup_20260401;
-- COMMIT;