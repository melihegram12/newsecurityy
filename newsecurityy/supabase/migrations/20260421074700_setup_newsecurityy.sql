-- NewSecurityy Supabase setup for a fresh project.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.security_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    exit_at TIMESTAMPTZ,
    event_type TEXT,
    type TEXT,
    sub_category TEXT,
    shift TEXT,
    plate TEXT,
    driver TEXT,
    name TEXT,
    host TEXT,
    note TEXT,
    location TEXT,
    entry_location TEXT,
    exit_location TEXT,
    seal_number TEXT,
    seal_number_entry TEXT,
    seal_number_exit TEXT,
    tc_no TEXT,
    phone TEXT,
    user_email TEXT
);

ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS exit_at TIMESTAMPTZ;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS sub_category TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS shift TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS plate TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS driver TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS entry_location TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS exit_location TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS seal_number TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS seal_number_entry TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS seal_number_exit TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS tc_no TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS user_email TEXT;

CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON public.security_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_security_logs_plate ON public.security_logs(plate);
CREATE INDEX IF NOT EXISTS idx_security_logs_name ON public.security_logs(name);
CREATE INDEX IF NOT EXISTS idx_security_logs_exit_at ON public.security_logs(exit_at);

-- Required by app upserts that use onConflict: 'created_at'.
CREATE UNIQUE INDEX IF NOT EXISTS security_logs_created_at_unique
    ON public.security_logs (created_at);

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

DROP TRIGGER IF EXISTS trg_security_logs_created_at_immutable
    ON public.security_logs;

CREATE TRIGGER trg_security_logs_created_at_immutable
    BEFORE UPDATE ON public.security_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_security_log_created_at_update();

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read" ON public.security_logs;
DROP POLICY IF EXISTS "public_insert" ON public.security_logs;
DROP POLICY IF EXISTS "public_update" ON public.security_logs;
DROP POLICY IF EXISTS "public_delete" ON public.security_logs;
DROP POLICY IF EXISTS "client_read" ON public.security_logs;
DROP POLICY IF EXISTS "client_insert" ON public.security_logs;

CREATE POLICY "client_read" ON public.security_logs
FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "client_insert" ON public.security_logs
FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON public.security_logs TO anon, authenticated;
REVOKE UPDATE, DELETE ON public.security_logs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_logs TO service_role;
