# Backend (Supabase)

`migrations/` define households (you + spouse), places, memories, photo metadata, push tokens,
row-level security, the invite flow, capture keys (for Siri/Shortcuts) and a private `media` storage bucket.
`setup.sql` is generated from them (`npm run build:setup`); the test fails if it is stale.

## Setup (one time, ~10 minutes)

1. Create a project at supabase.com (choose an EU region).
2. In the dashboard open **SQL Editor → New query**, paste the whole contents of `setup.sql` (all migrations in one file) and press **Run**. Run it once on a fresh project.
3. **Authentication → Providers → Email**: for a two-person household, turn off "Confirm email" so sign-up works
   immediately.
4. **Project Settings → API**: copy the project URL and the `anon` key into `apps/web/.env.local`.

(Later we can switch to the Supabase CLI so migrations are applied from the repo.)

## Tests

`npm install && npm test` runs the migration in an in-process Postgres with minimal Supabase stubs and checks that
a stranger sees nothing, a partner who joins with the invite code sees shared memories, authorship can't be
spoofed, and photo objects are household-private.
