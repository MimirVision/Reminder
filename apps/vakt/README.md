# Vakt

A phone app (PWA) for shift workers in Norwegian health care: enter the date and the times of each shift, and Vakt
works out what it pays with every supplement (tillegg) she gets: evening, night, weekend, public holiday, holiday eve,
overtime, fixed sums per shift. The overview shows what she has earned so far this month, what is on the way, the
progress towards a monthly goal and what the supplements added. The UI is in Norwegian.

| Screen | What it does |
|---|---|
| Oversikt | The month: earned so far, planned, total (and roughly after tax), progress towards the goal, a motivating line, next shift, where the money comes from. |
| Vakter | The month's shifts week by week, each with its pay and supplements. Tap to change or delete (with undo). |
| År | Month-by-month bars (earned and planned), best month, the year's supplements. |
| Innstillinger | Hourly wage with dates (a pay rise never changes earlier months), supplements, shift types, monthly goal, tax, account. |
| + | New shift: one tap on a shift type (Dag, Kveld, Natt …), the date, a live breakdown of what it pays. *Lagre + ny* keeps the times and moves to the next day, for entering a whole roster. |

The first sign-in asks for the hourly wage, which common supplements she gets (amounts to check against the pay
slip) and a goal.

## How pay is calculated (`src/lib/pay.ts`)

- Paid hours = end − start − unpaid break. An end at or before the start is the next day (night shift).
- A supplement has days (Mon–Sun, *helligdag*, *dag før helligdag*) and a time window. A window over midnight belongs to
  the day it starts on (Friday 21:00–06:00 covers Saturday morning). Equal times mean all day.
- Amounts: kr per hour, percent of the hourly wage per hour (with an optional minimum kr per hour), or kr per shift.
- The unpaid break is taken evenly off every supplement's hours, since its time of day isn't recorded.
- Norwegian public holidays and their eves are computed (`src/lib/holidays.ts`).
- The hourly wage is the one in effect on the shift's date.

## Same infrastructure as the other apps

Like Ledger, Vakt lives in this repository and uses the **same Supabase project**, kept apart on purpose:

- Its own folder, `package.json`, build, tests and CI job. Served at `/vakt/` on the Home Memory site:
  `apps/web`'s build runs `apps/web/scripts/add-vakt.mjs`; if that fails, the other apps still deploy.
- Every database object is named `vakt_*`; its SQL is `apps/vakt/supabase/vakt.sql`, not part of `supabase/setup.sql`.
- No foreign keys to `auth.users`; rows are tied to the user id, with row level security on every table.
- Its own sign-in storage key (`vakt-auth`). Any account in the project can sign in; each sees only their own data.

## Setup

1. Supabase → **SQL Editor → New query**, paste all of `apps/vakt/supabase/vakt.sql`, **Run**. Safe to run again.
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
