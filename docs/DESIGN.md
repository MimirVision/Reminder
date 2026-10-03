# Home Memory: Design Document

Status: draft v1 (pre-code). Working name: Home Memory.
Owner: Andreas. Context: personal project, Norway, iPhone, Windows desktop, buying a large house with a large garden within ~3–4 months.

---

## 1. Problem

Forgetting is a failure of **retrieval cues**, not of storage. Traditional todo lists and time-based reminders fail because the moment a memory is needed (walking past the pharmacy, standing in the hardware store, looking at the boiler) is not a moment in time, it is a *context*.

Second, the user has repeatedly tried reminder apps and they die after about a week: capture depends on discipline, discipline fades, and once the app stops being fed it stops being useful.

## 2. Vision

> A memory that taps you on the shoulder.

Three verbs:

1. **Capture**: under 3 seconds, no decisions, from wherever you already are.
2. **Anchor**: attach the memory to context (place, thing in the house, season, person). The app proposes, the user confirms with one tap or ignores it.
3. **Surface**: show it at the right moment (push) or when asked (pull).

It is an *external memory*, not a productivity system.

## 3. Design principles

1. **Survive a month of adding nothing.** The app must remain useful and must not degrade into a wall of overdue items if unused for weeks.
2. **Two layers.** *Autopilot* (works with zero input: seasonal house calendar, weather nudges, imported house data) and *Capture* (the memory part, extremely low friction).
3. **Capture from where you already are.** Siri, Action button, lock-screen widget, share sheet, camera-roll sweep, a shared inbox for the spouse. Not "remember to open the app".
4. **Push-first, answerable from the lock screen.** Notifications carry actions (Done / Snooze / Not this time). Opening the app should be optional.
5. **Structure only where it fires something.** Places, recurrences and Things (objects with history) are structured. Everything else is found by search / ask.
6. **AI proposes, human confirms.** Raw capture is always preserved. No silent reorganisation. The app works with AI turned off.
7. **No guilt.** No red overdue counters, streaks, priorities, or required due dates.
8. **Every push path has a pull fallback.** Location triggers will sometimes miss, so "what's near me?" and an "I'm heading out" button always work.
9. **The data outlives the app.** Open export (Markdown, JSON, photo folder) from day one. This is a 10-year store.
10. **Offline is normal.** Capture queues locally; emergency info and reference facts are cached.

## 4. Two kinds of memory

| | Tasks / reminders | Reference facts |
|---|---|---|
| Examples | "Buy paracetamol", "clean gutters" | "Bedroom paint NCS S0502-Y", "hall bulbs E27 warm", "fridge filter model X" |
| Trigger | Place, season, completion | At a relevant store, or asked |
| Failure | Never done | "What size was it again?" at the shop |

**Store mode**: on arriving at a place category (hardware store, paint shop, furniture store), show open fix-items with photos and measurements *plus* the reference facts that category usually needs. This is the signature feature.

## 5. Context signals

| Signal | Use |
|---|---|
| Location (fixed place or *category*, e.g. any pharmacy) | Arrival triggers; capture-location stamp (notes made at the house default to the house) |
| Leaving / arriving home | "Heading out" and "just arrived" surfaces |
| Weather forecast | Frost → drain outdoor taps; no gutter jobs in rain; dry weekend → outdoor painting |
| Calendar | "Free Saturday: 3 small jobs fit" (later) |
| Camera / OCR | Photo of appliance label → model, serial, manual, suggested schedule |
| Camera roll | Weekly sweep of photos/screenshots taken at home or in shops → "anything to remember?" |
| NFC / QR tags (later) | Tag on boiler / fuse box / shed → manual, history, log-a-note |
| Car (later) | Spoken cue when passing a target |

## 6. Norway-specific layer

To be verified against local rules and with professionals; treated as an editable starting template, not authority.

- **Import the tilstandsrapport (condition report) and the FINN listing.** TG2/TG3 findings become dated fix-items and maintenance horizons. Year built, heating, roof type, etc. seed the house profile. This is the largest "app does the adding" win.
- **Move-in photo documentation.** Dated photos of the state at handover, valuable if a defect claim (reklamasjon) is ever needed. Check the specifics of avhendingsloven separately.
- **Seasonal template for a large house and garden:** gutters (autumn); outdoor taps before frost; snow/ice on roof and paths; chimney sweep (feier) and fire-safety check; smoke detectors and extinguisher; heat-pump and ventilation filters; facade staining/painting on a multi-year cycle; roof moss; lawn, trees, drainage, fences; septic tank / well if the property has them; radon and moisture checks in basements.
- **Emergency card:** water shutoff, fuse box, gas (if any), key contacts. Offline, two taps, shareable with spouse or house-sitter.

