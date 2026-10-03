-- To-do details: notes, a checklist, priority and "remind me before", plus two more ways to repeat (weekdays, every other week).
-- Written to be safe to run more than once.

alter table public.memories add column if not exists notes text;
alter table public.memories add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.memories add column if not exists priority smallint not null default 0;
alter table public.memories add column if not exists remind_before integer;

alter table public.memories drop constraint if exists memories_priority_valid;
alter table public.memories add constraint memories_priority_valid check (priority between 0 and 3);
alter table public.memories drop constraint if exists memories_remind_before_valid;
alter table public.memories add constraint memories_remind_before_valid check (remind_before is null or (remind_before between 0 and 20160));
alter table public.memories drop constraint if exists memories_checklist_valid;
alter table public.memories add constraint memories_checklist_valid check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 100);

alter table public.memories drop constraint if exists memories_repeat_rule_valid;
alter table public.memories add constraint memories_repeat_rule_valid
  check (repeat_rule is null or (repeat_rule in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly') and due_on is not null));

-- Ticking off a repeating to-do creates the next one. It now keeps notes, priority and reminder, and its checklist starts unticked.
create or replace function public.complete_memory(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.memories; nd date; nid uuid;
begin
  select * into m from public.memories where id = p_id;
  if not found or not public.is_member(m.household_id) then return null; end if;
  if m.status = 'done' then return null; end if;
  update public.memories set status = 'done', done_at = now(), done_by = auth.uid(), pinned = false where id = p_id;
  if m.repeat_rule is null or m.due_on is null then return null; end if;
  nd := m.due_on;
  loop
    nd := case m.repeat_rule
      when 'daily' then nd + 1
      when 'weekdays' then nd + case extract(dow from nd)::int when 5 then 3 when 6 then 2 else 1 end
      when 'weekly' then nd + 7
      when 'biweekly' then nd + 14
      when 'monthly' then (nd + interval '1 month')::date
      else (nd + interval '1 year')::date end;
    exit when nd > current_date;
  end loop;
  insert into public.memories (household_id, author_id, body, status, place_id, place_category, due_on, due_time, repeat_rule, assignee_id, notes, checklist, priority, remind_before)
  values (m.household_id, m.author_id, m.body, 'active', m.place_id, m.place_category, nd, m.due_time, m.repeat_rule, m.assignee_id, m.notes,
    (select coalesce(jsonb_agg(jsonb_set(e, '{done}', 'false'::jsonb)), '[]'::jsonb) from jsonb_array_elements(m.checklist) e), m.priority, m.remind_before)
  returning id into nid;
  return nid;
end;
$$;
grant execute on function public.complete_memory(uuid) to authenticated;

notify pgrst, 'reload schema';
