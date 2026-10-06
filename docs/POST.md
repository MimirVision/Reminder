# Post: a mail app for your iPhone (a Home Screen web app, free)

Post is a fast, calm replacement for Apple Mail for your **Outlook** accounts (personal and work). It lives at `/post/` on the same web hosting as Home Memory.
On a phone you add it to your Home Screen and it shows **the number on its icon** when new mail has arrived; on a computer it is a three-pane mail app with keyboard shortcuts.
You sign in with one button, **Continue with Microsoft**, the same on a phone and a computer. No Mac, no Sideloadly, no 7-day re-install, nothing paid.

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
- **Phone and computer**: on a window wider than about 900 px Post shows a sidebar, the message list and the reading pane side by side, with keyboard shortcuts (`j`/`k`, `e` archive, `r` reply, `c` write, `/` search, `?` for the list).

## The honest limits
- **iPhone, iOS 16.4 or newer**, and the icon number only works from the **Home Screen icon**.
- **The number counts alerts since you last opened Post.** iOS only lets a web app change its number when a notification is delivered, so the number **cannot go down by itself** if you read mail elsewhere (Outlook on your PC). It corrects as soon as you open Post, and reading mail inside Post clears it.
- iOS requires every web push to be a notification. If you choose **Badges only** in iOS Settings (below) you will see just the number, no banners, no sounds.
- Each device signs in on its own (Safari and the Home Screen icon do not share a sign-in on iPhone), so the first time you open the Home Screen icon you press the same button again. It takes ten seconds.
- Google/Gmail and iCloud are not supported yet: **Continue with Microsoft** is the only button, because Outlook is what Post is built for.
- Your own Supabase keeps an **encrypted sign-in** for each account (so it can see new mail arriving, and so the app does not have to ask you to sign in every day). It is yours, and removing the account in Post deletes it. A device proves it belongs to a mailbox with a secret it gets at sign-in (only a hash is stored); only the addresses you allow (`post_setup` / `post_allow`) can sign in at all.
- Not in this version: conversation threads, attachments in compose, Outlook folders other than Inbox/Archive/Deleted, rules, Gmail/iCloud (Outlook only for now).
- **Work accounts** (Microsoft 365): your employer may need to approve the app. If the sign-in says "approval required", that is why.

## One-time setup (about 15 minutes, once, for everyone who will use it)
Four steps. There are no secrets to type into Supabase and no schedule to create: the database does both, and the app finds its server by itself.

### 1. Microsoft: get a client ID
Microsoft will only let an app sign people in once the app is registered, and registering needs a Microsoft Entra directory (a "tenant").
- **You have a work or school Microsoft 365 account that lets you register apps:** use it, or skip to "The portal way" below.
- **You only have a personal account (Outlook.com, Hotmail, Live):** a personal account has no directory, so the registration form is closed to it. The free fix is a free Azure account, which creates a directory for you: https://azure.microsoft.com/free, sign in with your personal Microsoft account. It asks for a phone number and a card as an identity check (a temporary hold, no charge). Registering an app costs nothing, now or after the free period ends. This is a Microsoft rule, not something Post can work around.

Then register the app with one command:
1. Open **Azure Cloud Shell**: https://shell.azure.com, choose **Bash**. It is already signed in as you.
2. Paste `scripts/post-azure.sh` (or its text) and run it with the address of Post: `bash post-azure.sh https://<your web address>/post/` (the slash at the end matters).
3. It prints your **Application (client) ID**. That is all Microsoft needs.

<details><summary>The portal way, if you prefer clicking</summary>

1. https://entra.microsoft.com, **App registrations, New registration**: name `Post`, supported account types **Accounts in any organizational directory and personal Microsoft accounts**, redirect URI platform **Mobile and desktop applications** (not "Single-page application": those sign-ins expire after 24 hours, these last 90 days) with value `https://<your web address>/post/`.
2. **API permissions, Add a permission, Microsoft Graph, Delegated**: `User.Read`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `offline_access`.
3. **Authentication**: **Allow public client flows: Yes**. Save. Copy the **Application (client) ID**.
</details>

