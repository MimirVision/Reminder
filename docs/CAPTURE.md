# Quick capture with iOS Shortcuts (Siri, Action button, share sheet)

The fastest way to get something into Home Memory is a Shortcut that posts text straight to your household
inbox. It needs no app to open, works by voice, and also works from your wife's phone (give her her own key).

## 1. Get a capture key
In the app: **Settings → Create capture key** (web app: **Capture** tab). The key looks like `hm_…` and is shown
once. Treat it like a password. You can revoke it any time; revoking it stops the shortcut.

## 2. Build the Shortcut ("Remember")
In the **Shortcuts** app on iPhone: **+** → add these actions:

1. **Ask for Input** — type *Text*, prompt "Remember what?" (dictation works, so Siri can take a spoken note).
2. **Get Contents of URL**
   - URL: `https://<your-project>.supabase.co/rest/v1/rpc/capture_memory`
   - Method: **POST**
   - Headers:
     - `apikey` = your project's publishable key
     - `Content-Type` = `application/json`
   - Request Body: **JSON** with two fields:
     - `p_key` (Text) = your capture key
     - `p_body` (Text) = *Provided Input* (the result of step 1)
3. (Optional) **Show Notification** "Saved".

Name it **Remember**. Then:

- **Siri:** "Hey Siri, Remember" → speak the note.
- **Action button** (iPhone 15 Pro and later): Settings → Action Button → Shortcut → Remember.
- **Other iPhones:** add the Shortcut as a Lock Screen widget, a Control Center control, or Back Tap
  (Settings → Accessibility → Touch → Back Tap).
- **Share sheet:** in the Shortcut's details turn on *Show in Share Sheet* (accept Text and URLs) and replace
  step 1 with *Shortcut Input*. Then "Share → Remember" saves a web page or note.

## Notes
- To-dos land in the inbox with no place attached; attach a place in the app or on the web.
- If Shortcuts reports `401`, also add the header `Authorization` = `Bearer <publishable key>` and tell me, so I can
  adjust the docs.
- The same request works from Windows (PowerShell `Invoke-RestMethod`, AutoHotkey, etc.).

## Sharing into the web app
Once Home Memory is installed as an app on **Android or Windows** (Chrome or Edge: menu, "Install app"), it appears in the
system Share menu: share a page or text to "Home Memory" and the add sheet opens with it ready to save. **iPhone Safari does not
support this**, so on an iPhone use the Shortcut above ("Show in Share Sheet"), which does the same job.