## 7. Notification policy ("somewhere in between")

- Place triggers: fire **once per visit**, with a cooldown. "Not now" keeps the memory for the *next* visit.
- All non-location, non-urgent items are **batched into one weekly digest** at a user-chosen time.
- Time-critical exceptions (e.g. frost warning) may push immediately.
- After a long absence, show one quiet catch-up digest, never a backlog.
- Hard cap on non-location pushes per day (default 1).

## 8. Data model (draft)

Everything starts as a **Memory**; structure is optional and additive.

- **Memory**: id, household_id, author, created_at, raw text, media (photos / voice / links), capture_location, capture_context (weather, at-home flag), status (`inbox`, `active`, `done`, `dismissed`), ai_suggestions (proposed anchors, unconfirmed).
- **Anchor** (zero or more per Memory):
  - `Place`: fixed point or category (pharmacy, hardware store), radius.
  - `Thing`: object/appliance/area in the house.
  - `Season/Window`: e.g. "Sep–Oct, before first frost".
  - `Recurrence`: fixed calendar or from-completion interval.
  - `Condition`: weather predicate (e.g. forecast < 0 °C).
- **Thing**: name, room/zone (free text, optional), facts (key/value: model, serial, paint code, size), documents (manuals, receipts, warranty end), photos, event log.
- **Event** (history): done / serviced / repaired / replaced, date, cost, photo, note, performed_by.
- **Reference fact**: a Thing fact or standalone (measurement, paint code, bulb type) tagged with the place categories where it should surface.
- **Place**: saved locations and categories with resolved POIs.
- **Household**: members (self, spouse), shared inbox, notification prefs.
- **House profile**: year built, heating, roof, garden features, septic/well flags, seeded template.

Completing a recurring Memory writes an Event and schedules the next occurrence automatically.

## 9. Architecture

### Platform (decided)

- **Phone: Expo (React Native, TypeScript).** Built with EAS cloud builds (no Mac needed) and distributed via TestFlight (Apple developer account, $99/year, accepted). Development builds are required for background location (Expo Go cannot do it on iOS).
- **Backend: Supabase.** Auth, Postgres, storage for photos, edge functions for Claude API calls (parsing, OCR, report import) and scheduled jobs (weekly digest, weather checks, push dispatch).
- **Web: React (same TypeScript types) for Windows desktop and as a home-screen web app on the spouse's iPhone.** Web push enables notifications; no geofencing there, which is acceptable for a "just add things" role.
- **Sync/offline:** captures queue locally (SQLite) and sync when online; cached read-only copies of Things, reference facts and the emergency card. Full local-first sync is explicitly deferred.
- **AI:** Claude API from edge functions only (keys never on device). Used for parsing brain dumps, reading labels/receipts, importing reports, and later "ask your house". Everything AI-generated is a suggestion.

### Location on iOS: constraints we design around

- ~20 monitored regions per app: register the most relevant regions dynamically and refresh on significant location change.
- "Always" permission with the two-step prompt; needs a clear in-app explanation.
- Practical radius floor ~100–200 m; events can be delayed.
- ~64 pending local notifications.
- Passing ≠ entering: use dwell and cooldown to reduce false positives.
- Category triggers ("any pharmacy"): pre-resolve nearby POIs around home, work and regular routes; extend to on-demand nearby search later.
- Personal-build caveat: paid developer account and TestFlight builds; expect some yearly OS-driven maintenance.

### Known risks

| Risk | Mitigation |
|---|---|
| Geofence reliability disappoints | Spike first; pull fallback (widget, "heading out", map) |
| Expo native gaps (widgets, Action button, App Intents) | Shortcuts fallback; targeted native modules |
| Capture decay (the real risk) | Autopilot layer, camera-roll sweep, spouse inbox, guilt-free digest |
| Notification fatigue | Notification policy in §7 |
| Photo storage growth | Thumbnails local, originals in object storage |
| Privacy of home photos | Private storage, RLS per household, user's informed choice on cloud AI |
| App abandonment | Dogfood with real errands before the house arrives; success gate below |

