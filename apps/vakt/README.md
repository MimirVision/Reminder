# Vakt

A phone app (PWA) for shift workers in Norwegian health care: enter the date and the times of each shift, and Vakt
works out what it pays with every supplement (tillegg) she gets: evening, night, weekend, public holiday, holiday eve,
overtime, fixed sums per shift. The overview shows what she has earned so far this month, what is on the way, the
progress towards a monthly goal and what the supplements added. The UI is in Norwegian.

| Screen | What it does |
|---|---|
| Oversikt | The month: earned so far, planned, total (and roughly after tax), progress towards the goal, a motivating line, next shift, where the money comes from. |
| Vakter | A month calendar (a bar per shift: day, evening, night; tap an empty day to add one there), then the month's shifts week by week, each with its pay and supplements. Tap to change or delete (with undo). |
| År | Month-by-month bars (earned and planned), best month, the year's supplements. |
| Oversikt (more) | *Lønn på konto*: what lands in the account that month and on which day (the wage for the month, supplements and overtime for the month before, holiday pay in June), with *Sjekk mot lønnsslippen* to enter the pay slip and see any difference. Brutto/Netto switch on the big number. |
| Oppsett | Set up once: each employer or department with its own hourly wage (with dates, so a pay rise never changes earlier months), supplements and shift types, a "Klar / Mangler …" status, a table of what each shift type pays on a weekday, Saturday and Sunday, and *Kopier oppsettet til …* another employer. Below: monthly goal, tax, account. |
| + | New shift: where (only asked with more than one employer), one tap on a shift type (Dag, Kveld, Natt …), the date, a live breakdown of what it pays. Tap several days in its calendar to add the same shift on all of them; *Lagre + ny* keeps the times and moves to the next day. |

With more than one employer, chips under the header show all of them or one (Oversikt, Vakter, År), shift rows show
the employer, and the overview splits the month per employer. The goal is for all of them together.

The first sign-in asks where she works and the hourly wage, which common supplements she gets (amounts to check
against the pay slip), whether she works at more places (they get a copy of the same setup), and a goal.

**Also:** days off (ferie, fri, avspasering) from *Ny vakt → Fri / ferie*, shown in the calendar; *Jeg var syk* on a
shift pays it at the sick-pay share from Oppsett; *Gjenta uke eller turnus* on Vakter copies a week or a 2–6 week rota
forward; holiday pay (10.2 / 12 / 14.3 %) in the year view and in June's payout; reminders on the phone
([NOTIFICATIONS.md](NOTIFICATIONS.md)). On iPad (768 px and wider) a rail on the left replaces the bottom bar, screens
use two columns and sheets open as centred dialogs.

**Times by day:** a shift type (Oppsett → arbeidsgiver → Vakttyper) has its usual times and, if needed, its own times
on particular days (fre → lør, lør → søn, søn → man …, helligdager). Choosing the type on a date uses that day's times
everywhere: Ny vakt (each of several dates gets its own), quick entry, GAT import codes and the pay preview. Changing a
type's times offers to move her coming shifts of that type.

**Fast entry:** on Vakter, *Legg inn raskt*: pick Dag, Kveld, Natt, Ferie or Fri once, then each tap on a day adds it
and a second tap removes it (with a running count and sum). Oversikt has *Denne uka* (the seven days, each day's pay,
tap to open or add) and the next pay day in the big card. *Ny vakt* starts on the shift type she usually has on that
weekday.

**Import from GAT:** *Vakter → Importer fra GAT* reads a photo, screenshot or PDF of the roster with AI and shows the
shifts to check before saving; see [IMPORT.md](IMPORT.md) (needs `ANTHROPIC_API_KEY` and the `vakt-import` function).
**Pay settlement:** from June, until this year's new hourly wage is in, the overview asks once (and a reminder comes
on 1 September). **Shortcut:** `#/ny` opens *Ny vakt* straight away; on Android a long press on the icon offers it.

**Appearance and data:** Oppsett → Utseende chooses Auto (follow the phone), Lys or Mørk, per device
(`public/theme.js` applies it before the first paint). Oppsett → Dine data downloads every shift as a CSV for Excel or
Numbers. The sign-in screen has *Glemt passord?*; the reset link returns to the app, which asks for a new password
(add the app's address under Supabase → Authentication → URL Configuration → Redirect URLs).

**Staying current:** the app fetches everything again when it comes back to the front after a while (changes made on
another device show up), the clock behind "earned so far" and "next shift" moves on by itself, a failed save never
undoes other changes, and adding the same shift twice on a day is skipped.

## How pay is calculated (`src/lib/pay.ts`)

- Paid hours = end − start − unpaid break. An end at or before the start is the next day (night shift).
- A supplement has days (Mon–Sun, *helligdag*, *dag før helligdag*) and a time window. A window over midnight belongs to
  the day it starts on (Friday 21:00–06:00 covers Saturday morning). Equal times mean all day.
- Amounts: kr per hour, percent of the hourly wage per hour (with an optional minimum kr per hour), or kr per shift.
- The unpaid break is taken evenly off every supplement's hours, since its time of day isn't recorded.
- Norwegian public holidays and their eves are computed (`src/lib/holidays.ts`).
- The hourly wage is the one in effect on the shift's date, at the shift's own employer, with that employer's supplements.

## Same infrastructure as the other apps

Like Ledger, Vakt lives in this repository and uses the **same Supabase project**, kept apart on purpose:

- Its own folder, `package.json`, build, tests and CI job. Served at `/vakt/` on the Home Memory site:
  `apps/web`'s build runs `apps/web/scripts/add-vakt.mjs`; if that fails, the other apps still deploy.
- Every database object is named `vakt_*`; its SQL is `apps/vakt/supabase/vakt.sql`, not part of `supabase/setup.sql`.
- No foreign keys to `auth.users`; rows are tied to the user id, with row level security on every table.
- Its own sign-in storage key (`vakt-auth`). Any account in the project can sign in; each sees only their own data.

## Setup

1. Supabase → **SQL Editor → New query**, paste all of `apps/vakt/supabase/vakt.sql`, **Run**. Safe to run again; run it
   again after updates (version 2 adds employers and moves earlier data to one called "Jobben min"; version 3 adds pay
   day, sick shifts, days off, pay slips and reminder devices; version 4 the daily allowance for roster imports). Until then the app shows *Databasen må oppdateres*.
2. Deploy the site as usual. Open `https://<the site>/vakt/` on her phone, create an account (or sign in), then in
   Safari **Del → Legg til på Hjem-skjerm**.

If the app is opened before step 1 it shows a setup screen instead of failing.

Locally: `npm install && npm run dev` (http://localhost:5190). With no Supabase settings (or `?demo`) it runs in a
trial mode that stores data in the browser only.

## Tests

```bash
npm test           # Vitest: the pay engine, holidays, motivation, and the SQL in PGlite (RLS, constraints)
npm run test:e2e   # Playwright in trial mode: onboarding, adding/editing/deleting shifts, supplements
npm run build      # type check and production build
npm run build:sql  # regenerate supabase/vakt.sql from the migrations
node scripts/icons.mjs  # regenerate the PNG icons from public/icon.svg
```

## Updates on the phone

A Home Screen app on the iPhone is often resumed from memory rather than reloaded. Each time Vakt comes to the front it
fetches its own page and compares the script it names with the one running (`src/lib/update.ts`); when a new version
is out, a banner offers to reload. The version (commit and build time) is at the bottom of Oppsett.
