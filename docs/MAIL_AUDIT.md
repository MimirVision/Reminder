# Post: audit of the plan, design and code, against what other mail apps teach us

Written before building the real app, so the expensive mistakes get fixed while they are cheap. Research is from web searches
(sources at the bottom); a few sites were blocked from here, so some points rest on search summaries. Where something is my
inference and not a sourced fact, it says so.

## The seven findings that change the plan

| # | Finding | Change |
|---|---|---|
| 1 | **IMAP for every account is the wrong default.** Gmail's own API gives real labels, Google's thread ids, cheap "what changed since" syncing, and server-side search in a fraction of IMAP's time; IMAP maps labels to folders (duplicates, slow label sync) and Gmail caps IMAP at 15 connections and 2.5 GB/day. Microsoft's Graph API is the same story for Outlook. | Build a `MailProvider` interface with three providers: **Gmail API**, **Microsoft Graph**, **IMAP** (iCloud and anything else). The IMAP engine already built stays, for iCloud. Gmail and Outlook ride on HTTPS: sturdier, works in background tasks, no TCP library involved. |
| 2 | **New-mail alerts decide whether you can leave Apple Mail.** Without push, background refresh runs when iOS feels like it (a few times a day, about 30 s each). Every app that has instant alerts has them via a server that holds your credentials and talks to Apple. | Be upfront (see "Three honest paths"). The helper that watches your inbox and alerts you through the free ntfy app stays in the plan, but it is a decision for after you have lived with the app, not a promise. |
| 3 | **Auto-sorting that hides mail is the #1 complaint about Apple Mail's new design.** Badge only counts "Primary", mail lands in the wrong tab, the order is no longer chronological, and moving a sender is all-or-nothing. Spark is also criticised for calling notifications "newsletters". | Never hide anything. "All" is the default view. Sorting only labels and filters, always shows *why* ("has an unsubscribe link"), and is fixable per sender in one tap. Drop the "needs a reply" detector from the first version. |
| 4 | **Speed and trust are what people pay for.** Superhuman's value is a 100 ms rule on every action; Spark users leave over crashes, sync errors, missing attachments and bad connectivity; Outlook for iPhone is known for lag and battery drain. | A quality bar, not a feature: open instantly from the local database, optimistic actions with undo, never lose a draft or a queued action, show sync problems honestly with Retry. |
| 5 | **Privacy is a feature people notice.** Superhuman was hammered for hidden read-receipt pixels and location logging; Spark stores credentials and some mail on its servers; Canary sells a tracker dashboard. | Blocked remote images by default, no read receipts ever, no "Sent from Post", no mail on any server. The optional alert helper is the only thing that holds a credential, and it is opt-in. |
| 6 | **Four of my assumptions were unproven.** Gmail sign-in lasting past 7 days, the app refusing forged certificates, how often iOS wakes the app, and whether æ/ø/å search works. | Each is now a check in the test build. Two more were added from this audit: *Secure connection* and *Phone runtime*. |
| 7 | **I over-promised in the design.** Send-later cannot work without a server, "Accounts" does not deserve a tab, rows do not show which account a mail belongs to, and there is no first-run, empty, error or expired-sign-in screen. | See "Design: keep, change, add, cut". |

## What the other apps get right and wrong

| App | Loved | Hated | We take |
|---|---|---|---|
| **Apple Mail** (iOS 18.2/26) | Native, instant, push, Mail Privacy Protection, send later, "Remind Me", undo send, summaries | Categories mis-sort and hide mail; badge counts Primary only; no true snooze (the mail stays in the inbox), no templates, no tracking controls, weak rules | Match its speed and native feel; beat it on snooze, search, triage, per-sender control |
| **Spark** | Smart inbox, free tier, good design, shared inboxes | Slowdowns and crashes after redesigns, sync errors, attachments failing, weak connectivity handling, forced signature, mis-classification, server copies | Its look-and-feel ambition; avoid every one of its failures |
| **Superhuman** | Speed, split inbox, snippets, reminders, undo, command palette | $25-30/month, no unified inbox, only Gmail and Microsoft 365, the 2019 tracking scandal | Speed discipline, snippets, follow-up reminders; unified inbox (we have it) |
| **HEY** | The Screener, Paper Trail for receipts, Feed for newsletters | Learning curve, setup work, per-address only, no IMAP, $99/year | Receipts and newsletters kept out of the way, but *without* forcing a new workflow |
| **Outlook** | Works with Microsoft 365 | Slow, battery drain, clutter | Nothing to copy; do not become this |
| **Canary** | On-device AI, tracker dashboard, read-receipt blocking | Gmail labels become folders (IMAP), slow on older phones, AI is paid | Tracker transparency; the Gmail-API point |
| **Fastmail** | Solid, fast, many swipe options | Needs a Fastmail account | Swipe configurability, kept to a few sensible options |
| **Airmail** | Power-user control | Complexity (my reading of the MacStories review; the page was blocked) | Few settings, strong defaults |