### Decisions made while building Milestone 1

- **Capture without native code.** Capture keys + an anonymous `capture_memory` RPC let an iOS Shortcut post text
  to the inbox (Siri, Action button, share sheet, Windows scripts). See `docs/CAPTURE.md`. Native App Intents /
  widgets can come later.
- **Category places** ("any pharmacy") are resolved to real shops with OpenStreetMap (Overpass), cached on the
  device, and re-fetched after moving >2 km or after 24 h.
- **Geofence budget.** At most 19 nearby regions plus one 1.5 km "refresh" region; leaving the refresh region wakes
  the app to re-pick the nearest regions. Only places with active memories are watched.
- **Reminder logic is plain, tested TypeScript** (`apps/mobile/src/core`): region selection, once-per-visit and
  cooldown rules, snooze handling, notification text.
- **"Are you here?"** A place's radius is also its prompt distance (per place, 100 m–1 km). While the app is open,
  a bar at the bottom asks "Are you at IKEA?"; "I'm here" opens that place's checklist (memories at the place, tick to
  complete, add several items at once). In the background the notification carries the same "I'm here" action.
  A Live Activity / Dynamic Island version would need native code and is a later option.
- **Maintenance model.** `maintenance_tasks` (interval or seasonal window) + `maintenance_events` (history with cost
  and note). `complete_maintenance` schedules the next occurrence. No overdue state: tasks are due, coming up, or later.
  `seed_house_template` inserts a Norway-oriented starter calendar switched by a house profile. Timing rules are
  covered by tests in `supabase/tests`.
- **Visual design: "E".** D's look (Bricolage Grotesque + DM Sans, white cards, one red-orange accent) with A's layout
  (title, sections, cards, four tabs). To-do wording: tabs To-do / House / Places / Settings, circles to tick,
  sections Near you / At a place / Anytime. To-do has a List | Map toggle. Floating Liquid Glass tab bar and "Add a
  to-do…" bar (system glass on iOS 26+, blur fallback), adjustable in Settings (Clear / Glass / Frosted). The design
  canvas is the reference.
- **AI place suggestions.** Edge function `suggest` (Claude API, structured output, low effort) proposes a saved place or
  a shop category for a to-do that has none; the model's ids and categories are validated, nothing is applied without a
  tap, and `suggested_at` limits it to one call per to-do. Recurrence suggestions and photo reading are later.
- **House facts.** `house_facts` (emergency card, measurements, paint, appliances) with `surface_at` shop categories;
  facts tagged for a place's category appear as "Useful here" on its list. Emergency facts are cached on the phone.
  A specific place can carry a shop kind (e.g. IKEA = hardware) so facts surface there too.
- **Custom recurring tasks.** `add_maintenance_task` (interval or yearly window, optional last-done date).
- **Hardening.** Longer invite codes, throttled and rotatable; triggers keep places, to-dos and photos inside one household.
- **Recurring suggestions.** The `suggest` function can also say a to-do is really a repeating job ("clean gutters every
  autumn"); "Make recurring" creates the house task and retires the to-do. Only offered when the text implies repetition.
- **Tilstandsrapport import (web).** Edge function `import-report` reads the PDF (Claude, structured output, streamed)
  and returns TG3/TG2/TGIU findings with measure, horizon and NOK estimate; the model output is cleaned and capped.
  You choose findings (TG3/TGIU pre-selected) and they become to-dos. Nothing is stored except the PDF in the private bucket.
- **Export.** Web Settings builds a zip (readable Markdown, JSON, all photos) so the data outlives the app.
- **Reminders without a native app.** Read-only reminder keys (`feed_keys`, hashed, revocable) open links on the web
  app's own domain, served by one Netlify function: `/api/remind` (to-dos at a place or shop kind, or a weekly digest, as
  plain text) and `/calendar.ics` (house tasks). iPhone Shortcuts automations (Arrive, Time of Day) call them and show a
  notification; Calendar subscribes to the feed. It uses iOS's own geofencing, needs no Apple account, and is the bridge
  until the native app exists. The feed is narrow by design: no authors or photos, only shop-tagged facts (the emergency
  card never leaves the database). Tested end to end from the SQL function through the Netlify function to the final text.
  See `docs/REMINDERS.md`.
