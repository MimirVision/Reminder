# Home Memory: location spike (Milestone 0)

Throwaway app that answers one question: **can iOS geofencing be trusted for "remind me when I arrive"?**
See `docs/DESIGN.md` §9–10.

It lets you save places, registers them as geofences, logs every enter/exit event (with time and battery level)
and sends a local notification. You annotate real arrivals with "I'm arriving", and the app computes hit rate and
latency. An optional breadcrumb toggle records a low-power path as ground truth.

## What to do (from Windows)

You need the paid Apple developer account and a free Expo account.

```powershell
cd apps\spike
npm install
npx eas-cli@latest login
npx eas-cli@latest init                 # creates the EAS project and writes its id into app.json
npx eas-cli@latest device:create        # open the printed link/QR on your iPhone to register it
npx eas-cli@latest build --platform ios --profile preview
```

`eas build` asks you to sign in to your Apple account and creates the certificates itself. When the build finishes
(about 15–30 min), open the install link/QR on your iPhone. Enable Developer Mode on the phone if iOS asks.

`preview` is a standalone build: no dev server or laptop is needed once it is installed.

## Running the experiment (1–2 weeks)

1. Grant permissions. Choose **Always** for location, or background triggers won't work.
2. At places you visit anyway (home, work, shops, pharmacy), tap "Add my current location as a place".
3. Try different radii (100 / 150 / 250 / 500 m) on similar places.
4. Live normally. When you arrive or leave a place, tap "I'm arriving" / "I'm leaving" if convenient.
5. Turn breadcrumbs on for a few days to see what the geofences miss.
6. Export CSV from the app and send it to the repo/chat for analysis.

## What we want to learn

- Hit rate: how many real arrivals produced a notification.
- Latency: median and worst-case delay after arriving.
- False positives: enter events when you were only passing.
- Battery cost, with and without breadcrumbs.
- Whether it still works after a phone restart, or after not opening the app for days.

## Notes

- Expo docs were unreachable from the build environment, so API usage was checked against the installed
  SDK 57 type definitions. The JS bundle builds and `expo prebuild` produces the expected Info.plist entries
  (location background mode and usage strings), but it has **not run on a device yet**.
- Bundle id `com.mimirvision.homememory.spike` can be changed in `app.json` before the first build.
- `ios/` is generated (Continuous Native Generation) and git-ignored.
