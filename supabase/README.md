# Backend (Supabase)

`migrations/` define households (you + spouse), places, memories, photo metadata, push tokens,
row-level security, the invite flow, capture keys (for Siri/Shortcuts) and a private `media` storage bucket.
`setup.sql` is generated from them (`npm run build:setup`); the test fails if it is stale.

## Already ran setup.sql? Run `upgrade.sql`

`setup.sql` is the whole schema for a fresh project. If you already ran `setup.sql` or an earlier `upgrade.sql` through
migration 0006, paste `upgrade.sql` into the SQL Editor and run it once instead; it contains only the newer migrations
(0007 reminder keys, and later ones). `npm run build:setup` regenerates both files.

## Setup (one time, ~10 minutes)

1. Create a project at supabase.com (choose an EU region).
2. In the dashboard open **SQL Editor → New query**, paste the whole contents of `setup.sql` (all migrations in one file) and press **Run**. Run it once on a fresh project.
3. **Authentication → Providers → Email**: for a two-person household, turn off "Confirm email" so sign-up works
   immediately.
4. **Project Settings → API**: copy the project URL and the `anon` key into `apps/web/.env.local`.

(Later we can switch to the Supabase CLI so migrations are applied from the repo.)

## AI features (optional)

When you add a to-do without a place, the apps ask the `suggest` edge function whether it belongs at a shop
("paracetamol → any pharmacy"). It only proposes; you confirm with one tap. Each to-do is asked about at most once.
The apps work without it.

**No command line?** Paste the single-file copies in `dashboard/` into the Supabase dashboard (Edge Functions, new function,
editor) with the names `suggest` and `import-report`; see `docs/GETTING_STARTED.md` section 6. `npm run build:functions`
regenerates them, and a test fails if they go stale.

One-time setup with the CLI (needs an Anthropic API key from console.anthropic.com):

```powershell
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy suggest
```

Two functions use it:
- `suggest`: proposes a place for a to-do (above).
- `import-report`: reads a tilstandsrapport PDF and lists the TG2/TG3/TGIU findings with measures and cost estimates, so you can turn the ones you want into to-dos (web app: House, Import the tilstandsrapport). Deploy it too:
  `npx supabase functions deploy import-report` (the API key secret is shared). The PDF is stored in your private bucket and sent to Anthropic's API.

- The model defaults to `claude-opus-5-5`. To change it (for example to a cheaper one), run
  `npx supabase secrets set ANTHROPIC_MODEL=<model id>`.
- Cost: each suggestion is one tiny request, so a few øre per day at normal use. A report import reads a whole PDF (tens of thousands of tokens), so expect a few kroner per report, and you only do it once or twice.
- `setup.sql` already contains the two columns it needs (migration 0004).

## Tests

`npm install && npm test` runs the migration in an in-process Postgres with minimal Supabase stubs and checks that
a stranger sees nothing, a partner who joins with the invite code sees shared memories, authorship can't be
spoofed, and photo objects are household-private. It also tests the suggestion logic with a faked model
(`tests/suggest.test.ts`). The function itself has not been run against the real API from here.