### 2. Supabase: the database
In the Supabase SQL Editor run `supabase/post.sql` (only Post's own tables and helpers; safe to repeat), then:

```sql
select post_setup('<your Application (client) ID>', 'you@outlook.com');
```
That stores the client ID and the address that may sign in (use the address Microsoft reports; if one is refused the message says which). To let another mailbox in later: `select post_allow('you@yourfirm.no');`. Only addresses on that list can sign in at all, so a stranger who finds your server cannot register a mailbox or receive alerts.

### 3. Supabase: the server
Edge Functions, **Deploy a new function, Via Editor**: name `post-alerts`, paste all of `supabase/dashboard/post-alerts.ts`, turn **Verify JWT OFF**, Deploy. (Updating? Paste it again over the old one.)

The function makes what it needs by itself the first time it runs: the key that seals sign-ins is derived from the service role key it already has, the Web Push key pair is generated and kept in the database (or taken from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` if you set them for Home Memory), and the database asks it every 6 hours to renew the alert subscriptions (Microsoft ends them after under 3 days for personal accounts). Opening Post renews them too. If your project has no `pg_cron`, only the opening-Post renewal applies.

Supabase secrets still work and win when present (`MS_CLIENT_ID`, `POST_ALLOWED_EMAILS`, `ALERTS_ENC_KEY`, `POST_ALERTS_KEY`, `VAPID_*`), for anyone who prefers them.

### 4. The web app and every phone and computer
Nothing to set on the web app: it uses the same address Home Memory already has for Supabase (`VITE_SUPABASE_URL`).
1. Open `https://<your web address>/post/` and press **Continue with Microsoft**. That is the whole sign-in. Press it again for your second account (tap your initial at the top right, or "Add account" in the sidebar).
2. **iPhone:** in Safari tap Share, **Add to Home Screen**, then open **Post** from the new icon and press the same button once more (the icon keeps its own sign-in).
3. In Post: Settings, **Icon number & alerts**, **Turn on the icon number**, allow notifications.
4. iPhone Settings, Notifications, **Post**: turn on **Badges**; turn off Lock Screen, Notification Centre, Banners and Sounds if you only want the number.
5. Settings, Alerts, **Send a test alert**: the icon number should go up by one in a few seconds. Open Post: it goes back to zero.

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
- **"… is not on this server's allowed list"**: run `select post_allow('that address');` in the Supabase SQL editor (then try again).
- **"Post's server has no Microsoft client ID yet"**: run `select post_setup('<client id>', 'you@outlook.com');` in the Supabase SQL editor (step 2).
- **Settings, Alerts says "Mail only"**: Microsoft would not start new-mail alerts for that mailbox; the reason is shown under it, and your mail works as normal. Post tries again every 6 hours and whenever you open it.
- **Banner "Sign in again"**: Microsoft revoked the sign-in (password change, policy). Tap Sign in; nothing is lost.
- **No number appears**: Settings, Icon number & alerts shows three checks (on Home Screen, notifications allowed, server answers). Supabase, Edge Functions, `post-alerts`, Logs show each decision ("alerted (a person)", "skipped: bulk mail", "skipped: outside this account's alert hours").
- **The number stays after you read mail elsewhere**: see the honest limits. Open Post to clear it.
- The status of each watched mailbox (and "last alert 3 min ago") is under Settings, Icon number & alerts, Watching.

## For developers
- `apps/web/src/post/core/` has no browser or React code and is tested in Node: `cd apps/web && npm test` (Graph client with retries and token refresh, delta sync, undo queue, outbox, classification, search, snooze, sign-in, the controller against a fake Outlook).
- `apps/web/src/post/ui/` are the screens; `idb.ts` is the IndexedDB store; `push.ts` the push and icon number code; `public/post/sw.js` the service worker.
- `supabase/functions/post-alerts/` is the server (sign-in, sessions, change notifications, alert rules, token minting); `npm test` in `supabase/`.
- The native sideloaded build (`apps/mail`, `docs/MAIL.md`) is parked, not deleted.
