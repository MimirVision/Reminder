-- Daily limits for the AI features (they cost money per use), and a way to delete your own account.
-- Written to be safe to run more than once.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  fn text not null,
  n integer not null default 0,
  primary key (user_id, day, fn)
);
alter table public.ai_usage enable row level security;

-- Counts one use of an AI function for the signed-in user today. Returns false when the daily limit is already reached
-- (the edge function then refuses before it calls the model).
create or replace function public.ai_take(p_fn text, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare used integer;
begin
  if auth.uid() is null then return false; end if;
  insert into public.ai_usage (user_id, day, fn, n) values (auth.uid(), current_date, p_fn, 0)
  on conflict (user_id, day, fn) do nothing;
  update public.ai_usage set n = n + 1
  where user_id = auth.uid() and day = current_date and fn = p_fn and n < p_limit
  returning n into used;
  return used is not null;
end;
$$;
grant execute on function public.ai_take(text, integer) to authenticated;

-- Deletes the signed-in user. Households where they are the only member are deleted with everything in them; in shared
-- households their to-dos stay (handed to another member) and only their membership goes.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); h record; other uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  for h in select household_id from public.household_members where user_id = me loop
    select user_id into other from public.household_members where household_id = h.household_id and user_id <> me order by joined_at nulls last, user_id limit 1;
    if other is null then
      delete from public.households where id = h.household_id;
    else
      update public.memories set author_id = other where household_id = h.household_id and author_id = me;
      delete from public.household_members where household_id = h.household_id and user_id = me;
    end if;
  end loop;
  -- Rows that point at the user without cascading are detached first.
  update public.maintenance_events set done_by = null where done_by = me;
  update public.house_facts set created_by = null where created_by = me;
  delete from auth.users where id = me;
end;
$$;
grant execute on function public.delete_my_account() to authenticated;
