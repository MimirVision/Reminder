-- Home Memory: Milestone 1 schema.
-- A household is the sharing unit (you + spouse). Everything else hangs off it.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

-- Membership check used by every policy. SECURITY DEFINER avoids recursive RLS on household_members.
create function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

-- Saved places. 'fixed' = a point with a radius; 'category' = "any pharmacy" (resolved to nearby POIs later).
create table public.places (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  kind text not null default 'fixed' check (kind in ('fixed', 'category')),
  category text,
  lat double precision,
  lon double precision,
  radius_m integer not null default 150 check (radius_m between 50 and 2000),
  created_at timestamptz not null default now(),
  check (
    (kind = 'fixed' and lat is not null and lon is not null)
    or (kind = 'category' and category is not null)
  )
);
create index places_household_idx on public.places (household_id);

-- A memory starts as raw capture in the inbox. Anchors (place) are optional and additive.
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id),
  body text not null default '',
  status text not null default 'inbox' check (status in ('inbox', 'active', 'done', 'dismissed')),
  place_id uuid references public.places (id) on delete set null,
  place_category text,
  capture_lat double precision,
  capture_lon double precision,
  capture_accuracy_m real,
  -- "Not now" keeps the memory for the next visit: no push again until this passes.
  snoozed_until timestamptz,
  last_surfaced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index memories_household_status_idx on public.memories (household_id, status, created_at desc);
create index memories_place_idx on public.memories (place_id) where place_id is not null;

create table public.media (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null default 'photo' check (kind in ('photo', 'voice')),
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index media_memory_idx on public.media (memory_id);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  platform text not null check (platform in ('ios', 'web')),
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger memories_touch before update on public.memories
  for each row execute function public.touch_updated_at();

-- Bootstrap and invite flow. Direct inserts into households/household_members are not allowed.
create function public.create_household(p_name text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.households (name) values (p_name) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name, role)
    values (hid, auth.uid(), p_display_name, 'owner');
  return hid;
end;
$$;

create function public.join_household(p_invite_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into hid from public.households where invite_code = lower(trim(p_invite_code));
  if hid is null then raise exception 'invalid invite code'; end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), p_display_name)
    on conflict do nothing;
  return hid;
end;
$$;

-- Row level security
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.places enable row level security;
alter table public.memories enable row level security;
alter table public.media enable row level security;
alter table public.push_tokens enable row level security;

create policy households_select on public.households for select using (public.is_member(id));
create policy households_update on public.households for update using (public.is_member(id)) with check (public.is_member(id));

create policy members_select on public.household_members for select using (public.is_member(household_id));
create policy members_update_self on public.household_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_delete_self on public.household_members for delete using (user_id = auth.uid());

create policy places_all on public.places for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy memories_select on public.memories for select using (public.is_member(household_id));
create policy memories_insert on public.memories for insert
  with check (public.is_member(household_id) and author_id = auth.uid());
create policy memories_update on public.memories for update
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy memories_delete on public.memories for delete using (public.is_member(household_id));

create policy media_all on public.media for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy push_tokens_own on public.push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, update on public.households to authenticated;
grant select, update, delete on public.household_members to authenticated;
grant select, insert, update, delete on public.places, public.memories, public.media, public.push_tokens to authenticated;
grant execute on function public.create_household(text, text), public.join_household(text, text) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- Private photo bucket. Objects live under <household_id>/<memory_id>/<file>.
insert into storage.buckets (id, name, public) values ('media', 'media', false)
on conflict (id) do nothing;

create policy media_objects_all on storage.objects for all
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
