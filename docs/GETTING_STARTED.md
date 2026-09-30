# Getting started

Everything you need to run Home Memory, in the order to do it. No Apple developer account is needed for steps 1 to 4.

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
```powershell
cd apps\web
npm run build
```
Drag the `dist` folder onto <https://app.netlify.com/drop> (or connect the repo to Netlify; `netlify.toml` is set up).
On the iPhone open the link in Safari > Share > **Add to Home Screen**. When you and your partner both have accounts, turn off
"Allow new users to sign up" in Supabase (Authentication).

## 4. The real phone app in Expo Go (free)
See `apps/mobile/README.md`. In short: install **Expo Go**, fill in `apps/mobile/.env`, run `npx expo start`, scan the QR code.
Background reminders (when the app is closed) do not work in Expo Go.

## 5. Siri / Action button capture (optional)
Follow `docs/CAPTURE.md`. Create a key in **Settings** first.

## 6. AI features (optional)
Place suggestions, "make this recurring", and tilstandsrapport import. Steps and costs are in `supabase/README.md`.

## 7. Background reminders (needs the paid Apple account)
1. Enroll in the Apple Developer Program ($99/year).
2. Run the location test first: `apps/spike/README.md`.
3. Then build the real app with EAS (same steps, `apps/mobile`).

## Your data
**Settings > Export everything** (web) downloads a zip with a readable Markdown file, JSON, and all photos.