- **Get set up card + invite link (web).** A compact card on the To-do page shows progress and only the next step (places,
  first to-do, house calendar, emergency card, iPhone reminders, partner); steps tick themselves off from real data and it can
  be hidden. Settings can copy an invite link (`/?join=CODE`); it pre-fills the code for the partner after sign-up.
- **To-dos with a place and a date (web).** The add and edit sheet has one "Where?" search: type a shop ("kiwi myren"), a kind of
  shop ("apotek", which means any pharmacy) or an address. Shops and addresses come from Photon (OpenStreetMap data,
  Norway only); saved places are matched first and reused, so there are no duplicates. "When?" is Today / Tomorrow / Weekend /
  Next week or any date, plus an optional time (migration 0008: `memories.due_on`, `due_time`, `places.address`). The list has
  sections Today, Coming up, At a place, Anytime. Ticking or deleting shows an Undo (deleting is a soft delete, purged after
  30 days); changes from your partner appear live (Supabase Realtime) and when the app returns to the foreground.
- **Map as part of the app (web).** The To-do screen has a List / Map switch. The map is full-bleed behind the same glass
  controls, as a MapLibre vector map (OpenFreeMap, OSM raster fallback; dark theme is a CSS-inverted canvas), pins with counts, quiet dots for saved
  places without to-dos, radius circles, and a draggable bottom sheet (peek, half, full) listing the places by distance.
- **Language and appearance (web).** Norwegian and English (default from the browser, switch in Settings; the reminder links
  and the starter house calendar follow it) and Automatic / Light / Dark. Translations are JSON dictionaries checked at compile
  time for missing keys; the Norwegian wording deserves a native read-through.
- **Glass.** In Safari and Firefox the bars are blurred, saturated and lit (highlights, rim light, ambient background). The
  real refraction of iOS 26 exists only in native apps. In Chromium browsers (Chrome, Edge) the bars additionally refract
  through an SVG displacement filter, enabled by detecting Chromium, never by feature-testing (Safari mis-reports support).
- **More on the web (migration 0009 and friends).** Repeating to-dos (daily, weekly, monthly, yearly; ticking one off creates
  the next, with Undo), a small avatar for who added each to-do and "Done by" at shops, swipe right to finish or left to delete,
  a weekly recap card, a three-step first-run tour, text size and high-contrast settings, offline capture (a service worker
  opens the app without signal; to-dos written offline wait on the device with a "waiting for connection" badge and are sent
  when you are back online), sharing into the app (Android/Windows), notifications when your partner adds something (Web Push;
  `docs/NOTIFICATIONS.md`) and "Add from a photo" for labels, tins and warranties (`read-label`).
- **Phone app parity.** The iPhone app has the same to-do features (dates, times, repeat, place search, edit, undo, swipe, avatars,
  recap, tour, live updates, offline capture, label photos, Norwegian, light/dark) and adds a normal local notification at the
  due time. Shared logic is written once in the web app and copied by `scripts/sync-shared.mjs`. It has been type-checked and
  its pure logic unit-tested, but not run on a device.
- **Known limitation:** a partner's new memory reaches the other phone's geofences only when that app is opened or
  the phone leaves its refresh region (no background push yet).

## 10. Roadmap

**Milestone 0: Location spike (throwaway, ~1–2 weeks of real use).**
Minimal dev-build app logging geofence enter/exit and significant-location events during normal life. Output: measured hit rate, latency, false positives, battery impact. Decides how much weight pull fallbacks need.

**Milestone 1: Capture + place reminders for errands (dogfood ≥ 1 month).**
- Capture: Siri/Shortcuts, widget, share sheet, photo, voice → inbox.
- One-tap AI-suggested anchors (place / recurrence / thing), skippable.
- Place and category triggers with cooldown and snooze-until-next-time.
- Spouse adds via web app (shared household inbox).
- Notification actions (Done / Snooze / Not this time).
- **Success gate:** still adding things in week 3–4; place reminders judged trustworthy.

**Milestone 2: House layer (ready by key date, ~3–4 months).**
- House profile + Norway seasonal template (autopilot).
- Tilstandsrapport / FINN import.
- Things, maintenance with from-completion and seasonal recurrence, history log.
- Reference facts and store mode; emergency card.
- Camera-roll sweep; move-in photo documentation flow.
- Weekly digest; weather-aware nudges (frost).

