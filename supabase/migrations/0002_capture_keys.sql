-- Capture keys let something with no login (an iOS Shortcut, Siri, Action button, a script on Windows)
-- drop a memory into the household inbox. Only the sha256 hash of the key is stored.

create table public.capture_keys (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  label text not null default 'Shortcut',
  key_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index capture_keys_user_idx on public.capture_keys (user_id);

alter table public.capture_keys enable row level security;
-- Members can list/revoke their own keys. Creation goes through create_capture_key (needs the plaintext once).
create policy capture_keys_select on public.capture_keys for select using (user_id = auth.uid());
create policy capture_keys_delete on public.capture_keys for delete using (user_id = auth.uid());
grant select, delete on public.capture_keys to authenticated;

-- Returns the plaintext key exactly once.
create function public.create_capture_key(p_household_id uuid, p_label text default 'Shortcut')
returns text language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_household_id) then raise exception 'not a member'; end if;
  k := 'hm_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.capture_keys (household_id, user_id, label, key_hash)
    values (p_household_id, auth.uid(), coalesce(nullif(trim(p_label), ''), 'Shortcut'), sha256(convert_to(k, 'utf8')));
  return k;
end;
$$;

-- Callable without login (anon role). The key is the credential.
create function public.capture_memory(
  p_key text,
  p_body text,
  p_lat double precision default null,
  p_lon double precision default null
) returns void language plpgsql security definer set search_path = public as $$
declare ck public.capture_keys;
begin
  select * into ck from public.capture_keys where key_hash = sha256(convert_to(coalesce(p_key, ''), 'utf8'));
  if not found then raise exception 'invalid capture key' using errcode = '28000'; end if;
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'empty memory'; end if;
  if length(p_body) > 5000 then raise exception 'memory too long'; end if;

  insert into public.memories (household_id, author_id, body, capture_lat, capture_lon)
    values (ck.household_id, ck.user_id, trim(p_body), p_lat, p_lon);
  update public.capture_keys set last_used_at = now() where id = ck.id;
end;
$$;

grant execute on function public.create_capture_key(uuid, text) to authenticated;
grant execute on function public.capture_memory(text, text, double precision, double precision) to anon, authenticated;
