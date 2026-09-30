# iPhone reminders without an app

Your iPhone can nudge you using its own **Shortcuts** and **Calendar** apps. No Apple developer account, no app build,
no npm. Three things you can set up:

1. **When I arrive somewhere**: a notification with the to-dos for that place (and any facts you tagged for that kind of shop).
2. **Sunday summary**: what house tasks are due and how many to-dos are waiting.
3. **House tasks in Calendar**: your maintenance calendar as a subscribed calendar.

They are read-only: they show your data, they never change it.

## Before you start
1. Run `supabase/upgrade.sql` in the Supabase SQL Editor (it adds reminder keys).
2. Your Netlify site redeploys by itself when the code is pushed. Check that the new links exist by opening
   `https://YOUR-SITE.netlify.app/api/remind?ping=1` in a browser. It should say **ok: configured**.
   If it says "missing Supabase environment variables", check the two variables in Netlify (Site configuration, Environment variables).
   If the page is not found, tell me: the function did not deploy.
3. **Do the next step on the iPhone.** Open your site, go to **Settings**, and under **iPhone reminders** tap **Create reminder key**.
   The links appear, each with a Copy button. They stay visible on the device that made the key.

## 1. When I arrive somewhere (repeat for each place)
1. Open the **Shortcuts** app, then the **Automation** tab, then **+** (New Automation), then **Arrive**.
2. **Location**: Choose, search for the place (for example the pharmacy you actually use), tap Done. Leave "Anytime". Tap Next.
3. Choose **Run Immediately** (not "Run After Confirmation"). Tap Next.
4. **New Blank Automation**, then add the action **Get Contents of URL**. Paste the link from Settings for that place
   ("When I arrive: ..."). Leave the method as GET.
5. Add the action **If**. Set it to: **Contents of URL**, **has any value**. (This skips the notification when there is nothing to do there.)
6. Inside the If, add **Show Notification**. Title: `Home Memory`. Body: tap the field and pick the **Contents of URL** variable.
7. Tap Done.

Tips:
- "Any pharmacy" links look up **all** to-dos for that kind of shop, so one automation per pharmacy you really visit is enough.
- To test, open the link in Safari: you should see the list as plain text.
- iOS may ask you to allow Shortcuts to use your location (choose Always) and to send notifications.

## 2. Sunday summary
1. Shortcuts, **Automation**, **+**, **Time of Day**. Pick a time (for example 09:00), **Weekly**, **Sunday**. Next.
2. **Run Immediately**, Next.
3. Same actions as above with the **Sunday summary** link: Get Contents of URL, If (has any value), Show Notification.

If there is nothing due and no to-dos, the link answers with nothing, so you get no notification that week.

## 3. House tasks in Calendar
On the iPhone, in Settings, tap **Subscribe in Calendar** (or, in the iOS Settings app: Calendar, Accounts, Add Account, Other,
Add Subscribed Calendar, and paste the house tasks link). Each task shows as an all-day event on its due date, or across its
season for yearly jobs, and moves on by itself after you mark it done.

I set the events to alert at 09:00 on their first day, but iOS decides whether a subscribed calendar is allowed to alert,
so do not rely on that alone. The Sunday summary is the dependable nudge; the calendar is for seeing what is coming.

## Good to know
- **Accuracy:** "arrive" automations use iOS's own location detection. They are usually fine for places you visit but can be
  a few minutes late and are less precise than a real app. The real app (needs the paid Apple account) is the upgrade path.
- **Notifications** come from the Shortcuts app. A Focus mode can silence them.
- **Privacy:** the links contain a secret key. Anyone who has a link can read your to-dos, house tasks and shop-tagged facts.
  They cannot change anything, and the emergency card is never included. If a link leaks, **Revoke** the key in Settings and make a new one.
- **Lost the links?** They are shown on the device that created the key. Revoke it and create a new key on the device you are using.