## Audit of what exists

### Code (`apps/mail`)
**Fixed during this audit (with tests that failed first):**
- A fixed 20-second timeout would have killed any long download. It now measures *silence*, not total time.
- The response reader copied the whole buffer for every chunk: a 4 MB attachment took 1.6 s on a desktop (several times that on a phone). It now joins once; the test enforces it.

**Added to the test build:** a *Secure connection* check (the app must refuse expired, wrong-host, self-signed and untrusted certificates; a mail app that accepts forged certificates leaks passwords on café Wi-Fi), a *Phone runtime* check (which JavaScript features exist, which decides whether I can use ready-made MIME libraries), and a Gmail-API read next to the IMAP one.

**Known gaps, by design (not built yet):** SMTP and STARTTLS, IDLE, APPEND, flag changes, UIDVALIDITY resync, reconnect with backoff, message bodies and MIME, attachments, non-ASCII passwords and folder names.

### Plan
- **Keep:** local-first SQLite, optimistic actions with undo, one engine per protocol, tests against a scripted server, the unsigned-build pipeline, the "prove it on the phone first" step.
- **Change:** providers per service (finding 1); notifications as an explicit decision (finding 2); Outlook via Graph rather than IMAP-with-OAuth; local-only snooze and rules (never hide mail on the server, so a lapsed 7-day sign-in cannot strand mail).
- **Add:** a corpus of real-world messages as test fixtures (broken MIME is the top cause of "this email renders wrong"); a Dovecot container in CI for the IMAP engine.

### Design (Option A canvas)
**Keep:** unified inbox; swipe with undo; "Archive · next"; the snooze sheet; the blocked-images banner; search tokens with "search older mail on the server"; newsletter clean-up; shape (circle/rounded square) to tell people from bulk.

**Change:**
1. Filter pills must not hide mail: "All" default, counts honest, a "why this is a newsletter" line, one-tap per-sender correction.
2. Tabs become **Inbox · Search · Later**, with accounts behind your avatar in the header (an Accounts tab is used twice a year).
3. Show which account a mail belongs to (small coloured initial on the avatar) and an account filter.
4. Remove "Send tomorrow" from the send menu until a server exists; keep undo send and "remind me if no reply".
5. Add-account becomes **email address first, "Continue with Google" when available**, app password as the fallback, "Paste from clipboard" when a password is copied.
6. The floating bar must not hide the last row (bottom inset); density setting (compact/comfortable).
7. Red-orange is both the accent and the unread dot; give destructive actions their own outlined style so "delete" never looks like "compose".
8. Design at scalable text sizes (Dynamic Type 130 %).

**Add (missing screens):** first-run welcome and connect, a three-gesture tour, inbox-zero and other empty states, offline / sync-failed / "sign-in expired" banners, "days left until re-install" on the account sheet, settings (notifications, swipe actions, signature, privacy), VIPs, attachment preview, long thread, drafts and outbox, multi-select, search with no results, unsubscribe confirmation, move-to sheet.

**Cut or postpone:** "needs a reply" extraction (Option G), widgets and share extension (not possible with free signing), send-later, any sorting that hides mail.

