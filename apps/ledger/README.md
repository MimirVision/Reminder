# Ledger

A personal, accounting-first workspace for recurring client work: every client obligation is visible, every expected
task is accounted for, and missing work is flagged before it becomes a problem.

Ledger is a **personal productivity tool**. It does not connect to, scrape or automate any employer or authority
system, and it is not a replacement for official accounting systems or filing confirmations. Start with the fictional
demo data; only add real client information where your employer allows it, and keep notes free of sensitive details.

## What's in it

| Screen | What it does |
|---|---|
| Home | A dashboard you arrange. **Customize** adds widgets from a gallery of 16 (today, overdue, upcoming, this week, waiting on clients, missing tasks, key numbers, completed per week, clients needing attention, pinned clients, recent activity, notepad, deadline radar, month at a glance…), drags them into place and resizes them from the corner. The layout is saved to the workspace, so it follows you between devices. |
| My Tasks | List with search, filters (client, status, priority, type, due date), sorting and saved views. Status and due date change inline; a side panel edits the rest without losing your place. |
| Calendar | Month and week views of the same tasks. Drag an open task to another day, or use the date picker in its panel. Moving one task never changes its schedule. |
| Clients | Searchable, sortable list with open/overdue counts and next deadline; a workspace per client (open tasks, schedules, completed work, notes, activity). Archive and reactivate without losing history. |
| Recurring Work | Schedules (rules) that create tasks (occurrences), with a live preview of the next periods. Pause, resume, end, and edit with an explicit choice of which open tasks change. |
| Missing Tasks | Expected vs actual, per schedule and period, with the reason each item was flagged. Create the task, mark as reviewed, or record an exception. |
| Settings | Name, time zone, date format, defaults; appearance (theme, accent colour, density, start page, reset Home); JSON backup, CSV export, restore, data status, erase. |

**Meetings.** Book a meeting (New meeting in the calendar, `M`, or Ctrl/⌘ K) with a day, start and end time, an
optional client, a place and notes. The calendar's Week and Day views show the hours of the day: meetings sit at their
time (overlaps side by side, a line for now), tasks stay in a row at the top since they have a day but not a time.
Click an empty time to book a meeting there; drag a meeting to move it. Month view lists each day's meetings first.
Home has an Agenda widget, and a client's page a Meetings tab. Needs `0004_ledger_meetings.sql` (run `ledger.sql`).

**Notifications on your phone and PC.** Tasks remind you on their due date at 08:00 and meetings 15 minutes before
they start; add earlier ones (a few days, a week, …) in Settings → Notifications, or per task, schedule and meeting under
*Notify me*. Turn them on once on each device. They work while Ledger is open straight away; with Ledger closed too after
a one-time setup in Supabase (an edge function and a 5-minute schedule): see [NOTIFICATIONS.md](NOTIFICATIONS.md).

**Copy a schedule to other clients.** In a schedule, *Copy to clients…* (or the copy button on its row in Recurring
Work) makes the same schedule for every client you tick, or a whole group such as VAT clients. Each copy is separate
and starts from the current period; clients that already have one like it are marked and left out of groups.

**One task, several clients.** In New task, choose *Several clients…* and tick the clients (or a group: VAT clients,
Payroll clients, Pinned, All active, built from the work each client already has). Ledger creates one separate task
per client; nothing links them afterwards, and Undo removes the whole batch.

**Checklists.** A task can hold up to 50 steps, ticked as you go (`2/4` shows in lists and on the board). Settings →
Checklist templates sets the steps each task type starts with; a schedule has its own checklist, copied unticked into
every task it creates. **Waiting since** records when a task moved to *Waiting for client*, so Home can show how long
you have been waiting. **Clients** have a contact person and a list of documents to collect (requested, received).
**Your own views**: filter My Tasks, then *Save view*. **Public holidays**: with Norway chosen (the default),
"move to the next/previous weekday" also skips Norwegian public holidays (Easter, Ascension, Whit Monday, 1 and 17 May,
Christmas); the calendar shows them. **Install as an app** from Settings, or the browser's install button: Ledger then
opens in its own window. The service worker caches only the app itself, never data.

