# Home Memory

A personal "external memory" for a house and the errands around it. See `docs/DESIGN.md` for the vision, design
principles, data model and roadmap.

| Path | What |
|---|---|
| `docs/GETTING_STARTED.md` | Step by step: Supabase, web, phone, Siri, AI |
| `docs/DESIGN.md` | Product and technical design |
| `apps/spike` | Milestone 0: iOS geofence reliability test (Expo) |
| `apps/web` | Milestone 1: web app for desktop and the spouse's phone |
| `apps/mobile` | iPhone app (Expo): to-dos with dates, place search, repeat, Norwegian/English, light/dark, place reminders; needs a paid Apple account for background place reminders. Shares its logic with the web app (`scripts/sync-shared.mjs`) |
| `apps/mail` | Post, a mail app to replace Apple Mail (Expo, sideloaded). Currently the step 1 "can this work?" build; see `docs/MAIL.md`; research and audit in `docs/MAIL_AUDIT.md` |
| `docs/REMINDERS.md` | Reminders on the iPhone without an app (Shortcuts + Calendar) |
| `docs/CAPTURE.md` | Siri / Action button / share-sheet capture recipe |
| `supabase` | Milestone 1: database schema, RLS and tests |
