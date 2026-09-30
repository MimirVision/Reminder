# Home Memory web app

Windows desktop interface, and a home-screen web app for your wife's iPhone (capture only; geofencing needs the
native app).

```powershell
cd apps\web
npm install
copy .env.example .env.local     # then fill in the Supabase URL and anon key
npm run dev
```

Features so far: email sign-up, create/join household with invite code, capture text and photos into a shared
list, optional location stamp, attach a place (specific or category such as "any pharmacy"), mark done, places
manager.

To add to an iPhone home screen after deploying: Safari → Share → Add to Home Screen. Any static host works
(Netlify, Vercel, Cloudflare Pages); set the two `VITE_` env vars there.