**Adding work fast.** Type one line in the quick-add bar (Home, My Tasks, a client's page) or in `Ctrl/⌘ K`:
`Chase receipts @nordvik fri !high #receipts` → client, due date, priority and tag are recognised and shown as chips
before you press Enter. Dates: `today`, `tomorrow`/`i morgen`, weekdays (`fri`, `fredag`), `next week`, `in 3 days`,
`15.11`, `15 nov`, `eom`. Priority: `!` high, `!!` urgent. The New task dialog understands the same shorthand and has
*Create & add another* (Shift+Enter) for a run of similar tasks.

Keyboard: `Ctrl/⌘ K` search, jump or create; `N` new task; `/` task search; `G` then `H T C L R M S` to jump to a
screen; `?` lists every shortcut. In task lists: `↑↓` move, `Enter` open,
`D` done, `W` waiting for client, `T` move to tomorrow, `X` select (Shift for a range) for bulk done/waiting/move.
Customizing Home: from a widget's handle, arrows move it, Shift + arrows resize it, Delete removes it.

## How it fits next to Home Memory and Post

Ledger lives in this repository and uses the **same Supabase project**, but it is kept apart on purpose:

- Its own app folder (`apps/ledger`), its own `package.json`, build, tests, CI job and Cloudflare Worker (`ledger`).
- Every database object is named `ledger_*`. Its SQL lives in `apps/ledger/supabase/` and is **not** part of
  `supabase/setup.sql`, so setting up or upgrading Home Memory never touches Ledger, and the reverse.
- No foreign keys to `auth.users` or to any other app's tables. A person's Ledger data is tied to their user id, so
  Home Memory's "delete my account" can neither delete Ledger data nor be blocked by it.
- Its own auth storage key (`ledger-auth`) in the browser, so sessions never collide. The same login works in all apps.
- Its own pg_cron job (`ledger-generate`), next to Post's.

## Setup

### 1. Run it (demo mode, no database)

```bash
cd apps/ledger
npm install
npm run dev          # http://localhost:5180
```

Without Supabase settings Ledger runs in **demo mode**: about 20 fictional clients with schedules, history, overdue
work and a few genuine missing tasks, stored only in this browser (localStorage). The sidebar and Settings say so.
This is not a safe place for real work. With Supabase configured, "Explore with fictional demo data" on the sign-in
screen (or `?demo` in the URL) opens the same demo.

### 2. Connect the shared Supabase project

1. In Supabase, open **SQL Editor → New query**, paste the whole of `apps/ledger/supabase/ledger.sql` and press **Run**.
   It only creates `ledger_*` tables and functions, is safe to run again, and schedules the nightly job if pg_cron
   is available (Supabase has it).
2. `cp .env.example .env.local` and fill in the same URL and anon/publishable key as `apps/web/.env.local`.
   Never use the `service_role` key in the app.
3. `npm run dev`, sign in with your existing account (or create one), and either start empty or use
   **Settings → Load fictional demo data**. **Settings → Erase all data** clears it again.

If you open the app before step 1, it shows a setup screen instead of failing.

> Do not use `supabase db push` for Ledger from this repo: the CLI keeps one migration history per project, which
> Home Memory may use too. Run `ledger.sql` in the SQL editor instead.

### Updating the database

When a new version adds to the database, Settings shows **Database update available**. Run `ledger.sql` again (same
steps as above): it only adds columns and functions to Ledger's own tables and keeps everything you have. Until then the
app keeps working and leaves the new features off. Version 3 adds checklists, "waiting since", client contacts and
documents, and holiday-aware due dates; version 4 adds meetings.

### Environment variables

| Variable | Where | What |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` (dev), `.env.production` (builds) | Project URL. Public. |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` (dev), `.env.production` (builds) | Anon/publishable key. Public by design; access is enforced by row level security. |

No other secrets are needed. Nothing is sent to AI services or third parties.

## Data model

- `ledger_workspaces`: one per person (`owner_id` = auth user id), with time zone and settings.
- `ledger_clients`: name, optional unique reference, active/archived, notes.
- `ledger_schedules`: the **rules**. Frequency (weekly, monthly, quarterly, yearly, or every N weeks/months), the month
  periods align to (calendar or fiscal year), start/end, a due-date rule, creation lead time, "due soon" days,
  default priority, automatic creation on/off, status.
- `ledger_schedule_pauses`: pause history; periods due inside a pause are neither created nor expected.
- `ledger_occurrences`: the actual **tasks**. One-off tasks have no schedule. A schedule's task carries its
  `period_key`, and `unique (schedule_id, period_key)` is what makes generation idempotent. `scheduled_due_date`
  remembers the schedule's date when one task is moved by hand.
- `ledger_reviews`: decisions on expected tasks that don't exist (reviewed, or an exception with a required reason).
- `ledger_activity`: history of task, schedule, client and review changes, written by triggers with the actor.
- `ledger_generation_runs`: every generation run, with per-schedule errors.

Due-date rules are a small tagged JSON union (`month_offset`, `days_after_end`, `weekday`, each with an optional
weekend adjustment), validated in the database. New accounting-specific rules (public holidays, authority calendars)
can be added as new kinds without touching existing schedules.

### Integrity rules enforced by the database

- Row level security on every table; signed-out visitors have no access at all; history and runs are read-only.
- A schedule task cannot be deleted (cancel it instead, so the period stays accounted for); one-off tasks can.
- A client with history cannot be deleted (archive it); the client, frequency, alignment and start date of a schedule
  with tasks cannot change (end it and create a new one).
- A task's schedule and period cannot be changed; `completed_at` follows the status.
- Check constraints on every enum, length and date range; a time zone must be valid.

## Recurring tasks and missing-task detection

The engine is in `src/lib/recurrence.ts` and, identically, in SQL (`supabase/migrations/0002_ledger_engine.sql`).
`supabase/tests/engine.test.ts` runs 300 random schedules through both and requires identical periods and due dates.

**Generation** (`ledger_generate_for`) creates, for each active client's schedule with automatic creation on, every
period whose due date is on or after the schedule's start and its *creation start* (`generate_from`), whose creation
date (due − lead days) has arrived, and that isn't paused. It:

- uses `insert … on conflict (schedule_id, period_key) do nothing` plus a per-workspace advisory lock, so any number
  of runs, at the same time or not, never create duplicates and never change an existing task;
- runs nightly via pg_cron (02:10 UTC) **and** every time the app opens or the date changes while it is open, so it
  doesn't depend on the browser, and a missed night is caught up by the next run;
- records failures per schedule without stopping the others; the app shows them.

**Detection** (`src/lib/missing.ts`) compares every period that should exist by today with the tasks that do:

| State | Meaning |
|---|---|
| Missing | Expected, but due before the schedule started creating tasks (added later than its start), or the schedule is check-only. |
| Generation failed | Automatic creation was responsible for it and the task doesn't exist. |
| Not yet due | The next expected task, with the date it will be created. |
| Exception / Reviewed | You recorded a decision; the reason is kept. |

Nothing is created or dismissed automatically. Cancelled tasks count as accounted for.

**Editing a schedule** never rewrites completed, cancelled or earlier tasks. When the change affects tasks (title,
notes, type, due-date rule) and open tasks exist from today, you choose: update those open tasks (keeping dates you
moved by hand and titles/notes you edited on a task), or only affect tasks created from now on.

## Tests

```bash
npm test              # Vitest: dates, recurrence, filters, missing detection, seed, demo store,
                      # plus the SQL in an in-process Postgres (PGlite): RLS isolation, constraints,
                      # history, idempotent/concurrent generation, pauses, catch-up, failures, end/apply
npm run test:e2e      # Playwright, against demo mode: dashboard, task create/complete/reload,
                      # rescheduling, schedule preview + no duplicates, missing-task review, calendar, keyboard
npm run build         # type check and production build
npm run build:sql     # regenerate supabase/ledger.sql from the migrations
npm run build:function # regenerate supabase/dashboard/ledger-notify.ts (the notification server)
```

Date handling is tested across month ends, leap years (2024, 2028, 2100, 2000), ISO week-years and the 2026
daylight-saving changes in Europe/Oslo. Due dates are plain calendar dates, so they can't shift with time zones.

## Hosted demo page

`npm run build:artifact` builds the whole app into one self-contained file, `dist-artifact/ledger.html`, in demo
mode. That is the version published as a private page on claude.ai. There the route is kept in memory (the page can't
change its own address) and backup/CSV export copy to the clipboard instead of downloading.

## Deployment: at /ledger/ on the Home Memory site

Like Post at `/post/`, Ledger is served from the same Cloudflare Worker as Home Memory, at
`https://<your reminder site>/ledger/`. Nothing needs setting up in Cloudflare:

- `apps/web`'s `npm run build` runs `apps/web/scripts/add-ledger.mjs`, which builds `apps/ledger` with base `/ledger/` and
  copies it to `dist/ledger/`. If that step fails, it prints a warning and Home Memory and Post still deploy.
- Under `/ledger/` the route lives after the `#` (`/ledger/#/tasks`), so the Worker and Home Memory's service worker
  need no Ledger routes. Home Memory's service worker ignores `/ledger/` (as it does `/post/`).
- `apps/web/public/_headers` gives `/ledger/*` its own Content Security Policy (only this site and `*.supabase.co`).
- The Supabase URL and publishable key come from `apps/ledger/.env.production` (public by design; RLS protects the data).
- Ledger keeps its own sign-in (browser key `ledger-auth`); sign in once with the same account as Home Memory.

## Backup and restore

- **Settings → Download backup (JSON)** exports clients, schedules, pauses, tasks, reviews and recent history.
  Do this regularly; it's also how you move between demo mode and Supabase.
- **Settings → Export tasks (CSV)** for a spreadsheet.
- **Restore**: on an empty workspace (Settings → Erase all data first if needed), **Restore from backup…** recreates
  clients, schedules, pauses, tasks and reviews with their original ids; generation then fills in anything that came
  due since. The history in a backup is for reference; a restored database starts a new history.
- Supabase also keeps its own daily backups of the whole project (depending on your plan); a point-in-time restore
  there restores Home Memory and Post too, so prefer Ledger's own JSON backup for Ledger-only recovery.

## Not in this version

Multi-user workspaces, time tracking, billing and AI
features. The workspace model leaves room for more than one user.
