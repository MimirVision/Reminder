-- Reminders at a to-do's due time ("Call the plumber" at 18:00) as push notifications. This table remembers which to-dos were
-- already announced so nobody is told twice. Only the server (service role) uses it. Safe to run more than once.
create table if not exists public.due_pushes (
  memory_id uuid primary key references public.memories (id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.due_pushes enable row level security;
revoke all on public.due_pushes from anon, authenticated;

notify pgrst, 'reload schema';