**Later:** NFC/QR tags, floor plan with photo pins, LiDAR room measurements, "ask your house" search, receipt/email forwarding, browser clipper, free-Saturday planner, sale-ready dossier export.

## 11. Explicitly not doing

Required due dates, priorities, tags/projects/folders, streaks, overdue red counts, social features, silent AI reorganisation, notifications on every pass of a location, elaborate onboarding wizards.

## 12. Open questions

1. Minimum viable set of Milestone 1 capture channels: Siri + share sheet first, widget/Action button second?
2. Spouse: household inbox via web app only, or invite to the phone app later once trust is built?
3. Category triggers: pre-resolved POIs first (simple) vs on-demand search (general).
4. Which Places/POI data source (MapKit, Google Places, OpenStreetMap) fits Norwegian coverage and cost?
5. Supabase region and data-residency preference (EU).
6. Confirm legal/regulatory items in §6 before encoding them as advice.

- **Limits and accounts (migration 0010).** The AI functions refuse after a daily cap per person (suggestions 100, label photos 15,
  report imports 3; `ai_take`), so credits cannot run away. "Delete my account" in Settings removes the login and, if you are alone
  in the household, all of its data and files; in a shared household the to-dos go to the partner. A privacy page is at
  `/privacy.html` (add your contact email there).
- **Smart add, assigning, pinning, shopping view, moving, install, routes (migration 0011).** The add sheet reads free text on the device
  (`lib/quickAdd.ts`, English and Norwegian: places by name or "work/home" words, kinds of shop, today/tomorrow/weekdays/"in 3 days",
  "before 21.00", repeats, "for Kari", several to-dos split on "then", "I need to", new lines; "do that before 21.00" attaches to the
  earlier to-do). A "Sort with AI" button calls the `parse-tasks` function for harder text. `memories.assignee_id` and `pinned` (a
  trigger keeps the assignee inside the household; partner pushes say "gave you"). A place sheet opens in a big-rows shopping view with
  a progress bar. House has a Moving tab (`lib/moving.ts`): a Norwegian checklist with dates counted from moving day. An install card
  offers Chrome's prompt or the iPhone Share steps. **Plan a route** (`lib/route.ts`, `routing.ts`, `RouteSheet`): tick places, pick
  start (default your position) and finish (default a place called home), get the best order (exact up to 8 stops) counting drive
  time from the public OSRM server, time at each stop by kind of shop, rush-hour factors by time of day, and today's "before HH:MM"
  deadlines; draws the line and numbered stops on the map and hands the ordered stops to Google or Apple Maps. Limit: OSRM has no
  live traffic; the rush-hour factors are estimates and the maps apps use live traffic when you drive.
- **Phone app 0.2.0 catches up with the web app.** Smart add (on-phone reader shared with the web through `scripts/sync-shared.mjs`, plus "Sort with AI"),
  who a to-do is for and the filter, pinning, shopping view and list splitting in a place list, the Moving tab, the route planner screen (map line,
  numbered stops, hand-off to Apple or Google Maps), delete-my-account, and an error screen instead of a blank one. The shared logic is tested in
  `apps/web` (`quickAdd`, `route`, `moving`); the phone screens are type-checked and the iOS bundle builds, but have not been run on a device.
  Sideloaded apps stop opening after 7 days (free Apple ID) and update only by installing a new build; there is no over-the-air update path.
- **To-do details (migration 0013), web and phone.** Notes, a checklist (steps tick inside the row; a repeating to-do's steps start unticked again), priority
  (none, low, medium, high: coloured ring and chip, sorted after pins), "remind me" before the time (5 min to 2 days; the phone schedules the local notification
  earlier, the `notify-partner` function's due mode does the same for push), two more repeats (weekdays, every other week; also in the calendar feed), tap the date
  chip to move a to-do (today, tomorrow, weekend, next week, any date, no date, with undo), upcoming grouped by day, a banner to move everything late to today,
  search through notes and steps, keyboard keys on the web (n new, / search), and the app icon badge on the phone. Natural language also understands
  `!!!`, `p1`-`p3`, "urgent", "every weekday", "every other week". Details are only sent when used, so the apps keep working until `upgrade.sql` is run.

