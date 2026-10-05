# Post: a mail app for your iPhone (free, sideloaded)

A replacement for Apple Mail that you install yourself, like Home Memory. It talks straight to your mail provider from the phone,
keeps everything in a local database (so it opens instantly and works offline), and costs nothing to run: no server, no paid API.

**Where it is now: step 1, the "can this work?" build.** `apps/mail` is a test build with six checks. It proves the risky parts on
your real phone before the real app is built on top of them. The design for the real app (Option A, the Home Memory look) is on the
design canvas: https://claude.ai/artifact/QCFREjFYyX2YG2T91zTQGq

## What the checks prove
| Check | Why it matters |
|---|---|
| Mail login (IMAP over TLS) | The phone can read your mail directly, with no server in between |
| Microsoft sign-in | Outlook with one tap, no password, read through Microsoft Graph (your main accounts) |
| Microsoft token still valid | Run a week or more later: proves you stay signed in |
| Google sign-in | Gmail with one tap and no app password, and staying signed in |
| Google token still valid | Run it 8+ days after signing in: proves Gmail never asks you to sign in again |
| Search index (FTS5) | Instant offline search, and whether `æ ø å` searches behave |
| Mail view (images blocked) | Showing HTML mail safely, with tracking images blocked |
| Secure connection | The app refuses forged certificates (must pass before you type a password anywhere) |
| Phone runtime | Which modern JavaScript features the phone has, so I pick libraries that work |
| Keychain | Passwords and tokens stored in the iPhone's secure storage |
| Background refresh | How often iOS lets the app look for new mail without push |

## 1. Build the app (free, in GitHub, no Mac needed)
Same as Home Memory, see [SIDELOAD.md](SIDELOAD.md): **Actions, Build Post mail app (unsigned), Run workflow**, then download
**Post-unsigned-ipa**. No secrets are required for the basic checks. (For "Sign in with Google", add the optional secret in step 3 first.)

## 2. Install it
Exactly like Home Memory (Sideloadly, same Apple ID, Trust in Settings). A free Apple ID allows **3 apps** at a time, so Home Memory +
Post is fine. Both expire after 7 days: re-install both in the same Sideloadly session. Keep Apple Mail for now as the fallback.

## 3. Set up "Sign in with Microsoft" for Outlook (one time, about 10 minutes, free)
Microsoft no longer lets apps log in to Outlook with a password, so this is the only way in. Only needed once; it covers every Outlook account you add.
1. Open https://entra.microsoft.com and sign in with a personal Microsoft account (your outlook.com address works). Microsoft may ask you to create a free
   directory or free Azure account first; follow the prompts (they can ask for a card to prove who you are; it is not charged for this).
2. **App registrations, New registration**: name `Post`. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   Redirect URI: platform **Public client/native (mobile and desktop)**, value `postmail://auth`. Register.
3. Copy the **Application (client) ID** from the overview page.
4. **API permissions, Add a permission, Microsoft Graph, Delegated**: `User.Read`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `offline_access`.
5. **Authentication**: set **Allow public client flows** to **Yes**, Save.
6. In GitHub: **Settings, Secrets and variables, Actions, New repository secret**: name `EXPO_PUBLIC_MS_CLIENT_ID`, value the client ID. Then run the build again.
**Work or school accounts (Microsoft 365):** these also sign in this way, but your employer may block outside apps or ask an admin to approve Post.
If the sign-in says "admin approval required", that is why; tell me and we will see what your organisation allows.

## 3b. Optional: set up "Sign in with Google" for Gmail (one time, about 10 minutes, free)
Skip this if you do not use Gmail. Without it, Gmail needs an app password (works, but is clunkier). With it, adding Gmail is one tap.
1. Open https://console.cloud.google.com, sign in with the Google account you read mail with, **Select a project, New project**, name it `Post`.
2. **APIs & Services, OAuth consent screen** (or "Google Auth Platform"): user type **External**, app name `Post`, your email as support and
   developer contact. Under **Data access / Scopes** add `https://mail.google.com/`.
3. **Publish the app** ("In production"). This matters: while an app is in "Testing", Google expires its sign-ins after 7 days. Published but
   unverified, it shows a one-time "Google hasn't verified this app" screen (tap **Advanced, Go to Post (unsafe)**: it is your own app) and is
   limited to 100 users, which is plenty. **The "Google token still valid" check exists to confirm this on your phone.**
4. **Credentials, Create credentials, OAuth client ID**, application type **iOS**, bundle ID `com.mimirvision.post`. Copy the **Client ID**
   (it ends in `.apps.googleusercontent.com`).
5. In GitHub: **Settings, Secrets and variables, Actions, New repository secret**: name `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, value the Client ID.
   Then run the build again.
6. **Enable the Gmail API**: APIs & Services, Library, search "Gmail API", Enable. Post tests reading Gmail both ways (IMAP and Gmail's own API) so we can pick the sturdier one.

## 4. Run the checks on the phone
1. **Microsoft sign-in**: tap it, finish the Microsoft sheet. It should list your inbox count, your newest 5 mails and your folders. (**Mail login** below is for iCloud or Gmail with an app password.)
1. **Mail login**: type your Gmail or iCloud address and an **app password**, tap Run.
   - Gmail: needs 2-step verification on, then https://myaccount.google.com/apppasswords
   - iCloud: https://account.apple.com, Sign-In and Security, App-Specific Passwords
2. **Google sign-in** (only if you set it up): tap it, finish the Google sheet. It should end with "IMAP login with the Google token: OK".
3. Run **Secure connection** first (every line must say "refused, as it should be"), then **Search index**, **Phone runtime**, **Mail view** (the tracking photo must NOT show), **Keychain** and **Background refresh** (tap Register).
4. Tap **Copy report** at the bottom and paste it to me.
5. Use the phone normally for a day, open Post once, and copy the report again: it lists when iOS woke the app.
6. After 8 days (before the 7-day reinstall, so install the *same* build once to keep the sign-in, or just run it right after the re-install),
   run **Microsoft token still valid** (and **Google token still valid** if you use Gmail) and copy the report once more.

## How the code is organised (for later)
- `src/core/` has no phone code: IMAP client and parser, header decoding (æ ø å), sign-in method discovery, friendly login errors. It is
  tested in Node against a scripted IMAP server: `cd apps/mail && npm test`.
- `src/lib/` is the phone side: the TCP/TLS socket, the secure storage, the background task, the check screen.
- CI (`.github/workflows/ci.yml`, job `mail`) runs the typecheck and the tests on every push.
