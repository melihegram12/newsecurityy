-- Security logs created_at integrity
-- Purpose: enforce created_at as immutable after insert and enable
--          upsert-on-conflict via a unique index.
--
-- Prerequisites: migration_script.sql already applied.
-- Run in Supabase SQL editor.
--
-- Idempotent: safe to re-run.

-- 1) Unique index required for upsert({ onConflict: 'created_at' }) in dbClient.js
CREATE UNIQUE INDEX IF NOT EXISTS security_logs_created_at_unique
    ON public.security_logs (created_at);

-- 2) Trigger function: block any UPDATE that changes created_at
CREATE OR REPLACE FUNCTION public.prevent_security_log_created_at_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'security_logs.created_at is immutable';
    END IF;
    RETURN NEW;
END;
$$;

-- 3) Attach trigger (drop first to keep idempotent)
DROP TRIGGER IF EXISTS trg_security_logs_created_at_immutable
    ON public.security_logs;

CREATE TRIGGER trg_security_logs_created_at_immutable
    BEFORE UPDATE ON public.security_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_security_log_created_at_update();
