-- Repeating to-dos, who ticked something off, web push subscriptions, and a weekly "done" count in the reminder feed.
-- Written to be safe to run more than once.

alter table public.memories add column if not exists repeat_rule text;
alter table public.memories drop constraint if exists memories_repeat_rule_valid;
alter table public.memories add constraint memories_repeat_rule_valid
  check (repeat_rule is null or (repeat_rule in ('daily', 'weekly', 'monthly', 'yearly') and due_on is not null));
alter table public.memories add column if not exists done_by uuid references auth.users (id) on delete set null;

-- Ticks a to-do off. A repeating one also creates the next occurrence (the following date that is still in the future),
-- and returns that new to-do's id so the caller can undo. Runs as the definer but only for household members.
create or replace function public.complete_memory(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.memories; nd date; nid uuid;
begin
  select * into m from public.memories where id = p_id;
  if not found or not public.is_member(m.household_id) then return null; end if;
  if m.status = 'done' then return null; end if;
  update public.memories set status = 'done', done_at = now(), done_by = auth.uid() where id = p_id;
  if m.repeat_rule is null or m.due_on is null then return null; end if;
  nd := m.due_on;
  loop
    nd := case m.repeat_rule
      when 'daily' then nd + 1
      when 'weekly' then nd + 7
      when 'monthly' then (nd + interval '1 month')::date
      else (nd + interval '1 year')::date end;
    exit when nd > current_date;
  end loop;
  insert into public.memories (household_id, author_id, body, status, place_id, place_category, due_on, due_time, repeat_rule)
  values (m.household_id, m.author_id, m.body, 'active', m.place_id, m.place_category, nd, m.due_time, m.repeat_rule)
  returning id into nid;
  return nid;
end;
$$;
grant execute on function public.complete_memory(uuid) to authenticated;

-- Web push: one row per browser/phone that wants to be told when the partner adds something.
create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  lang text not null default 'en' check (lang in ('en', 'nb')),
  created_at timestamptz not null default now()
);
alter table public.web_push_subscriptions enable row level security;
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;
drop policy if exists web_push_own on public.web_push_subscriptions;
create policy web_push_own on public.web_push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A device that signs in as someone else takes its subscription over (the endpoint is unique per device).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_lang text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, lang)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, case when p_lang = 'nb' then 'nb' else 'en' end)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang;
end;
$$;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- The feed now carries repeat rules and how many to-dos were finished in the last 7 days.
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
    'done_week', (select count(*) from public.memories d where d.household_id = fk.household_id and d.status = 'done' and d.done_at > now() - interval '7 days'),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category, 'radius_m', p.radius_m, 'address', p.address) order by p.created_at)
      from public.places p where p.household_id = fk.household_id), '[]'::jsonb),
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'body', left(m.body, 300), 'place_id', m.place_id, 'created_at', m.created_at,
                                          'due_on', m.due_on, 'due_time', m.due_time, 'repeat_rule', m.repeat_rule) order by m.created_at desc)
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
