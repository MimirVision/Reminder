-- Version 4: reading a roster (GAT) from a photo or PDF with AI. The models cost money, so each person gets a daily
-- number of reads; this keeps count. Additive only; safe to run again.

create table if not exists public.vakt_ai_usage (
  owner_id uuid not null,
  day date not null default current_date,
  fn text not null check (char_length(fn) <= 40),
  n integer not null default 0,
  primary key (owner_id, day, fn)
);
alter table public.vakt_ai_usage enable row level security;
revoke all on public.vakt_ai_usage from anon, authenticated;

-- Takes one read from today's allowance; false when it is used up. Runs as the owner of the table, for the caller only.
create or replace function public.vakt_ai_take(p_fn text, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare used integer;
begin
  if auth.uid() is null then return false; end if;
  insert into public.vakt_ai_usage (owner_id, day, fn, n) values (auth.uid(), current_date, p_fn, 0)
    on conflict (owner_id, day, fn) do nothing;
  update public.vakt_ai_usage set n = n + 1
    where owner_id = auth.uid() and day = current_date and fn = p_fn and n < p_limit
    returning n into used;
  return used is not null;
end $$;
revoke all on function public.vakt_ai_take(text, integer) from public, anon;
grant execute on function public.vakt_ai_take(text, integer) to authenticated;

notify pgrst, 'reload schema';
