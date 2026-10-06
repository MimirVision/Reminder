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
- **One inbox for personal and work**, with a small coloured letter on each row. Mail is sorted into four tabs like iOS Mail: **Primary** (people), **Transactions** (receipts, invoices, bookings), **Updates** (alerts and notifications) and **Promotions** (offers and newsletters, with a **Clean up** button), plus **All**. Sorting reads the sender, the subject, and the hidden bulk-mail marks in each message's headers, and it learns the people you have written to. Nothing is ever hidden: **All** shows everything, and "Why is this here?" explains each sorting and moves a sender (or a whole company) to another tab in one tap. Settings, Sorting lists your rules and can copy a privacy-safe report.
- **Who it is from**: the reader shows the sender's name and their **full address**, and one tap on the address copies it. Your own address is left out unless you have several accounts connected (then it shows which account a message is in).
- **Conversations**: messages that answer each other are **one row** in the list (a small number says how many) and **one conversation** when you open it. The newest message is open and the older ones are folded up under it (tap one to read it). **Your own answers are in it too**, marked "You", because Post fetches them from your Sent Items. Under each open message are **Reply**, **Reply all** and **Forward** for that very message (the Reply at the bottom answers the newest message that is not yours). Archive, delete, snooze, flag and read/unread take the **whole conversation** with one **Undo**, and a new answer brings a snoozed conversation back. **Clean up** in Promotions works on the rows you see there, so a conversation goes as a whole, and never one that has a flagged message in it. The rest of a conversation (your answers, messages archived or in other folders, mail older than what is on the phone) comes from Outlook when you open it, never from Drafts, Deleted Items or Junk, and is **not saved on the phone**. Settings, **Conversations**, **Group replies together** turns all of this off, and every message gets its own row again.
- **Files, both ways**: every file on a message is listed. **PDFs, pictures and text files open inside Post**; Word, Excel, zip and the rest are saved or opened in another app with one tap (on an iPhone that is the share sheet, with Save to Files). To send files, tap the paperclip in a new message, a reply or a forward (or drag files in, or paste a picture on a computer). Up to **20 MB** per message; files over 3 MB go to Outlook in slices, and **Undo** gives the message and its files back.
- **Fast triage**: swipe right to archive, left to snooze (both configurable), **Undo** on every action, "Archive · next" in the reader, select several at once, and **Triage mode** (one message at a time: Archive, Snooze, Reply later, Reply now).
- **The number on the icon**, with **alert hours per account** (for example work only Mon to Fri 07:30 to 17:00) and a **VIP list** that always gets through.
- **Mail to reminder**: "Remind me" in the reader finds the date in the message and hands it to Home Memory.
- **Search** that runs on the phone (instant, works offline, understands æ ø å) with `from:`, `is:unread`, `has:attachment`, `in:promotions` (or primary, transactions, updates), `account:work`, plus a button to search all of Outlook (those results open too, so you can read, reply to or forward an old message).
- **Privacy**: remote images (tracking pixels) blocked until you tap Load once, no read receipts, no "Sent from Post", and your mail is shown in a sandbox that cannot run scripts.
- **Reliable**: opens instantly from what is on the phone (a slow or broken network opens the saved copy after three seconds), works offline, and every action waits safely in a queue until Outlook confirms it. **A message goes out exactly once**: it is made as a draft at Outlook first, so if the answer to "send" is lost on the way back Post asks Outlook what happened instead of sending again. Every call to Outlook and to your server has a time limit, so one stuck connection can never freeze Post. Drafts are saved as you type. When you leave Post (another app, the lock screen, closing it) what is waiting for its undo time goes at once, because an iPhone may not run Post again for hours. If the phone refuses to keep Post's copy of your mail, Post says so and keeps working. A screen that breaks shows a way out, not a white page. **Settings, Health** says in plain words how Post is doing, fixes the usual things, and copies a problem report with no mail in it.
- Light, dark and pure-black themes, 8 accent colours, three row sizes, a colour per account.
- **Phone and computer**: on a window wider than about 900 px Post shows a sidebar, the message list and the reading pane side by side, with keyboard shortcuts (`j`/`k`, `e` archive, `r` reply, `c` write, `/` search, `?` for the list).

