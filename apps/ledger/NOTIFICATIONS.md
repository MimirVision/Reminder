# Ledger notifications: your phone and PC

Ledger reminds you of a task on its due date at 08:00, and of a meeting 15 minutes before it starts. You can add
earlier reminders (1, 2, 3, 5 days, a week, two weeks or 30 days before a task; 5 minutes to a day before a meeting) in
**Settings → Notifications**. Those settings are the defaults. Each task, schedule (for every task it creates) and meeting
can choose its own under **Notify me**.

Each device is turned on once with a tap: open Ledger on the phone and on the PC, then press **Turn on** (in the prompt on
Home, or Settings → Notifications → *Turn on for this device*), and allow notifications. Browsers only allow that after a tap.

There are two ways notifications arrive:

| | Needs | Works when |
|---|---|---|
| **While Ledger is open** | Nothing. Works as soon as you turn it on. | Ledger is open in a tab or as the installed app (it can be in the background). |
| **Also with Ledger closed** | The one-time setup below (about ten minutes). | Always, also with the phone locked. Sent through the browser's push service (Web Push). |

Until the setup is done, Ledger uses the first kind. After it, Settings shows *Also with Ledger closed* on devices that
were turned on earlier: press it once on each.

## One-time setup for "also with Ledger closed"

Everything is in the same Supabase project as Home Memory and Post, but Ledger uses only its own `ledger_*` tables and its
own function, `ledger-notify`. Nothing of Home Memory's or Post's is read or changed.

### 1. Update the database
Supabase → **SQL Editor** → New query → paste the whole of `apps/ledger/supabase/ledger.sql` → **Run**. It is safe to run
again. It adds the device list and the per-task and per-meeting reminder choices (and meetings, if you haven't run it since).

### 2. Keys (skip if Home Memory notifications are already set up)
Supabase → **Edge Functions** → **Secrets**. If `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are already there (Home Memory
uses them), Ledger uses the same ones; go to step 3. Otherwise:
1. Open any page in Chrome or Edge on your PC, press **F12**, open the **Console** tab.
2. Paste the whole of `docs/generate-vapid-keys.js` from this repository and press Enter. It prints two lines.
3. Add the secrets `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` with those values. Optional: `VAPID_SUBJECT` =
   `mailto:` followed by your email address (push services use it if they need to reach whoever sends).

The private key is a secret: it lives only in Supabase's secrets, never in the repository or in Cloudflare. The app
fetches the public key from the function, so Cloudflare needs no new variable.

### 3. A password for the schedule
Still under **Secrets**, add `LEDGER_CRON_SECRET` = a long random text you make up (40 or more letters and digits).
(If you already have `CRON_SECRET` for Home Memory, Ledger accepts that too, but its own is tidier.)

### 4. Deploy the function
**Edge Functions** → **Deploy a new function** → **Via Editor**. Name it `ledger-notify`, replace the example code with
the whole of `apps/ledger/supabase/dashboard/ledger-notify.ts`, and press **Deploy**. Leave "Verify JWT" on.

### 5. Wake it every 5 minutes
**Integrations** → **Cron** (turn the Cron module on if asked) → **Create job**:
- Name `ledger-notifications`, schedule `*/5 * * * *`
- Type **Supabase Edge Function**, function `ledger-notify`, method `POST`
- HTTP headers: keep the `Authorization` header the form fills in, and add `x-cron-secret` = the text from step 3
- HTTP request body: `{"mode":"due"}`

The job's **History** shows each run; the function answers `{"due":0,"sent":0}` when nothing is due.

### 6. Each device
Open Ledger → **Settings → Notifications**. It should say *Notification server running*. On each device press *Turn on for
this device* (or *Also with Ledger closed*), then **Send a test**.
- **iPhone / iPad** (iOS 16.4 or newer): notifications only work in the Home Screen app. Safari → Share → *Add to Home
  Screen*, open Ledger from the new icon, then turn them on there.
- **Android**: Chrome works in the browser; installing Ledger (Settings → Install) is still nicer.
- **PC**: Chrome, Edge or Firefox. Windows' own notification settings must allow the browser.

## Good to know
- **Privacy.** A notification is encrypted on the server for your device alone (RFC 8291). The push service that
  carries it (Google, Apple, Mozilla or Microsoft, depending on the browser) can't read it; it only sees that something
  was sent. *Settings → On the lock screen → Hide names* leaves task titles and client names out entirely.
- **Timing.** Reminders arrive within five minutes of their time (the schedule's interval). One missed by more than
  30 minutes (the server was down, the schedule was off) is skipped rather than sent late. A phone that is off gets a
  task reminder when it comes back within 12 hours, and a meeting reminder only until the meeting starts.
- **Grouping.** Tasks that fall due at the same moment come as one notification ("3 tasks due today").
- **Moving a task** to another date re-arms its reminders for the new date. Done and cancelled tasks never remind.
- **Time zone**: the one in Settings → Date and locale decides when 08:00 is.
- **Pause** everything with *Send notifications* in Settings. **Remove a device** from the list there; a device whose
  browser dropped the subscription is removed automatically.
- Each device keeps its own on/off state. *Turn off here* only affects the device you are on.
