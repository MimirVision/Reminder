-- Optional: live updates (a to-do your partner adds appears on your screen without a refresh).
-- Run each line; if Supabase says the table is "already member of publication", that is fine. Without this, the app still
-- refreshes whenever you return to it.
alter publication supabase_realtime add table public.memories;
alter publication supabase_realtime add table public.places;