## The honest limits
- **iPhone, iOS 16.4 or newer**, and the icon number only works from the **Home Screen icon**.
- **The number counts alerts since you last opened Post.** iOS only lets a web app change its number when a notification is delivered, so the number **cannot go down by itself** if you read mail elsewhere (Outlook on your PC). It corrects as soon as you open Post, and reading mail inside Post clears it.
- iOS requires every web push to be a notification. If you choose **Badges only** in iOS Settings (below) you will see just the number, no banners, no sounds.
- Each device signs in on its own (Safari and the Home Screen icon do not share a sign-in on iPhone), so the first time you open the Home Screen icon you press the same button again. It takes ten seconds.
- Google/Gmail and iCloud are not supported yet: **Continue with Microsoft** is the only button, because Outlook is what Post is built for.
- Your own Supabase keeps an **encrypted sign-in** for each account (so it can see new mail arriving, and so the app does not have to ask you to sign in every day). It is yours, and removing the account in Post deletes it. A device proves it belongs to a mailbox with a secret it gets at sign-in (only a hash is stored); only the addresses you allow (`post_setup` / `post_allow`) can sign in at all.
- **Undo lasts while Post is on screen.** The moment you leave Post, what waits for its undo time is sent, so a message you write and then walk away from is never stuck on a phone that has put Post to sleep. On a computer, switching to another tab does not send early; closing the tab does. (Settings says this under Undo send.)
- **A draft can be left behind in rare cases.** A message is made as a draft at Outlook before it is sent. If the connection drops at the very moment the draft is made, Outlook may keep a draft that Post never sent; it is harmless and can be deleted in Outlook's Drafts.
- **Files**: an iPhone gives a Home Screen app no way to keep a half-sent upload alive in the background, so for a big file keep Post open until it says Sent (a message with files that cannot be sent is handed back as a draft with its files and the reason). Word, Excel and PowerPoint files are not drawn by Post; they are saved or opened in the apps that can.
- **Conversations** follow the conversation Outlook itself reports, so if someone changes the subject and Outlook starts a new conversation, it is a new row. Post fetches at most 100 messages of one conversation from Outlook (it does not choose which, so a thread longer than that may miss some older ones). Your own answers and older messages are fetched when you open it, so without a connection you see the messages that are on the phone and a note with **Try again**. Replying from a conversation answers the newest message that is not yours.
- Not in this version: Outlook folders other than Inbox/Archive/Deleted, rules, Gmail/iCloud (Outlook only for now).
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
7. Open a mail you have answered before. Is your own answer in the conversation, marked "You", and are the older messages folded up? Archive the whole conversation, then **Undo**: do all of it come back?
8. Write a mail and send it, then switch to another app at once. A few seconds later it should be in Sent Items (check on a PC), and Undo should say it is too late when you come back.
9. Airplane mode: send a mail, close Post, turn airplane mode off, open Post. The mail goes once, not twice.
10. Settings, **Health**: does it say "Everything looks fine"? Tap **Copy problem report** and read it: there should be versions, times and counts, and nothing from your mail.

If 1 or 2 fail, the fallback is the sideloaded native app (parked in `apps/mail`, see `docs/MAIL.md`), or a $99 Apple Developer account for real push.

## Troubleshooting
- **"The redirect address is not set up in Azure"**: the redirect URI must be exactly `https://<your web address>/post/` under *Mobile and desktop applications*.
- **"Your organisation needs to approve Post"**: ask your IT admin to grant consent for the app, or use the account without it.
- **"… is not on this server's allowed list"**: run `select post_allow('that address');` in the Supabase SQL editor (then try again).
- **"Post's server has no Microsoft client ID yet"**: run `select post_setup('<client id>', 'you@outlook.com');` in the Supabase SQL editor (step 2).
- **"Supabase is blocking Post's server"**: **Verify JWT** is still on for the function. In Supabase open Edge Functions, `post-alerts`, turn **Verify JWT** off, and try again.
- **A big file does not send**: Post first tries to hand the file to Outlook straight from the browser, and if the browser is not allowed to, through this site's own address `/api/post-upload` (it only passes on slices of files to Outlook's upload address, nothing else). If both fail, the message comes back as a draft with its files and the reason shown. After updating, make sure the latest version of the site has been published (it is part of the same Cloudflare deploy as Post).
- **"The list of files could not be loaded"** under a sender: Outlook did not answer; tap **Try again**.
- **"Could not look for the rest of this conversation"**: Outlook did not answer (or you are offline). The messages on the phone are shown; tap **Try again**.
- **A conversation is missing your own answer**: only answers Outlook has in Sent Items (or another folder except Drafts, Deleted Items and Junk) are fetched, and Post fetches at most 100 messages of a conversation. If someone changed the subject, Outlook may have started a new conversation.
- **Settings, Alerts says "Mail only"**: Microsoft would not start new-mail alerts for that mailbox; the reason is shown under it, and your mail works as normal. Post tries again every 6 hours and whenever you open it.
- **Banner "Sign in again"**: Microsoft revoked the sign-in (password change, policy). Tap Sign in; nothing is lost.
- **No number appears**: Settings, Icon number & alerts shows three checks (on Home Screen, notifications allowed, server answers). Supabase, Edge Functions, `post-alerts`, Logs show each decision ("alerted (a person)", "skipped: bulk mail", "skipped: outside this account's alert hours").
- **The number stays after you read mail elsewhere**: see the honest limits. Open Post to clear it.
- **Something is not right**: open Settings, **Health**. The top says what needs a look (a mailbox that needs a sign-in, a message that has been waiting to be sent, a read of your mail that failed, the phone running out of room). **Read my mail now** reads again, **Read all mail again from Outlook** starts the inbox over (what waits to be sent is kept) and is the cure when the phone shows something different from Outlook, **Start Post over** loads Post's own files again (mail and settings are not touched), and **Copy problem report** copies versions, times and counts, never subjects, names, addresses or message text.
- **"Post cannot save on this phone right now"**: the phone or browser would not give Post storage (private browsing, blocked site data, a full phone). Everything still works and your mail is safe in Outlook, but what you do is kept only until Post is closed. Closing Post completely and opening it again usually fixes it; a private browser window never keeps anything.
- **"Something went wrong on this screen"**: **Back to the inbox** tries again, **Read my mail again** rebuilds the list from Outlook, **Start Post over** loads Post afresh. If it keeps happening, **Copy problem report** and send it.
- **A message is not going out**: the inbox says "waiting to be sent" and Health says for how long. Post tries every minute while it is open, and again whenever you come back to it.
- The status of each watched mailbox (and "last alert 3 min ago") is under Settings, Icon number & alerts, Watching.

