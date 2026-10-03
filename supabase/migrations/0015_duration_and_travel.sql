-- How long a to-do takes (minutes), and "remind me when it is time to leave" (travel time to the place). Safe to run more than once.
alter table public.memories add column if not exists duration_min integer;
alter table public.memories add column if not exists remind_travel boolean not null default false;

alter table public.memories drop constraint if exists memories_duration_valid;
alter table public.memories add constraint memories_duration_valid check (duration_min is null or (duration_min between 1 and 1440));

-- A repeating to-do keeps both.
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
  insert into public.memories (household_id, author_id, body, status, place_id, place_category, due_on, due_time, repeat_rule, assignee_id, notes, checklist, priority, remind_before, tags, duration_min, remind_travel)
  values (m.household_id, m.author_id, m.body, 'active', m.place_id, m.place_category, nd, m.due_time, m.repeat_rule, m.assignee_id, m.notes,
    (select coalesce(jsonb_agg(jsonb_set(e, '{done}', 'false'::jsonb)), '[]'::jsonb) from jsonb_array_elements(m.checklist) e), m.priority, m.remind_before, m.tags, m.duration_min, m.remind_travel)
  returning id into nid;
  return nid;
end;
$$;
grant execute on function public.complete_memory(uuid) to authenticated;

notify pgrst, 'reload schema';
