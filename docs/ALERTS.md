# Instant new-mail alerts for Post

Post is a sideloaded app, and iOS gives sideloaded apps (free Apple ID) no push notifications. So alerts come from a small
companion that **is** allowed to receive push: a **Home Screen web app called "Post alerts"**, the same kind of notification
your Home Memory partner reminders already use (Apple's own Web Push, no developer account needed).

```
New mail arrives in Outlook
   -> Microsoft calls your Supabase function  (post-alerts)         within seconds
   -> it looks at who it is from and decides   (person: yes. newsletter: no. work account after hours: no)
   -> Web Push through Apple to the "Post alerts" icon on your Home Screen
   -> a normal iPhone notification: "Maja Berg: Re: Hytta i påska"
   -> tap it: the page opens with an "Open Post" button
```

## What you get, and the honest limits
- Alerts in **seconds**, with the phone locked and Post closed. Nothing runs on your phone to make this work.
- It only alerts for what deserves it: **people** by default (not newsletters, receipts or robots), or all mail, or only VIPs. Work and
  personal each have their own rule and their own **alert hours** (for example the work account only Mon to Fri, 07:30 to 17:00).
  A VIP always gets through. When the app is unsure it alerts: a missed alert is worse than an extra one.
- The notification comes from the **Post alerts** icon (not from Post itself), and iOS web alerts cannot have Archive or Reply buttons.
  Tapping it opens the alerts page, which has an **Open Post** button.
- Your own Supabase holds an **encrypted, read-only sign-in** to your mailbox so it can read the sender and subject of new mail
  (it cannot send, change or delete anything). That is the one place your mail data touches a server, and it is yours. Turn alerts off in
  Post and it is deleted.
- Needs iOS 16.4 or newer, and the icon must be on the Home Screen.
- The one thing that can silently stop alerts is Microsoft revoking the sign-in (a password change, or your employer's policy). The function then sends you an
  alert, "Post alerts need you to sign in", and the Post app shows a banner.

## One-time setup (about 20 minutes)
You already have Supabase and the web app hosting for Home Memory, and the Web Push keys from `docs/NOTIFICATIONS.md`. This reuses them.
1. **Database.** Run `supabase/upgrade.sql` in the Supabase SQL Editor again (it adds three server-only tables). Safe to repeat.
2. **Secrets.** Supabase, Edge Functions, Secrets: add
   - `POST_ALERTS_KEY` = a long random password you make up (you will type it once into the Post alerts page)
   - `ALERTS_ENC_KEY` = 32 random bytes as base64url. Make one by pasting this into any browser's console (F12): `btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')`
   - `MS_CLIENT_ID` = the Application (client) ID from the Microsoft setup in `docs/MAIL.md`
   - (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` are already there from the Home Memory notifications)
3. **The function.** Edge Functions, Deploy a new function, Via Editor: name `post-alerts`, paste the whole of `supabase/dashboard/post-alerts.ts`,
   and **turn "Verify JWT" OFF** (Microsoft and the schedule cannot send a Supabase login; the function protects itself with the key and a secret per mailbox). Deploy.
   Its address is `https://<your project>.supabase.co/functions/v1/post-alerts`.
4. **Keep it alive.** Integrations, Cron, Create job: name `post-alerts-renew`, schedule `0 */6 * * *` (every 6 hours), type Supabase Edge Function,
   function `post-alerts`, method POST, headers: add `x-alerts-key` = your `POST_ALERTS_KEY` (and keep the Authorization header the form adds), body `{"op":"renew"}`.
   Microsoft stops sending after a few days unless it is renewed; this renews it long before.
5. **Microsoft.** In the Azure registration from `docs/MAIL.md`, open **API permissions** and make sure `Mail.Read` is in the Delegated list too (add it if it is not). Alerts use it so the server can only *read* the sender and subject of new mail, never send or change anything.
6. **The phone.** Open `https://<your web app address>/post-alerts/` in **Safari**, tap Share, **Add to Home Screen**, then open **Post alerts** from the new icon.
   Type the server address and the alerts key, tap **Turn on alerts on this phone**, allow notifications. Tap **Send a test alert**: lock the phone, it should ring in seconds.
7. **Each mailbox.** In the Post app (the test build has an "Instant alerts" check) sign in once more with read-only access to each Outlook account you want alerts for.

## Checking it works
- The alerts page lists each watched mailbox, its mode and "last alert 3 min ago". A red row means Microsoft is no longer sending: open Post and sign in again.
- Supabase, Edge Functions, `post-alerts`, Logs shows each decision ("alerted (a person)", "skipped: bulk mail", "skipped: outside this account's alert hours").
- Send yourself a mail from another address with the phone locked, and time it. Tell me the number: it is the figure that decides whether this is good enough.

## If it is not good enough
Everything above is the same pipeline whatever delivers the final push. With a paid Apple Developer account ($99/year) the last step becomes a real Post
notification (Post's own icon, Archive and Reply buttons, a badge) and the web app disappears; the server, the rules and the schedules stay.
