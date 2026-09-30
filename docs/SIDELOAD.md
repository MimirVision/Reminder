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
