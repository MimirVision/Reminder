# Try the real iPhone app for free (7 days at a time)

The real app is the only way to get reliable "you are near the shop" reminders in the background. Without the $99 Apple
Developer account you can still install it on your own iPhone with a free Apple ID: it stops working after **7 days**, and you
re-install it (your data lives in Supabase, so nothing is lost). Limits: 3 sideloaded apps at a time, and it needs a computer
with a USB cable each time you renew.

I checked in advance that the app's JavaScript bundles and the native iOS project generates correctly, but I could not run the Mac build or the install myself, so expect to fix a snag or two the first time. If a step fails, send me the message.

## 1. Build the app (free, in GitHub, no Mac needed)
1. On GitHub open the repository, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Add
   `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the same two values you gave Netlify).
2. **Actions**, **Build iPhone app (unsigned)**, **Run workflow**. It takes 15 to 30 minutes on a Mac in the cloud.
3. Open the finished run and download **HomeMemory-unsigned-ipa** (a zip; unzip it to get `HomeMemory-unsigned.ipa`).
   Public repositories get this for free.

## 2. Put it on the iPhone (Windows or Mac)
1. Install **iTunes** and **iCloud** from apple.com (not the Microsoft Store versions), then **Sideloadly** from sideloadly.io.
   On a locked-down work computer this may be blocked: use a private one.
2. On the iPhone: Settings, Privacy & Security, **Developer Mode**, turn on, restart.
3. Plug the iPhone in and tap **Trust**. Open Sideloadly, drag the `.ipa` in, type your Apple ID (a spare one is best) and click
   **Start**.
4. On the iPhone: Settings, General, **VPN & Device Management**, tap your Apple ID, **Trust**.
5. Open Home Memory, sign in, and when it asks for location choose **Allow While Using**, then in iOS Settings, Home Memory,
   Location, choose **Always**. Allow notifications.
6. In the app: Settings, **Turn on place reminders**.

## Every 7 days
Repeat step 2.3 (Sideloadly, same `.ipa`, same Apple ID). It installs over the old copy and keeps your data. Put a reminder in your
calendar for day 6.

## Good to know
- Push notifications from the partner need the paid account, so the sideloaded app does not have them. It still has place
  reminders, due-date reminders, the map, offline capture and everything else.
- This is the same app the App Store version would be. When you decide to pay the $99, the steps become "TestFlight" and
  the 7-day limit disappears.

---

# Checklist for the day you do it

## Before (can be done from the phone today)
- [ ] **Your iPhone runs iOS 16.4 or newer** (Settings, General, About). The app will not install on older ones.
- [ ] **A spare Apple ID** with two-factor authentication on (create one at appleid.apple.com). Sideloadly asks for its password; if it
      asks for an "app-specific password", make one at appleid.apple.com under Sign-In and Security.
- [ ] **The file.** The build's download stays on GitHub for 90 days (Actions, the run, Artifacts). If it has expired, run
      "Build iPhone app (unsigned)" again. Best: download it on the computer you will use.
- [ ] **Your own computer** (not the work one), a USB cable that carries data, and the phone unlocked.

## On the computer
1. Download **iTunes** and **iCloud** from apple.com (search "iTunes for Windows Apple"; the Microsoft Store versions do not work), install both, and sign in to nothing.
2. Install **Sideloadly** (sideloadly.io).
3. Plug in the iPhone, unlock it, tap **Trust**.
4. Sideloadly: drag in `HomeMemory-unsigned.ipa`, type the spare Apple ID, **Start**. Enter the password (and the 2FA code) when asked.
5. On the phone: Settings, General, **VPN & Device Management**, your Apple ID, **Trust**.
6. **Developer Mode:** the switch (Settings, Privacy & Security, Developer Mode) only appears after Sideloadly has tried to install
   once. Turn it on, restart the phone, and confirm. Then open the app.

## If something goes wrong
| What you see | What to do |
|---|---|
| Sideloadly cannot find the phone | Install iTunes from apple.com (not the Store), use a different cable or port, unlock the phone. |
| "Maximum number of App IDs" | A free Apple ID allows 10 new app IDs per week. Wait, or use another Apple ID. |
| "Untrusted Developer" when opening | Step 5 above. |
| The app opens then closes | Developer Mode is off (step 6), or the app has expired (re-install). |
| "Guru Meditation" or a sign-in error | Use an app-specific password, or a different Apple ID. |
| The app says it is not configured | The two GitHub secrets were missing or wrong when it was built. Fix them and build again. |
| Nothing happens at places | Location must be **Always**, and "Turn on place reminders" must be pressed in the app's Settings. |

## After it is installed: a 10-minute test
1. Sign in with the same account as the web app. Your to-dos should be there.
2. Add a to-do: "Test", with a place and a date and time a few minutes ahead. A notification should ring at that time.
3. Settings, **Turn on place reminders**. Allow "Always".
4. Add a place near your home (for example a shop 300 m away) with a to-do. Walk or drive there. You should get a notification
   near it; tapping "I'm here" opens the list. Note how early or late it comes.
5. Turn on airplane mode, add a to-do, turn it off. It should appear on the web app.
6. Tell me what worked and what did not.
