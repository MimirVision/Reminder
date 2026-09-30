-- To-dos can have a date and an optional time; places can have an address; shared to-dos update live;
-- and the reminder feed carries the new fields. Written to be safe to run more than once.

alter table public.memories add column if not exists due_on date;
alter table public.memories add column if not exists due_time time;
alter table public.memories drop constraint if exists memories_due_time_needs_date;
alter table public.memories add constraint memories_due_time_needs_date check (due_time is null or due_on is not null);
create index if not exists memories_due_idx on public.memories (household_id, due_on)
  where due_on is not null and status in ('inbox', 'active');

alter table public.places add column if not exists address text;

-- Same narrow feed as before, now with due dates/times on to-dos and the address of places.
create or replace function public.reminder_feed(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fk public.feed_keys; result jsonb;
begin
  select * into fk from public.feed_keys where key_hash = sha256(convert_to(coalesce(p_key, ''), 'utf8'));
  if not found then return null; end if;
  update public.feed_keys set last_used_at = now() where id = fk.id;

  select jsonb_build_object(
    'household', (select h.name from public.households h where h.id = fk.household_id),
    'generated_at', now(),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category, 'radius_m', p.radius_m, 'address', p.address) order by p.created_at)
      from public.places p where p.household_id = fk.household_id), '[]'::jsonb),
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'body', left(m.body, 300), 'place_id', m.place_id, 'created_at', m.created_at,
                                          'due_on', m.due_on, 'due_time', m.due_time) order by m.created_at desc)
      from (select * from public.memories where household_id = fk.household_id and status in ('inbox', 'active')
            order by created_at desc limit 300) m), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'template_key', t.template_key, 'title', t.title, 'notes', t.notes, 'schedule', t.schedule, 'interval_months', t.interval_months,
        'window_start_month', t.window_start_month, 'window_end_month', t.window_end_month,
        'next_due_at', t.next_due_at, 'due_until', t.due_until, 'last_done_at', t.last_done_at) order by t.next_due_at)
      from public.maintenance_tasks t where t.household_id = fk.household_id and t.active), '[]'::jsonb),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object('title', f.title, 'value', f.value, 'surface_at', f.surface_at))
      from public.house_facts f where f.household_id = fk.household_id and cardinality(f.surface_at) > 0), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
grant execute on function public.reminder_feed(text) to anon, authenticated;
