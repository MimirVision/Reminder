-- Employers: she can work for more than one employer or department, each with its own wage, shift types and
-- supplements. Shifts and supplements say which employer they belong to. Safe to run again.

create table if not exists public.vakt_employers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default '#7c3aed' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- [{ "from": "2026-01-01", "hourly": 285 }] and [{ "id", "name", "start_time", "end_time", "break_minutes" }]
  wages jsonb not null default '[]'::jsonb check (jsonb_typeof(wages) = 'array' and pg_column_size(wages) < 8192),
  templates jsonb not null default '[]'::jsonb check (jsonb_typeof(templates) = 'array' and pg_column_size(templates) < 8192),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index if not exists vakt_employers_owner on public.vakt_employers (owner_id);

alter table public.vakt_shifts add column if not exists employer_id uuid;
alter table public.vakt_supplements add column if not exists employer_id uuid;

-- An employer can only be used by its own owner. Shifts keep their employer (delete or move the shifts first);
-- supplements go with it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vakt_shifts_employer') then
    alter table public.vakt_shifts add constraint vakt_shifts_employer
      foreign key (employer_id, owner_id) references public.vakt_employers (id, owner_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vakt_supplements_employer') then
    alter table public.vakt_supplements add constraint vakt_supplements_employer
      foreign key (employer_id, owner_id) references public.vakt_employers (id, owner_id) on delete cascade;
  end if;
end $$;
create index if not exists vakt_shifts_employer_idx on public.vakt_shifts (employer_id);
create index if not exists vakt_supplements_employer_idx on public.vakt_supplements (employer_id);

-- Anyone who used Vakt before this: one employer from the wage and shift types in their settings, and every
-- existing shift and supplement moved to it.
insert into public.vakt_employers (owner_id, name, wages, templates)
select o.owner_id, 'Jobben min',
       coalesce(p.settings->'wages', '[]'::jsonb), coalesce(p.settings->'templates', '[]'::jsonb)
from (select owner_id from public.vakt_profiles union select owner_id from public.vakt_shifts union select owner_id from public.vakt_supplements) o
left join public.vakt_profiles p on p.owner_id = o.owner_id
where not exists (select 1 from public.vakt_employers e where e.owner_id = o.owner_id);

update public.vakt_shifts s set employer_id = (select e.id from public.vakt_employers e where e.owner_id = s.owner_id order by e.sort, e.created_at limit 1)
where s.employer_id is null;
update public.vakt_supplements s set employer_id = (select e.id from public.vakt_employers e where e.owner_id = s.owner_id order by e.sort, e.created_at limit 1)
where s.employer_id is null;

drop trigger if exists vakt_employers_touch on public.vakt_employers;
create trigger vakt_employers_touch before update on public.vakt_employers for each row execute function public.vakt_touch();

alter table public.vakt_employers enable row level security;
revoke all on public.vakt_employers from anon;
grant select, insert, update, delete on public.vakt_employers to authenticated;
drop policy if exists vakt_employers_own on public.vakt_employers;
create policy vakt_employers_own on public.vakt_employers for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