## For developers
- `apps/web/src/post/core/` has no browser or React code and is tested in Node: `cd apps/web && npm test` (Graph client with retries and token refresh, delta sync, undo queue, outbox, classification, search, snooze, conversations, sign-in, the controller against a fake Outlook).
- Conversations: `core/threads.ts` groups messages by account and Outlook's `conversationId` (pure, tested in `threads.test.ts`); the inbox, Later and the counts are built from those groups in `core/controller.ts` (`visibleThreads`, `mailCounts`). The rest of a conversation is `graph.conversation()` (`GET /me/messages?$filter=conversationId eq '…'`, never `$orderby`, which Microsoft refuses) and `controller.loadConversation()`; those messages are kept in memory only and are marked `folder: 'archive'` ("not in the inbox on this phone").
- Reliability: every call has a time limit (`core/graph.ts` `within()`: Graph 30 s, files and long jobs four times that; `core/server.ts` 20 s; the answer is read inside the limit), and a call that changes something (`send`) is never repeated blindly (`once`). All sending goes through `graph.deliver()`: make a draft, add files one by one (checking what is already on the draft after a lost answer), ask Outlook to send once; its progress (`made`, `sending`) is saved with the message in the outbox so a try that was cut short is carried on, never repeated, and a draft that is gone after "sending" means it went. `core/queue.ts` runs one flush at a time and reports a moved message's new name (`onMoved`, so a reply waiting for a message that was archived follows it) and an action Outlook refuses for good (`onRefused`, which reads that mailbox again and tells you). `controller.leaving()` first waits for what was tapped a moment ago to be written down on the phone (an archive, a message with big files), then sends everything at once (the queue first, then the outbox); the app calls it on `pagehide`, and on `visibilitychange` to hidden on touch screens only. Both single-flight runs (`queue.flush`, `flushOutbox`) let go of their place in the same breath as their last look at the list, so a run asked for while they finish is never answered by one that has already looked. `core/resilient.ts` wraps the IndexedDB store: a lost connection is opened again and the job repeated once; storage that will not come back is replaced by memory for the visit (`state.storage`, the Inbox banner). `core/diag.ts` is the list of what went wrong (addresses taken out of every text), `core/health.ts` turns state into the Health page's findings and the problem report, `ui/Crash.tsx` is the error boundary and `ui/recover.ts` the plain-DOM "could not start" screen. The service worker (`public/post/sw.js`) opens the saved copy of the app after three seconds of silence, or at once when the server answers with a 5xx.
- `apps/web/src/post/ui/` are the screens (`Attachments.tsx` the file list and viewer, `pdf.ts` the lazily loaded PDF drawing); `idb.ts` is the IndexedDB store; `push.ts` the push and icon number code; `public/post/sw.js` the service worker.
- `apps/web/worker/upload-relay.js` is the one place where this site's own server touches mail: it passes a slice of a big attachment to Outlook's upload address when the browser may not (tested in `upload-relay.test.mjs`, run by `npm test`).
- `supabase/functions/post-alerts/` is the server (sign-in, sessions, change notifications, alert rules, token minting); `npm test` in `supabase/`.
- The native sideloaded build (`apps/mail`, `docs/MAIL.md`) is parked, not deleted.
