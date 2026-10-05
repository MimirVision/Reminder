# Post: a mail app for your iPhone (a Home Screen web app, free)

Post is a fast, calm replacement for Apple Mail for your **Outlook** accounts (personal and work). It lives at `/post/` on the same web hosting as Home Memory,
you add it to your Home Screen, and it shows **the number on its icon** when new mail has arrived. No Mac, no Sideloadly, no 7-day re-install, nothing paid.

The look is the "A2" design on the canvas: https://claude.ai/artifact/QCFREjFYyX2YG2T91zTQGq

```
New mail arrives in Outlook
   -> Microsoft calls your Supabase function (post-alerts)            within seconds
   -> it decides (a person: yes. a newsletter: no. work account after hours: no)
   -> a Web Push through Apple to the Post icon on your Home Screen
   -> iOS shows the number on the icon (nothing else, if you choose Badges only)
   -> open Post: the number clears, your mail is already there
```

## What it does
- **One inbox for personal and work**, with a small coloured letter on each row. Filters (All, Unread, People, Newsletters, Receipts) only *narrow* the list: nothing is ever hidden, and "Why is this here?" explains each sorting and fixes it for a whole sender in one tap.
- **Fast triage**: swipe right to archive, left to snooze (both configurable), **Undo** on every action, "Archive · next" in the reader, select several at once, and **Triage mode** (one message at a time: Archive, Snooze, Reply later, Reply now).
- **The number on the icon**, with **alert hours per account** (for example work only Mon to Fri 07:30 to 17:00) and a **VIP list** that always gets through.
- **Mail to reminder**: "Remind me" in the reader finds the date in the message and hands it to Home Memory.
- **Search** that runs on the phone (instant, works offline, understands æ ø å) with `from:`, `is:unread`, `has:attachment`, `in:newsletters`, `account:work`, plus a button to search all of Outlook.
- **Privacy**: remote images (tracking pixels) blocked until you tap Load once, no read receipts, no "Sent from Post", and your mail is shown in a sandbox that cannot run scripts.
- **Reliable**: opens instantly from what is on the phone, works offline, every action waits safely in a queue until Outlook confirms it, drafts are saved as you type, and a mail you sent is held for the undo window even if you close the app.
- Light, dark and pure-black themes, 8 accent colours, three row sizes, a colour per account.

## The honest limits
- **iPhone, iOS 16.4 or newer**, and the icon number only works from the **Home Screen icon**.
- **The number counts alerts since you last opened Post.** iOS only lets a web app change its number when a notification is delivered, so the number **cannot go down by itself** if you read mail elsewhere (Outlook on your PC). It corrects as soon as you open Post, and reading mail inside Post clears it.
- iOS requires every web push to be a notification. If you choose **Badges only** in iOS Settings (below) you will see just the number, no banners, no sounds.
- Microsoft's sign-in page does not work inside a Home Screen app, so **adding an account is done in Safari** (the app gives you a link). You do it once per account.
- Your own Supabase keeps an **encrypted sign-in** for each account (so it can see new mail arriving, and so the app does not have to ask you to sign in every day). It is yours, and "Remove" in Post deletes it.
- Not in this version: conversation threads, attachments in compose, Outlook folders other than Inbox/Archive/Deleted, rules, Gmail/iCloud (Outlook only for now).
- **Work accounts** (Microsoft 365): your employer may need to approve the app. If the sign-in says "approval required", that is why.

## One-time setup (about 30 minutes)
You already have Supabase and the web hosting for Home Memory, and the Web Push keys from `docs/NOTIFICATIONS.md`. This reuses them.

### 1. Microsoft (Azure) registration
1. Open https://entra.microsoft.com, sign in with your personal Microsoft account. Microsoft may ask you to create a free directory first; follow the prompts.
2. **App registrations, New registration**: name `Post`. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   Redirect URI: platform **Mobile and desktop applications** (not "Single-page application": those sign-ins expire after 24 hours, these last 90 days), value `https://<your web address>/post/` (with the slash at the end).
3. Copy the **Application (client) ID**.
4. **API permissions, Add a permission, Microsoft Graph, Delegated**: `User.Read`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `offline_access`.
5. **Authentication**: **Allow public client flows: Yes**. Save.

