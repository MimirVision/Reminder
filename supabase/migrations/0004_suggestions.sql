-- AI place suggestions. The `suggest` edge function proposes a place for a to-do; the user confirms in the app.
-- suggested_at marks "already asked", so each to-do costs at most one model call.
alter table public.memories
  add column suggestion jsonb,
  add column suggested_at timestamptz;
