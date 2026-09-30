# Getting started

Everything you need to run Home Memory, in the order to do it. No Apple developer account is needed for steps 1 to 4.

## On a locked-down laptop (no npm, no installs)? Everything below works from a browser.
- **Database:** step 1 is browser-only.
- **Hosting the web app:** use section 3, option A (Netlify connects to GitHub and builds it for you).
  If Netlify is blocked or you cannot authorise GitHub, use option B (a GitHub Actions build you download and drag onto Netlify).
- **Using it:** open the hosted link on your iPhone (Add to Home Screen). You never run npm.
- **AI features:** paste the two files from `supabase/dashboard/` into the Supabase dashboard (section 6). No CLI needed.
- Skip Expo Go (section 4) and the spike; those need Node.

## 1. Supabase (the database), once
1. In your Supabase project open **SQL Editor > New query**.
2. Fresh project: paste all of `supabase/setup.sql` and run it.
   Already ran an earlier `setup.sql`: paste `supabase/upgrade.sql` instead and run it (only the newer parts).
3. **Authentication > Sign In / Providers > Email**: turn **off** "Confirm email".

## 2. Web app on your PC
```powershell
cd apps\web
npm install
copy .env.example .env.local        # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```
Create an account, "Start a new household", then add places, to-dos, and open **House** to create the maintenance calendar.

## 3. Web app on your phone (works today)

**Option A, nothing to install (recommended):**
1. Go to <https://app.netlify.com>, sign up, then **Add new site > Import an existing project > GitHub**, and pick the `Reminder` repository.
2. Set the branch to `claude/home-memory-design-hlpuoi`. The build settings are read from `netlify.toml` at the repository root.
3. Before the first deploy open **Site configuration > Environment variables** and add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as in step 2). Then deploy.
4. Netlify gives you a link like `something.netlify.app`.

**Option B, build on GitHub and upload by hand** (if Option A is blocked):
1. On GitHub open the repo, **Settings > Secrets and variables > Actions > New repository secret**, and add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Actions > Build web app > Run workflow** (pick this branch). When it finishes, open the run and download **web-dist**.
3. Unzip it and drag the folder onto <https://app.netlify.com/drop>.

**Option C, on a PC with Node:** `cd apps\web`, `npm run build`, drag `dist` onto Netlify Drop.

On the iPhone open the link in Safari > Share > **Add to Home Screen**. When you and your partner both have accounts, turn off
"Allow new users to sign up" in Supabase (Authentication).

## 4. The real phone app in Expo Go (free)
See `apps/mobile/README.md`. In short: install **Expo Go**, fill in `apps/mobile/.env`, run `npx expo start`, scan the QR code.
Background reminders (when the app is closed) do not work in Expo Go.

## 5. Reminders on the iPhone without an app (recommended)
A notification when you arrive at a place, a Sunday summary, and your house tasks in Calendar, all using the iPhone's own
Shortcuts and Calendar apps. Follow `docs/REMINDERS.md`.

## 5b. Siri / Action button capture (optional)
Follow `docs/CAPTURE.md`. Create a key in **Settings** first.

## 6. AI features (optional)
Place suggestions, "make this recurring", and tilstandsrapport import. Costs are in `supabase/README.md`.

**Without the command line (dashboard):**
1. Get an API key at <https://console.anthropic.com> and add a few dollars of credit.
2. In Supabase open **Edge Functions**. Add the secret `ANTHROPIC_API_KEY` (look for **Secrets** or **Manage secrets**).
3. **Deploy a new function**, choose the editor, name it exactly `suggest`, paste the whole of `supabase/dashboard/suggest.ts`, and deploy.
4. Do the same for a function named `import-report` with `supabase/dashboard/import-report.ts`.

**With the CLI:** see `supabase/README.md`.

## 7. Background reminders (needs the paid Apple account)
1. Enroll in the Apple Developer Program ($99/year).
2. Run the location test first: `apps/spike/README.md`.
3. Then build the real app with EAS (same steps, `apps/mobile`).

## Your data
**Settings > Export everything** (web) downloads a zip with a readable Markdown file, JSON, and all photos.
