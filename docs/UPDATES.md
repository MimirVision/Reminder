# Updates to the phone app without sideloading again

The phone app can fetch its own small updates (screens, texts, logic, images). This is **over-the-air (OTA) updating**. It works with a
free Apple ID, because only the JavaScript is replaced, not the signed app.

## What you do
- Nothing, usually. When the app opens (and at most every 15 minutes after that) it asks the website for a newer version, downloads it,
  and says **"An update is ready"** with **Restart now / Later**. Settings > App updates shows which version is running and has a
  **Check for updates** button.
- **Sideload again only when** the app says nothing new arrives *and* I tell you the change is a big one (a new permission, a new
  native feature such as widgets or push, a new package). The 7-day expiry of a free Apple ID still needs a reinstall every week: OTA
  does not renew that.

## What I do (for each change)
1. Change the phone code, test it.
2. `node scripts/publish-ota.mjs` (exports the iOS bundle, writes `apps/web/public/ota/<runtime>/manifest.json`).
3. Commit and push. The website host (Cloudflare) deploys it, usually within a few minutes. Phones pick it up the next time the app opens.

## Runtime version
`runtimeVersion` in `apps/mobile/app.json` (and the number in `updates.url`) says which installed apps an update fits. An update only goes
to apps with the same number. Raise it (and make a new sideload build) when native code changes; old installs then keep running their
last compatible update and ignore the new ones.

## Safety
- If an update crashes the app on start, `expo-updates` falls back to the previous update, and then to the version built into the install.
- Updates are public files (the same kind of code that is in the app); the Supabase keys in them are the public ones, protected by row level security.
- Each update adds about 4 MB to the website's files and to the repository history. Old bundles are removed from the site, not from git history.

## Not tested on a device here
The first build with updates on has to be installed once by sideloading. After that, check Settings > App updates > Check for updates.
