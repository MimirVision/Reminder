-- Findings from a condition report (tilstandsrapport): kept apart from the to-do list, shown in House > Report.
-- Each has a grade (TG3, TG2), or is a health-and-safety or legality note, what was found, what is recommended, and its own status.
-- Safe to run more than once.
create table if not exists public.condition_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  source text not null default '',
  source_key text not null,
  area text not null default 'other',
  part text not null,
  tg text not null check (tg in ('TG3', 'TG2', 'HMS', 'LOV')),
  when_kind text not null default 'plan' check (when_kind in ('now', 'plan', 'watch')),
  what text not null default '',
  action text not null default '',
  cost_min integer check (cost_min is null or cost_min >= 0),
  cost_max integer check (cost_max is null or cost_max >= 0),
  page integer,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  notes text,
  memory_id uuid references public.memories (id) on delete set null,
  done_at timestamptz,
  done_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, source_key)
);
create index if not exists condition_items_household_idx on public.condition_items (household_id, status, tg);
drop trigger if exists condition_items_touch on public.condition_items;
create trigger condition_items_touch before update on public.condition_items
  for each row execute function public.touch_updated_at();

alter table public.condition_items enable row level security;
drop policy if exists condition_items_select on public.condition_items;
create policy condition_items_select on public.condition_items for select using (public.is_member(household_id));
drop policy if exists condition_items_insert on public.condition_items;
create policy condition_items_insert on public.condition_items for insert with check (public.is_member(household_id));
drop policy if exists condition_items_update on public.condition_items;
create policy condition_items_update on public.condition_items for update
  using (public.is_member(household_id)) with check (public.is_member(household_id));
drop policy if exists condition_items_delete on public.condition_items;
create policy condition_items_delete on public.condition_items for delete using (public.is_member(household_id));
grant select, insert, update, delete on public.condition_items to authenticated;

notify pgrst, 'reload schema';
