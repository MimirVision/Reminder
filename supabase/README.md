# Backend (Supabase)

`migrations/0001_init.sql` defines households (you + spouse), places, memories, photo metadata, push tokens,
row-level security, the invite flow and a private `media` storage bucket.

## Setup (one time, ~10 minutes)

1. Create a project at supabase.com (choose an EU region).
2. In the dashboard open **SQL Editor**, paste the contents of `migrations/0001_init.sql` and run it.
3. **Authentication → Providers → Email**: for a two-person household, turn off "Confirm email" so sign-up works
   immediately.
4. **Project Settings → API**: copy the project URL and the `anon` key into `apps/web/.env.local`.

(Later we can switch to the Supabase CLI so migrations are applied from the repo.)

## Tests

`npm install && npm test` runs the migration in an in-process Postgres with minimal Supabase stubs and checks that
a stranger sees nothing, a partner who joins with the invite code sees shared memories, authorship can't be
spoofed, and photo objects are household-private.
