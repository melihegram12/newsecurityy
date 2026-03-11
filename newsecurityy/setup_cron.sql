-- 1. Gerekli Eklentileri Aktif Et
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Cron Job'u Temizle (Eğer varsa eskini sil, çakışma olmasın)
select cron.unschedule('daily-security-report');

-- 3. Yeni Cron Job Oluştur
-- Zamanlama: Her sabah UTC 06:00 (Türkiye saati ile 09:00)
-- Bu komut çalıştığında, Edge Function tetiklenecek ve varsayılan olarak "bir önceki günün" raporunu alacak.
select
  cron.schedule(
    'daily-security-report',
    '0 6 * * *',
    $$
    select
      net.http_post(
          url:='https://muqryghjhzhbjkvxwrgp.supabase.co/functions/v1/send-daily-report',
          headers:='{"Content-Type": "application/json"}'::jsonb
      ) as request_id;
    $$
  );

-- 4. Kurulumu Kontrol Et
select * from cron.job;
