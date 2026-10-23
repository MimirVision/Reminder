# Vakt: reminders on the phone

Vakt can send three reminders (each can be switched off under **Oppsett → Påminnelser**):

| Reminder | When |
|---|---|
| Etter hver vakt | Half an hour after a shift ends: what it paid, and a nudge to check the times. Not for sick shifts. |
| Søndag kveld | Sunday between 18 and 21, if next week has no shifts yet. |
| Slutten av måneden | Six days before the month ends, evening, if next month has no shifts yet. |

They are sent by an edge function, `vakt-notify`, in the same Supabase project as the other apps. It reads only
`vakt_*` tables. Times are Norwegian time (Europe/Oslo).

## One-time setup (about ten minutes)

1. **Database.** Supabase → SQL Editor → paste all of `apps/vakt/supabase/vakt.sql` → Run (version 3 adds the device
   list). Safe to run again.
2. **Keys.** Supabase → Edge Functions → Secrets. If `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are there already (Home
   Memory and Ledger use them), Vakt uses the same ones. Otherwise create them with `docs/generate-vapid-keys.js` (see
   `apps/ledger/NOTIFICATIONS.md`, step 2).
3. **A password for the schedule.** Add the secret `VAKT_CRON_SECRET` = a long random text (or reuse `CRON_SECRET`).
4. **The function.** Edge Functions → Deploy a new function → Via Editor. Name it `vakt-notify`, paste the whole of
   `apps/vakt/supabase/dashboard/vakt-notify.ts`, Deploy. Leave "Verify JWT" on.
5. **The schedule.** Integrations → Cron → Create job: name `vakt-notifications`, schedule `*/15 * * * *`, type Supabase
   Edge Function `vakt-notify`, method POST, header `x-cron-secret` = the text from step 3, body `{"mode":"due"}`.
6. **On the phone.** Open Vakt **from the Home Screen icon** (iPhone and iPad only allow notifications there), Oppsett →
   Påminnelser → *Slå på varsler på denne enheten*, allow, then *Send en test*.

After changing the function's code (`supabase/functions/vakt-notify`, or the pay rules in `src/lib`), run
`npm run build:function` and paste the new `dashboard/vakt-notify.ts` again.
