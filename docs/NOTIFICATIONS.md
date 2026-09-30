# Notifications when your partner adds a to-do

When one of you adds a to-do, the other's phone (or PC) gets a notification: "Anna added: Milk". It uses Web Push, so it
works from the web app with no native app and no Apple developer account. Each person turns it on for their own device.

It needs a one-time setup (about ten minutes) and the phone must have the web app on its **home screen** (iPhone: iOS 16.4 or
newer, Safari, Share, "Add to Home Screen", then open Home Memory from the home screen icon).

## 1. Make the two keys
1. Open any web page in Chrome or Edge on your computer, press **F12**, choose the **Console** tab.
2. Open `docs/generate-vapid-keys.js` from this repository, copy everything in it, paste it into the console, press Enter.
3. It prints two lines: `VAPID_PUBLIC_KEY=...` and `VAPID_PRIVATE_KEY=...`. Keep that window open for the next steps.
   The private key is a secret: never put it in the repository or in the Netlify variables.

## 2. Supabase
1. Run `supabase/upgrade.sql` in the SQL Editor (it adds the table for subscriptions). Safe to run again.
2. **Edge Functions**, **Secrets** (or Project Settings, Edge Functions): add
   - `VAPID_PUBLIC_KEY` = the public key
   - `VAPID_PRIVATE_KEY` = the private key
   - `VAPID_SUBJECT` = `mailto:your@email.address` (optional but polite: the push services use it to contact you)
3. **Edge Functions**, **Deploy a new function**, **Via Editor**: name it `notify-partner`, paste the whole file
   `supabase/dashboard/notify-partner.ts`, deploy. Leave "Verify JWT" on.

## 3. Netlify
Site configuration, **Environment variables**: add `VITE_VAPID_PUBLIC_KEY` = the public key (the same one). Then **Deploys**,
**Trigger deploy**, so the app is rebuilt with it.

## 4. Each phone
Open Home Memory (from the home screen icon on iPhone), **Settings**, **Notifications**, **Turn on notifications**, allow.
Do this on both phones. You only hear about things your partner adds, never your own.

## Good to know
- Nothing is sent by the web app while the key is missing, and nothing breaks: the switch in Settings just says it is not set up.
- To-dos added through a Siri/Shortcut capture key do not notify (they do not go through the app).
- If a phone stays quiet: check iOS Settings, Notifications, Home Memory; make sure it was opened from the home screen icon; turn
  notifications off and on again in Settings.
- The text of the to-do is sent through Apple's or Google's push service, encrypted so only your phone can read it.
