-- Read-only "reminder keys". A key opens links on the web app's own domain (/api/remind and /calendar.ics) that
-- iPhone Shortcuts automations and the Calendar app call, so reminders work without a native app.
-- The key is a secret in the link: only its sha256 hash is stored, it can be revoked, and it only ever READS
-- to-dos, house tasks and facts that were tagged for a shop. It cannot change anything.

create table public.feed_keys (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  label text not null default 'iPhone',
  key_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index feed_keys_user_idx on public.feed_keys (user_id);

alter table public.feed_keys enable row level security;
create policy feed_keys_select on public.feed_keys for select using (user_id = auth.uid());
create policy feed_keys_delete on public.feed_keys for delete using (user_id = auth.uid());
grant select, delete on public.feed_keys to authenticated;

-- Returns the plaintext key exactly once.
create function public.create_feed_key(p_household_id uuid, p_label text default 'iPhone')
returns text language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_household_id) then raise exception 'not a member'; end if;
  k := 'hmr_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.feed_keys (household_id, user_id, label, key_hash)
    values (p_household_id, auth.uid(), coalesce(nullif(trim(p_label), ''), 'iPhone'), sha256(convert_to(k, 'utf8')));
  return k;
end;
$$;
grant execute on function public.create_feed_key(uuid, text) to authenticated;

-- What the reminder links show. Callable without login (anon): the key is the credential. Unknown or revoked key: NULL.
-- Deliberately narrow: no authors, no photos, and only facts that were tagged for a shop (the emergency card stays private).
create function public.reminder_feed(p_key text) returns jsonb
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
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category, 'radius_m', p.radius_m) order by p.created_at)
      from public.places p where p.household_id = fk.household_id), '[]'::jsonb),
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'body', left(m.body, 300), 'place_id', m.place_id, 'created_at', m.created_at) order by m.created_at desc)
      from (select * from public.memories where household_id = fk.household_id and status in ('inbox', 'active')
            order by created_at desc limit 300) m), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'notes', t.notes, 'schedule', t.schedule, 'interval_months', t.interval_months,
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
