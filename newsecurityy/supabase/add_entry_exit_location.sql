alter table if exists public.security_logs
  add column if not exists entry_location text;

alter table if exists public.security_logs
  add column if not exists exit_location text;

update public.security_logs
set
  entry_location = case
    when coalesce(entry_location, '') = '' and exit_at is null then coalesce(location, '')
    else entry_location
  end,
  exit_location = case
    when coalesce(exit_location, '') = '' and exit_at is not null then coalesce(location, '')
    else exit_location
  end;
