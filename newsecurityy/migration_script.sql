-- NewSecurityy Supabase ?ema ve Politikalar

-- 1) Tabloyu olu?tur (yoksa)
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
    seal_number TEXT,
    seal_number_entry TEXT,
    seal_number_exit TEXT,
    tc_no TEXT,
    phone TEXT,
    user_email TEXT
);

-- 2) Eksik kolonlar? ekle (varsa atla)
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
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS seal_number TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS seal_number_entry TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS seal_number_exit TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS tc_no TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.security_logs ADD COLUMN IF NOT EXISTS user_email TEXT;

-- 3) ?ndeksler
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON public.security_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_security_logs_plate ON public.security_logs(plate);
CREATE INDEX IF NOT EXISTS idx_security_logs_name ON public.security_logs(name);
CREATE INDEX IF NOT EXISTS idx_security_logs_exit_at ON public.security_logs(exit_at);

-- 4) RLS (Row Level Security) a?
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- 5) Politikalar? temizle (varsa)
DROP POLICY IF EXISTS "public_read" ON public.security_logs;
DROP POLICY IF EXISTS "public_insert" ON public.security_logs;
DROP POLICY IF EXISTS "public_update" ON public.security_logs;
DROP POLICY IF EXISTS "public_delete" ON public.security_logs;

-- 6) Politikalar
-- Not: 'public' anon eri?imi de kapsar. Daha g?venli isterseniz 'authenticated' kullan?n.
CREATE POLICY "public_read" ON public.security_logs
FOR SELECT TO public USING (true);

CREATE POLICY "public_insert" ON public.security_logs
FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "public_update" ON public.security_logs
FOR UPDATE TO public USING (true);

CREATE POLICY "public_delete" ON public.security_logs
FOR DELETE TO public USING (true);
