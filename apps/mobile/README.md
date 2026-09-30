# Home Memory iPhone app

Expo (SDK 57) + expo-router. Design E: **To-do** list with a Map toggle, Liquid Glass tab bar and add bar, "Are you here?"
prompt, store lists, House maintenance calendar, Places, Settings.

- `src/core`: pure TypeScript reminder and maintenance logic with tests (`npm test`)
- `src/lib`: Supabase client, offline outbox, reminders + background task, glass and UI components
- `src/app`: screens

## Try it on your iPhone (free, no Apple developer account)

You need the Supabase project set up first (see `../../supabase/README.md`: paste `setup.sql`, turn off "Confirm email").

1. On your iPhone install **Expo Go** from the App Store.
2. On your PC, in this folder:
   ```powershell
   npm install
   copy .env.example .env      # then edit .env: Supabase URL and publishable key
   npx expo start
   ```
3. Scan the QR code with the iPhone Camera app; it opens in Expo Go. PC and phone must be on the same Wi-Fi.
   If that fails (firewalls, guest Wi-Fi) use `npx expo start --tunnel`.
4. Create an account, create a household, add places, add to-dos, try the Map toggle.

What works in Expo Go: sign-in, to-dos with photos, offline queue, places, the map, House calendar, the "Are you here?"
card **while the app is open**, Liquid Glass (on iOS 26 and later; older versions get a blur).
What does not: background place reminders (notifications when the app is closed). Those need a real build, which needs
the paid Apple account (`apps/spike/README.md` has the EAS steps).

Expo Go must support the app's SDK (57). If the App Store version of Expo Go says the project is incompatible, tell me
and we will switch route.

## Glass
Settings has a "Glass" control: Clear, Glass, Frosted. On iOS 26+ Clear and Glass use the system Liquid Glass;
Frosted (and older iOS) use a blur with a wash for readability.

## Status
Type-checks, unit tests pass and the iOS JS bundle builds. Not yet run on a device; expect first-run fixes.
Known gaps: no background push between partners; notification "Done" opens the app; no AI suggestions yet.
