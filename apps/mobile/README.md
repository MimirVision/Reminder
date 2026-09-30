# Home Memory iPhone app (Milestone 1)

Expo (SDK 57) + expo-router. Capture (text, photos, offline queue), places (specific and "any pharmacy"), place
reminders via iOS geofencing, notification actions, "What's near me?" pull view, capture keys.

- `src/core` — pure TypeScript reminder logic with tests: `npm test`
- `src/lib` — Supabase client, outbox (offline queue), reminders + background task
- `src/app` — screens

```powershell
cd apps\mobile
npm install
copy .env.example .env     # Supabase URL + publishable key
npm run typecheck
npm test
```

## Running it
- **Without paying Apple:** the UI (capture, lists, places, settings) runs in Expo Go: `npx expo start`. Background
  place reminders do **not** work in Expo Go.
- **With the paid account:** `npx eas-cli build --platform ios --profile preview` (see `apps/spike/README.md` for the
  EAS steps), then install on the registered iPhone. Set `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` as EAS environment variables/secrets for the build.

## Status
Type-checks, unit tests pass and the iOS JS bundle builds. **Not yet run on a device**; expect first-run fixes.
Known gaps: no background push between partners, notification "Done" opens the app, no AI suggestions yet.
