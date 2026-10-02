# Notifications: partner adds a to-do, and to-dos that are due

When one of you adds a to-do, the other's phone (or PC) gets a notification: "Anna added: Milk". It uses Web Push, so it
works from the web app with no native app and no Apple developer account. Each person turns it on for their own device.

It needs a one-time setup (about ten minutes) and the phone must have the web app on its **home screen** (iPhone: iOS 16.4 or
newer, Safari, Share, "Add to Home Screen", then open Home Memory from the home screen icon).

## 1. Make the two keys
1. Open any web page in Chrome or Edge on your computer, press **F12**, choose the **Console** tab.
2. Open `docs/generate-vapid-keys.js` from this repository, copy everything in it, paste it into the console, press Enter.
3. It prints two lines: `VAPID_PUBLIC_KEY=...` and `VAPID_PRIVATE_KEY=...`. Keep that window open for the next steps.
   The private key is a secret: never put it in the repository or in the hosting variables.

## 2. Supabase
1. Run `supabase/upgrade.sql` in the SQL Editor (it adds the table for subscriptions). Safe to run again.
2. **Edge Functions**, **Secrets** (or Project Settings, Edge Functions): add
   - `VAPID_PUBLIC_KEY` = the public key
   - `VAPID_PRIVATE_KEY` = the private key
   - `VAPID_SUBJECT` = `mailto:your@email.address` (optional but polite: the push services use it to contact you)
3. **Edge Functions**, **Deploy a new function**, **Via Editor**: name it `notify-partner`, paste the whole file
   `supabase/dashboard/notify-partner.ts`, deploy. Leave "Verify JWT" on.

## 3. Hosting (Cloudflare)
Workers & Pages, your project, **Settings**, **Variables and secrets** (build variables): add `VITE_VAPID_PUBLIC_KEY` = the public key
(the same one). Then trigger a new deployment so the app is rebuilt with it. (On Netlify it is Site configuration, Environment variables.)

## 4. Each phone
Open Home Memory (from the home screen icon on iPhone), **Settings**, **Notifications**, **Turn on notifications**, allow.
Do this on both phones. You only hear about things your partner adds, never your own.

## Good to know
- Nothing is sent by the web app while the key is missing, and nothing breaks: the switch in Settings just says it is not set up.
- To-dos added through a Siri/Shortcut capture key do not notify (they do not go through the app).
- If a phone stays quiet: check iOS Settings, Notifications, Home Memory; make sure it was opened from the home screen icon; turn
  notifications off and on again in Settings.
- The text of the to-do is sent through Apple's or Google's push service, encrypted so only your phone can read it.

## Reminders when a to-do is due (works with the phone locked)
Once the steps above are done, the same function can also send "Now: Call the plumber" at the time you gave a to-do. It goes to the
person it is for (or to both of you when it is for anyone) and works with the phone locked or the app closed. It only covers to-dos
**with a time**; a date alone does not notify. It needs a schedule that wakes the function every 5 minutes:

1. Run `supabase/upgrade.sql` again (it adds a small table that remembers what was already announced). Redeploy the `notify-partner`
   function with the new `supabase/dashboard/notify-partner.ts`.
2. Edge Functions, **Secrets**: add `CRON_SECRET` = any long random text you make up (a password). Optional: `HOME_TZ` (default
   `Europe/Oslo`) if you live in another time zone.
3. **Integrations**, **Cron** (turn on the Cron module if asked), **Create job**:
   - Name `due-reminders`, schedule `*/5 * * * *` (every 5 minutes)
   - Type **Supabase Edge Function**, function `notify-partner`, method `POST`
   - HTTP headers: keep the `Authorization` header the form fills in, and add `x-cron-secret` = the same text as `CRON_SECRET`
   - HTTP request body: `{"mode":"due"}`
   - Create. The job's **History** shows whether it ran; the function answers `{"due":0,"sent":0}` when nothing is due.

Good to know: reminders come at the due time, within a few minutes (the schedule runs every 5). A to-do whose time is missed by more
than 30 minutes (for example the phone was off) is not announced afterwards. Place reminders ("you are near the shop") cannot work
from the web app on an iPhone; only the sideloaded phone app can do those.
