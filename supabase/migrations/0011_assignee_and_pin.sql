-- Who a to-do is for, and pinning a to-do to the top of its list. Written to be safe to run more than once.

alter table public.memories add column if not exists assignee_id uuid references auth.users (id) on delete set null;
alter table public.memories add column if not exists pinned boolean not null default false;

-- A to-do can only be given to someone who is in the same household.
create or replace function public.check_assignee() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.assignee_id is not null and not exists (
    select 1 from public.household_members hm where hm.household_id = new.household_id and hm.user_id = new.assignee_id
  ) then
    raise exception 'assignee is not in this household' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists memories_check_assignee on public.memories;
create trigger memories_check_assignee before insert or update of assignee_id, household_id on public.memories
  for each row execute function public.check_assignee();

-- Same as before, and a repeating to-do keeps who it is for.
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
      when 'weekly' then nd + 7
      when 'monthly' then (nd + interval '1 month')::date
      else (nd + interval '1 year')::date end;
    exit when nd > current_date;
  end loop;
  insert into public.memories (household_id, author_id, body, status, place_id, place_category, due_on, due_time, repeat_rule, assignee_id)
  values (m.household_id, m.author_id, m.body, 'active', m.place_id, m.place_category, nd, m.due_time, m.repeat_rule, m.assignee_id)
  returning id into nid;
  return nid;
end;
$$;
grant execute on function public.complete_memory(uuid) to authenticated;
