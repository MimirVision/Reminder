-- Version 3: when pay lands in the account (pay day, and supplements paid the month after), sick shifts, days off,
-- pay slips to check the numbers against, and reminders on the phone (Web Push). Additive only; safe to run again.

-- Pay day and what is paid a month late. Most health-care employers pay the hourly wage for the month worked and
-- supplements and overtime the month after ('supplements'); some pay everything the month after ('all').
alter table public.vakt_employers add column if not exists pay_day integer not null default 12;
alter table public.vakt_employers add column if not exists pay_delay text not null default 'supplements';
alter table public.vakt_employers drop constraint if exists vakt_employers_pay_day;
alter table public.vakt_employers add constraint vakt_employers_pay_day check (pay_day between 1 and 31);
alter table public.vakt_employers drop constraint if exists vakt_employers_pay_delay;
alter table public.vakt_employers add constraint vakt_employers_pay_delay check (pay_delay in ('none', 'supplements', 'all'));

-- A shift she was sick for is still listed, paid at the sick-pay share from Oppsett.
alter table public.vakt_shifts add column if not exists status text not null default 'worked';
alter table public.vakt_shifts drop constraint if exists vakt_shifts_status;
alter table public.vakt_shifts add constraint vakt_shifts_status check (status in ('worked', 'sick'));

-- Days off: holiday, a day off, time off in lieu. They pay nothing; they show in the calendar.
create table if not exists public.vakt_days_off (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  date date not null check (date between '2000-01-01' and '2100-12-31'),
  kind text not null check (kind in ('ferie', 'fri', 'avspasering')),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (owner_id, date)
);

-- What the pay slip said for a month, to compare with what Vakt worked out for that pay day.
create table if not exists public.vakt_payslips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  gross numeric(12, 2) not null check (gross >= 0 and gross < 10000000),
  net numeric(12, 2) check (net is null or (net >= 0 and net < 10000000)),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, month)
);
drop trigger if exists vakt_payslips_touch on public.vakt_payslips;
create trigger vakt_payslips_touch before update on public.vakt_payslips for each row execute function public.vakt_touch();

-- A browser's Web Push subscription. The keys only let a sender encrypt to that browser; they are not a login.
create table if not exists public.vakt_push_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (owner_id, endpoint)
);

do $$
declare t text;
begin
  foreach t in array array['vakt_days_off', 'vakt_payslips', 'vakt_push_devices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_own', t);
  end loop;
end $$;

-- What the vakt-notify function has already sent, so repeated runs never notify twice, and when it last ran.
-- Server only: row level security with no policies, so only the function (service role) reads or writes them.
create table if not exists public.vakt_push_sent (
  owner_id uuid not null,
  key text not null check (char_length(key) <= 200),
  sent_at timestamptz not null default now(),
  primary key (owner_id, key)
);
alter table public.vakt_push_sent enable row level security;
revoke all on public.vakt_push_sent from anon, authenticated;

create table if not exists public.vakt_notify_status (
  id boolean primary key default true check (id),
  last_run timestamptz
);
alter table public.vakt_notify_status enable row level security;
revoke all on public.vakt_notify_status from anon, authenticated;

notify pgrst, 'reload schema';