## Features, in priority order
- **Must have to replace Apple Mail:** never lose mail or an action; unified inbox; instant local search with `æøå` working; swipe triage with undo; real snooze; reply / reply-all / forward with attachments; drafts that survive crashes; signature; blocked trackers; unsubscribe; dark mode; accessibility; account health banner; a clear answer on alerts.
- **Should have:** VIP senders and "notify me only for people and VIPs"; follow-up reminders; snippets; newsletter clean-up; per-sender rules; bulk select; contact autocomplete; move-to and labels; quick replies.
- **Later:** a "To-do" button that sends a mail to Home Memory; calendar-invite detection; on-device summaries (Apple's free on-device model, newer iPhones only); send-later via the helper; Outlook.
- **Never:** tracking pixels or read receipts, forced signatures, hidden-by-default categories, mail stored on a server, paywalled basics, notification spam.

## Three honest paths for notifications and the 7-day limit
| Path | Cost | You get | You still have |
|---|---|---|---|
| **1. Free, alongside Apple Mail** | $0 | Post for triage, search and writing; Apple Mail keeps its alerts and `mailto:` links | Two apps |
| **2. Free, with the alert helper** | $0 | Near-instant alerts via the free ntfy app (about a minute of delay) | A server holding a credential per account (opt-in), a second app for alerts, re-installing every 7 days |
| **3. Apple Developer account** | $99/year | Real push, no 7-day expiry, widgets and share extension, TestFlight, can be a default mail app after Apple approves it | A server is still needed for push (Gmail, iCloud and Outlook do not push to apps directly) |

I would build for path 1 (everything good about the app works there), then decide on 2 or 3 after you have used it for two weeks. Note the
comparison point: Spark Plus is $99/year and HEY is $99/year, so path 3 costs what the paid apps cost. You said free, so this is only here so the choice is informed.
Sideloadly can auto-refresh over Wi-Fi while your computer is on, which softens the 7-day chore.

## Decisions made (after this audit)
- **Outlook is the main account**, so Microsoft Graph moves from "later" to the first provider built. Outlook.com and Microsoft 365 both sign in with Microsoft; a work account may need your employer's approval.
- **Path 1** (free, alongside Apple Mail): Post for triage, search and writing; Apple Mail keeps alerts and `mailto:` links.
- **Accounts:** both personal Outlook and work (Microsoft 365). The work account is the one that may need your employer's approval; that is tested the first time you sign in with it.
- **Light customisation, nothing more** (screen A2.16): 8 accent colours (each checked: white-on-accent text 4.9:1 or better, and a lighter variant for dark mode), theme (match phone / light / dark), pure-black dark mode, row size (comfortable / compact), and one colour per account. Deliberately *not* included: free colour pickers (they produce unreadable combinations), custom fonts, icon packs. Swipe actions are the other adjustable thing (already in settings).
- Design: the polished Option A ("A2", 15 screens) on the canvas, reviewed before any real-app code is written.

## Update: instant alerts are now built into the plan (see ALERTS.md)
You said instant alerts must be in place. After checking, I withdrew my earlier suggestion of the free ntfy app: its iPhone app has documented
reliability problems (alerts that silently stop or arrive late), so it cannot be promised. The route now built instead is **Microsoft Graph change notifications ->
your Supabase function -> Web Push to a small "Post alerts" Home Screen web app**. Apple delivers Web Push itself (no developer account), and it reuses the
Web Push code and keys your Home Memory partner reminders already use. Alerts arrive in seconds with Post closed, respect per-account alert hours, and never
fire for newsletters unless asked. Limits, honestly: the notification carries the "Post alerts" icon (not Post's), has no Archive/Reply buttons, and needs a read-only sign-in stored (encrypted) on your own Supabase.
The first real measurement is the end-to-end "Instant alerts" check in the test build. A paid developer account later swaps only the last step for native push.

## What makes Post worth switching to (decided)
1. **Triage mode:** one message at a time, big Archive / Snooze / Reply later / Reply now, with a "reply later" queue (A2.17).
2. **Mail to action through Home Memory:** detected appointments and dates become to-dos with "remind me 1 h before", leave-by reminders and place reminders (A2.18).
3. **Alert hours per account:** work rings only Mon to Fri 07:30 to 17:00, VIPs always break through; mail always arrives (A2.19).
Plus: instant alerts (A2.20), true snooze, fast search, sender-by-sender clean-up.

## Direction: web app first (conditional)
Sideloading is the biggest ongoing cost (weekly re-install, builds, a separate alerts icon). A Home Screen web app removes it: nothing to sideload, updates are instant,
the alerts and the badge come from Post's own icon, snooze and reminders fire from the server with the phone locked, it also works on a PC, and I can run and test it
here in a browser. **Your condition: the unread number on the icon must work. It can** (Badging API, iOS 16.4+, updated from the push with the app closed; limits in ALERTS.md).
Costs: slightly less native feel, no haptics, Outlook (and Gmail) only because browsers cannot do iCloud IMAP, and the mail sign-in has to live encrypted on your
own Supabase (Microsoft limits browser-only sign-ins to 24 hours; a server-side sign-in lasts 90 days). Not yet verified: that Microsoft accepts that sign-in for both your accounts.
**Gate, one evening, about 30 minutes of your time:** (1) personal and work Microsoft sign-in works, (2) an alert with the phone locked arrives in seconds, (3) the icon number
appears, (4) triage feels at least as fast as Apple Mail. If any fails, we stop and go back to the sideloaded native app (parked, not deleted).

## Revised milestones
0. **Test build** (done, awaiting your run): connection, Google sign-in and its 7-day test, secure-connection, runtime, FTS5, HTML view, Keychain, background refresh.
1. **Connect and read:** provider interface; **Microsoft Graph (Outlook)** first, then Gmail API and IMAP (iCloud); first-run flow; sync with resync and backoff; unified inbox; reading with blocked trackers.
2. **Triage:** swipe, undo, archive-and-next, snooze, bulk select, unsubscribe.
3. **Search:** instant offline search, filters, server fallback, saved searches, categories that label but never hide.
4. **Write:** SMTP / Gmail send, drafts, attachments, signature, snippets, undo send, follow-up reminders.
5. **Gmail and iCloud** providers (Outlook already done in step 1).
6. **Alerts and polish:** background refresh, notification filters, the alert helper if you choose path 2, the full polish pass.

## Sources
- Reviews and comparisons: [Leave Me Alone](https://leavemealone.com/blog/best-email-apps-for-iphone/), [Filomail](https://www.filomail.com/blog/best-email-apps-iphone-2026), [Zapier](https://zapier.com/blog/best-email-app-for-iphone-ipad/), [Canary review](https://email-tools.me/posts/canary-mail-review/)
- Apple Mail categories: [Macworld](https://www.macworld.com/article/2585948/how-to-ios-18-macos-15-change-mail-categories-list-view.html), [Six Colors](https://sixcolors.com/post/2024/12/ios-18-2-mail-is-a-misfire/), [Beehiiv on iOS 26](https://blog.beehiiv.com/p/ios-26-email-update), [Canary on Apple Mail gaps](https://canarymail.io/blog/mac-mail-ai)
- Spark: [Efficient App](https://efficient.app/apps/spark), [a long-term user](https://algustionesa.com/spark-mail-review/), [Trustpilot](https://www.trustpilot.com/review/sparkmailapp.com), [privacy policy review](https://taxyovio.wordpress.com/2019/07/13/short-review-of-privacy-policies-of-spark-mail/)
- Superhuman: [Break the Twitch](https://www.breakthetwitch.com/superhuman/), [Alfred review](https://get-alfred.ai/blog/is-superhuman-worth-it), [Gizmodo](https://gizmodo.com/superhuman-silicon-valleys-hottest-email-app-kills-tr-1836093908), [TechCrunch](https://techcrunch.com/2019/07/03/superhuman-removes-email-location-logging-will-turn-read-receipts-off-by-default/amp/)
- HEY: [The Sweet Setup](https://thesweetsetup.com/hey-email-disrupted-my-email-workflow/), [Agentys](https://www.agentys.io/en/blog/hey-email-review), [a user who went back to Gmail](https://www.bitlog.com/2020/06/28/i-used-hey-for-a-week-but-im-going-back-to-gmail/)
- Outlook for iPhone: [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/4542411/outlook-app-on-iphone-is-sooooo-slooooowwwwww)
- Third-party clients and credentials: [The Risks of Third-Party Email Clients](https://honeypot.net/2021/06/21/the-risks-of.html)
- Swipe actions: [Fastmail](https://www.fastmail.com/blog/more-swipe-options-on-mobile-let-you-work-faster/)
- Gmail sign-in lifetime: [Unipile](https://www.unipile.com/google-oauth-refresh-token/), [Google Cloud help](https://support.google.com/cloud/answer/15549945?hl=en)
- Gmail limits: [Google](https://support.google.com/a/answer/1071518?hl=en); API vs IMAP: [Nylas](https://cli.nylas.com/guides/imap-vs-gmail-api-vs-graph-api), [aiemaily](https://aiemaily.com/blog/gmail-api-vs-imap)
- Microsoft sign-in for mail: [Microsoft Learn](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), [Mailbird summary](https://www.getmailbird.com/microsoft-modern-authentication-enforcement-email-guide/)
- iOS background work: [Apple forums: BGAppRefreshTask](https://developer.apple.com/forums/thread/729824), [periodic background execution](https://developer.apple.com/forums/thread/724506)
- Sideloading: [Sideloadly](https://sideloadly.io/), [refreshing every 7 days](https://builds.io/blog/technologies/ios-technologies/stop-refreshing-sideloaded-apps-7-days/)
- Socket library: [react-native-tcp-socket](https://github.com/Rapsssito/react-native-tcp-socket)

Not sourced by search, stated from Apple's rules and your own Home Memory build notes: a free Apple ID cannot sign the push entitlement.
