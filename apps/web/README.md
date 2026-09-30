# Home Memory web app

Design E on the web: the desktop interface (Windows) and a home-screen web app for your partner's iPhone.

```powershell
cd apps\web
npm install
copy .env.example .env.local     # then fill in the Supabase URL and anon key
npm run dev
```

- **To-do**: list grouped by place / anytime, circles to tick, "Add a to-do…" glass bar (one per line adds several),
  List | Map toggle (OpenStreetMap; asks for location only when you open the map), "Open list" per place.
- **House**: maintenance calendar with a month ribbon per seasonal task; mark done with optional cost and note.
- **Places**: specific places and "any pharmacy" style categories, with the "Are you here?" distance.
- **Settings**: Glass (Clear / Glass / Frosted), quick-add keys for Siri/Shortcuts, household invite code, sign out.

Light and dark follow the system. To add to an iPhone home screen after deploying: Safari > Share > Add to Home Screen.
Any static host works (Netlify, Vercel, Cloudflare Pages); set the two `VITE_` env vars there.

The web app has no background reminders or "Are you here?" prompt; those are phone features.
