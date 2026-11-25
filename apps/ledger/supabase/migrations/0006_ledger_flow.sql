-- Ledger v6: steps and time. A task can come after another one (a chain: lønnsgrunnlag → lønnskjøring → A-melding),
-- and can have a block of time planned for it in the calendar. Additive only. Safe to run more than once.

-- The step a task waits for. Deleting that step just unlinks it.
alter table public.ledger_occurrences add column if not exists after_id uuid references public.ledger_occurrences (id) on delete set null;
create index if not exists ledger_occurrences_after on public.ledger_occurrences (after_id) where after_id is not null;

-- Time set aside for the task: a day and a time of day (wall-clock time in the workspace's time zone). All or none.
alter table public.ledger_occurrences add column if not exists planned_on date;
alter table public.ledger_occurrences add column if not exists planned_start time;
alter table public.ledger_occurrences add column if not exists planned_end time;
alter table public.ledger_occurrences drop constraint if exists ledger_occurrences_planned;
alter table public.ledger_occurrences add constraint ledger_occurrences_planned check (
  (planned_on is null and planned_start is null and planned_end is null)
  or (planned_on is not null and planned_start is not null and planned_end is not null and planned_end > planned_start
      and planned_on between '2000-01-01' and '2100-12-31'));

-- A step must be in the same workspace, can't be the task itself, and a chain can't loop back on itself.
create or replace function public.ledger_occurrence_after_guard() returns trigger language plpgsql set search_path = public as $$
declare cur uuid; n int := 0;
begin
  if new.after_id is null then return new; end if;
  if new.after_id = new.id then raise exception 'ledger: a task cannot come after itself'; end if;
  if not exists (select 1 from public.ledger_occurrences o where o.id = new.after_id and o.workspace_id = new.workspace_id) then
    raise exception 'ledger: the step it comes after is not in this workspace';
  end if;
  cur := new.after_id;
  while cur is not null and n < 200 loop
    select o.after_id into cur from public.ledger_occurrences o where o.id = cur;
    if cur = new.id then raise exception 'ledger: those steps would wait for each other'; end if;
    n := n + 1;
  end loop;
  return new;
end $$;
drop trigger if exists ledger_occurrences_after_guard on public.ledger_occurrences;
create trigger ledger_occurrences_after_guard before insert or update of after_id on public.ledger_occurrences
  for each row execute function public.ledger_occurrence_after_guard();

create or replace function public.ledger_schema_version() returns integer language sql immutable as $$ select 6 $$;
grant execute on function public.ledger_schema_version() to authenticated;

notify pgrst, 'reload schema';