### 2. Supabase
1. **Database.** Run `supabase/upgrade.sql` in the SQL Editor (adds three server-only tables). Safe to repeat.
2. **Secrets** (Edge Functions, Secrets):
   - `POST_ALERTS_KEY` = a long random password you make up
   - `ALERTS_ENC_KEY` = 32 random bytes as base64url. Make one by pasting this into a browser console (F12): `btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')`
   - `MS_CLIENT_ID` = the Application (client) ID from step 1
   - (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` are already there from Home Memory notifications)
3. **The function.** Edge Functions, Deploy a new function, Via Editor: name `post-alerts`, paste all of `supabase/dashboard/post-alerts.ts`, **turn "Verify JWT" OFF**. Deploy.
   Its address is `https://<your project>.supabase.co/functions/v1/post-alerts`.
4. **Keep it alive.** Integrations, Cron, Create job: name `post-alerts-renew`, schedule `0 */6 * * *`, type Supabase Edge Function, function `post-alerts`, POST, header `x-alerts-key` = your `POST_ALERTS_KEY`, body `{"op":"renew"}`.

### 3. The web app
It deploys with the rest of the site (Netlify or Cloudflare, same as Home Memory): push this branch / merge it and the page appears at `https://<your web address>/post/`.

### 4. Your phone (about 5 minutes)
1. In **Safari**, open `https://<your web address>/post/`. First run asks for a **setup code**. If you do not have one, tap *Type the three values* and enter the alert server address, your `POST_ALERTS_KEY` and the Azure client ID. (The app shows the exact redirect address to register in Azure.)
2. Type your email address and tap **Continue with Microsoft**. Do the same for your second account from the account sheet (tap your initial at the top right, **Add account**).
3. Tap Share, **Add to Home Screen**, then open **Post** from the new icon. It asks for the setup code once: tap *Copy setup code* in Safari first (the Connected screen has the button), then **Paste** in Post.
4. In Post: Settings, **Icon number & alerts**, **Turn on the icon number**, allow notifications.
5. iPhone Settings, Notifications, **Post**: turn on **Badges**; turn off Lock Screen, Notification Centre, Banners and Sounds if you only want the number.
6. Settings, Alerts, **Send a test alert**: the icon number should go up by one in a few seconds. Open Post: it goes back to zero.

## The evening test (30 minutes): is this better than Apple Mail?
Do these in order. If one fails, tell me which and what you saw.
1. Sign in with both accounts (personal and work). Did work approve? ✔/✘
2. Lock the phone, send yourself a mail from another address. Does the number appear on the icon within ~10 seconds? Time it.
3. Send one from a newsletter-looking address (or a work-hours check after 17:00 on the work account): no number, as set?
4. Clear 20 mails: swipe, Undo, Archive · next, Triage mode. Faster than Apple Mail?
5. Airplane mode: does it still open and show your mail? Archive one: does it go through when you are back online?
6. Reply to a mail and send it. Did Outlook (on a PC, or Sent Items) show it?

If 1 or 2 fail, the fallback is the sideloaded native app (parked in `apps/mail`, see `docs/MAIL.md`), or a $99 Apple Developer account for real push.

## Troubleshooting
- **"The redirect address is not set up in Azure"**: the redirect URI must be exactly `https://<your web address>/post/` under *Mobile and desktop applications*.
- **"Your organisation needs to approve Post"**: ask your IT admin to grant consent for the app, or use the account without it.
- **Banner "Sign in again"**: Microsoft revoked the sign-in (password change, policy). Tap Sign in; nothing is lost.
- **No number appears**: Settings, Icon number & alerts shows three checks (on Home Screen, notifications allowed, server answers). Supabase, Edge Functions, `post-alerts`, Logs show each decision ("alerted (a person)", "skipped: bulk mail", "skipped: outside this account's alert hours").
- **The number stays after you read mail elsewhere**: see the honest limits. Open Post to clear it.
- The status of each watched mailbox (and "last alert 3 min ago") is under Settings, Icon number & alerts, Watching.

## For developers
- `apps/web/src/post/core/` has no browser or React code and is tested in Node: `cd apps/web && npm test` (Graph client with retries and token refresh, delta sync, undo queue, outbox, classification, search, snooze, sign-in, the controller against a fake Outlook).
- `apps/web/src/post/ui/` are the screens; `idb.ts` is the IndexedDB store; `push.ts` the push and icon number code; `public/post/sw.js` the service worker.
- `supabase/functions/post-alerts/` is the server (change notifications, alert rules, token minting); `npm test` in `supabase/`.
- The native sideloaded build (`apps/mail`, `docs/MAIL.md`) is parked, not deleted.
