var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/i18n/houseTasks.nb.json
var houseTasks_nb_default = {
  gutters_autumn: { title: "Rens takrenner og nedl\xF8psr\xF8r", notes: "F\xF8r f\xF8rste frost. Fjern l\xF8v; sjekk skj\xF8ter og beslag." },
  gutters_spring: { title: "Sjekk takrenner etter vinteren", notes: "Is og sn\xF8 kan b\xF8ye beslag og l\xF8sne skj\xF8ter." },
  drain_taps: { title: "T\xF8m og steng utekraner", notes: "Steng ventilen innend\xF8rs og \xE5pne utekranen slik at den t\xF8mmes. Gj\xF8r det f\xF8r f\xF8rste hardfrost." },
  yard_drains: { title: "Rens sluk og rister rundt huset", notes: "L\xF8v og slam i sluk gir vann mot grunnmuren." },
  snow_prep: { title: "Gj\xF8r sn\xF8utstyret klart; sjekk sn\xF8fangere", notes: "Spader, salt/str\xF8grus, sn\xF8fangere. Vit hvor du kommer opp p\xE5 taket." },
  roof_moss: { title: "Se over taket og fjern mose", notes: "Se fra bakken eller med kikkert f\xF8rst. G\xE5 bare opp n\xE5r det er trygt, eller hyr inn noen." },
  windows_seals: { title: "Sjekk tetting rundt vinduer og d\xF8rer; sm\xF8r hengsler", notes: "Trekk, sprukne fuger, l\xE5ser som sitter fast." },
  smoke_detectors: { title: "Test r\xF8ykvarslere", notes: "Trykk p\xE5 testknappen; bytt batteri n\xE5r de piper eller hvert \xE5r. Sjekk lokale anbefalinger." },
  fire_extinguisher: { title: "Sjekk brannslukker og brannteppe", notes: "M\xE5leren i gr\xF8nt, innenfor dato, lett tilgjengelig." },
  earth_fault_test: { title: "Test jordfeilbryteren", notes: "Trykk p\xE5 testknappen i sikringsskapet; den skal sl\xE5 ut. Sl\xE5 den p\xE5 igjen etterp\xE5." },
  wet_rooms: { title: "Sjekk silikon og fuger p\xE5 bad og vaskerom", notes: "Sprekker slipper vann inn i konstruksjonen. Gj\xF8r om fugene n\xE5r de er \xF8delagt eller muggne." },
  water_heater: { title: "Sjekk varmtvannsberederen og sikkerhetsventilen", notes: "Se etter lekkasjer eller korrosjon; betjen sikkerhetsventilen etter bruksanvisningen." },
  chimney: { title: "Feiing og tilsyn med ildsted", notes: "Kommunen setter opp dette; sjekk intervallet ditt og at feieren f\xE5r tilgang." },
  heat_pump_filters: { title: "Rengj\xF8r filtrene i varmepumpen", notes: "Skyll filtrene i innedelen; fjern l\xF8v og sn\xF8 rundt utedelen." },
  ventilation_filters: { title: "Bytt ventilasjonsfilter", notes: "Balansert ventilasjon med varmegjenvinning: sjekk filtertype i bruksanvisningen." },
  basement_damp: { title: "Sjekk kjelleren for fukt, mugg og luftfuktighet", notes: "Se i hj\xF8rner, sluk og ved lagrede kasser. Noter luftfuktigheten." },
  facade: { title: "Se over trefasaden og mal eller beis", notes: "Se etter avflaking, sprekker og r\xE5te n\xE6r bakken. Hvor ofte man m\xE5 beise varierer mye." },
  septic: { title: "T\xF8m slamavskilleren", notes: "Intervallet bestemmes av kommunen og typen tank. Bekreft ditt." },
  well_water: { title: "Test drikkevannet fra br\xF8nnen", notes: "Minst bakterier og nitrat; mer hvis smak eller farge endrer seg." },
  mower_service: { title: "Service p\xE5 gressklipperen og hageredskapene", notes: "Kniver, olje, tennplugg eller batteri, f\xF8r sesongen." },
  garden_spring: { title: "V\xE5rrydding i hagen og plenstell", notes: "Riv, luft plenen, s\xE5 i bare flekker, f\xF8rste klipp." },
  fence_gates: { title: "Sjekk gjerde, porter og hagekonstruksjoner", notes: "Stolper, hengsler, r\xE5te; behandle eller reparer." },
  garden_autumn: { title: "H\xF8stpuss i hagen: riv l\xF8v, beskj\xE6r, vinterklargj\xF8r", notes: "Ta inn slanger, dekk til \xF8mfintlige planter, sett l\xF8ker." }
};

// netlify/lib/feed.mjs
var DEFAULT_TZ = "Europe/Oslo";
var WORDS = {
  en: {
    photo: "(photo)",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    everyYear: "every year",
    everyYearIn: "every year, {a}",
    everyYearSeason: "every year, {a}-{b}",
    everyYears: "every {n} years",
    everyMonth: "every month",
    everyMonths: "every {n} months",
    now: "now",
    tomorrow: "tomorrow",
    inDays: "in {n} days",
    inWeeks: "in {n} weeks",
    todosAt_one: "{n} to-do at {label}:",
    todosAt_other: "{n} to-dos at {label}:",
    more: "+ {n} more",
    useful: "Useful here:",
    dueNow: "Due now: {list}",
    comingUp: "Coming up: {list}",
    dueToday: "Due today: {list}",
    todosWaiting: "To-dos: {n} waiting ({a} anytime, {b} at places)",
    doneWeek: "Done this week: {n}",
    forToday_one: "{n} to-do for today:",
    forToday_other: "{n} to-dos for today:",
    lastDone: "Last done {d}.",
    notDone: "Not done yet."
  },
  nb: {
    photo: "(bilde)",
    months: ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"],
    everyYear: "hvert \xE5r",
    everyYearIn: "hvert \xE5r, {a}",
    everyYearSeason: "hvert \xE5r, {a}-{b}",
    everyYears: "hvert {n}. \xE5r",
    everyMonth: "hver m\xE5ned",
    everyMonths: "hver {n}. m\xE5ned",
    now: "n\xE5",
    tomorrow: "i morgen",
    inDays: "om {n} dager",
    inWeeks: "om {n} uker",
    todosAt_one: "{n} oppgave hos {label}:",
    todosAt_other: "{n} oppgaver hos {label}:",
    more: "+ {n} til",
    useful: "Nyttig her:",
    dueNow: "Aktuelt n\xE5: {list}",
    comingUp: "Kommer snart: {list}",
    dueToday: "I dag: {list}",
    todosWaiting: "Oppgaver: {n} venter ({a} n\xE5r som helst, {b} p\xE5 steder)",
    doneWeek: "Ferdig denne uken: {n}",
    forToday_one: "{n} oppgave i dag:",
    forToday_other: "{n} oppgaver i dag:",
    lastDone: "Sist gjort {d}.",
    notDone: "Ikke gjort enn\xE5."
  }
};
var NB_TASKS = houseTasks_nb_default;
var pickLang = /* @__PURE__ */ __name((v) => String(v ?? "").toLowerCase().startsWith("nb") || String(v ?? "").toLowerCase() === "no" ? "nb" : "en", "pickLang");
var w = /* @__PURE__ */ __name((lang) => WORDS[lang] ?? WORDS.en, "w");
var fmt = /* @__PURE__ */ __name((str, params = {}) => str.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")), "fmt");
var plural = /* @__PURE__ */ __name((lang, base, n, params = {}) => fmt(w(lang)[`${base}_${n === 1 ? "one" : "other"}`], { n, ...params }), "plural");
var taskTitle = /* @__PURE__ */ __name((t, lang = "en") => lang === "nb" && t.template_key && NB_TASKS[t.template_key]?.title || t.title, "taskTitle");
var taskNotes = /* @__PURE__ */ __name((t, lang = "en") => lang === "nb" && t.template_key && NB_TASKS[t.template_key]?.notes || t.notes, "taskNotes");
function todayIn(tz = DEFAULT_TZ, now = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
__name(todayIn, "todayIn");
var utc = /* @__PURE__ */ __name((ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)), "utc");
var daysBetween = /* @__PURE__ */ __name((from, to) => Math.round((utc(to) - utc(from)) / 864e5), "daysBetween");
function addDays(ymd, n) {
  return new Date(utc(ymd) + n * 864e5).toISOString().slice(0, 10);
}
__name(addDays, "addDays");
var firstLine = /* @__PURE__ */ __name((s, lang = "en") => String(s ?? "").split("\n")[0].trim() || w(lang).photo, "firstLine");
function scheduleText(t, lang = "en") {
  const x = w(lang);
  if (t.schedule === "seasonal" && t.window_start_month && t.window_end_month) {
    const a = x.months[t.window_start_month - 1];
    const b = x.months[t.window_end_month - 1];
    return a === b ? fmt(x.everyYearIn, { a }) : fmt(x.everyYearSeason, { a, b });
  }
  const n = t.interval_months ?? 12;
  if (n % 12 === 0) return n === 12 ? x.everyYear : fmt(x.everyYears, { n: n / 12 });
  return n === 1 ? x.everyMonth : fmt(x.everyMonths, { n });
}
__name(scheduleText, "scheduleText");
function when(days, lang) {
  const x = w(lang);
  if (days <= 0) return x.now;
  if (days === 1) return x.tomorrow;
  if (days < 14) return fmt(x.inDays, { n: days });
  return fmt(x.inWeeks, { n: Math.round(days / 7) });
}
__name(when, "when");
var MAX_ITEMS = 8;
function placeText(feed, { place, category, lang = "en" }) {
  const q = (place ?? "").trim().toLowerCase();
  const c = (category ?? "").trim().toLowerCase();
  if (!q && !c) return "";
  const matched = feed.places.filter((p) => q && p.name.toLowerCase().includes(q) || c && (p.category ?? "").toLowerCase() === c);
  if (matched.length === 0) return "";
  const ids = new Set(matched.map((p) => p.id));
  const todos = feed.todos.filter((t) => t.place_id && ids.has(t.place_id));
  if (todos.length === 0) return "";
  const label = matched.length === 1 ? matched[0].name : c || matched[0].name;
  const shown = todos.slice(0, MAX_ITEMS).map((t) => `- ${firstLine(t.body, lang)}`);
  const lines = [plural(lang, "todosAt", todos.length, { label }), ...shown];
  if (todos.length > MAX_ITEMS) lines.push(fmt(w(lang).more, { n: todos.length - MAX_ITEMS }));
  const cats = new Set(matched.map((p) => (p.category ?? "").toLowerCase()).filter(Boolean));
  const useful = feed.facts.filter((f) => f.surface_at.some((s) => cats.has(s.toLowerCase())));
  if (useful.length) {
    lines.push("", w(lang).useful, ...useful.slice(0, 5).map((f) => `- ${f.title}${f.value ? `: ${firstLine(f.value, lang)}` : ""}`));
  }
  return lines.join("\n");
}
__name(placeText, "placeText");
function digestText(feed, { tz = DEFAULT_TZ, now = /* @__PURE__ */ new Date(), lang = "en" } = {}) {
  const x = w(lang);
  const today = todayIn(tz, now);
  const due = feed.tasks.filter((t) => t.next_due_at <= today);
  const soon = feed.tasks.filter((t) => t.next_due_at > today && daysBetween(today, t.next_due_at) <= 21);
  const lines = [];
  if (due.length) lines.push(fmt(x.dueNow, { list: `${due.slice(0, 5).map((t) => taskTitle(t, lang)).join(", ")}${due.length > 5 ? ` +${due.length - 5}` : ""}` }));
  if (soon.length) lines.push(fmt(x.comingUp, { list: soon.slice(0, 3).map((t) => `${taskTitle(t, lang)} (${when(daysBetween(today, t.next_due_at), lang)})`).join(", ") }));
  const dated = dueToday(feed, today);
  if (dated.length) lines.push(fmt(x.dueToday, { list: `${dated.slice(0, 3).map((t) => firstLine(t.body, lang)).join(", ")}${dated.length > 3 ? ` +${dated.length - 3}` : ""}` }));
  const anytime = feed.todos.filter((t) => !t.place_id).length;
  const atPlace = feed.todos.length - anytime;
  if (feed.todos.length) lines.push(fmt(x.todosWaiting, { n: feed.todos.length, a: anytime, b: atPlace }));
  const doneWeek = Number(feed.done_week ?? 0);
  if (lines.length && doneWeek > 0) lines.push(fmt(x.doneWeek, { n: doneWeek }));
  return lines.length ? ["Home Memory", ...lines].join("\n") : "";
}
__name(digestText, "digestText");
var hhmm = /* @__PURE__ */ __name((t) => t ? String(t).slice(0, 5) : "", "hhmm");
var byDue = /* @__PURE__ */ __name((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? "") || hhmm(a.due_time).localeCompare(hhmm(b.due_time)), "byDue");
function dueToday(feed, today) {
  return feed.todos.filter((t) => t.due_on && t.due_on <= today).sort(byDue);
}
__name(dueToday, "dueToday");
function todayText(feed, { tz = DEFAULT_TZ, now = /* @__PURE__ */ new Date(), lang = "en" } = {}) {
  const items = dueToday(feed, todayIn(tz, now));
  if (items.length === 0) return "";
  const lines = items.slice(0, MAX_ITEMS).map((t) => `- ${hhmm(t.due_time) ? `${hhmm(t.due_time)} ` : ""}${firstLine(t.body, lang)}`);
  if (items.length > MAX_ITEMS) lines.push(fmt(w(lang).more, { n: items.length - MAX_ITEMS }));
  return [plural(lang, "forToday", items.length), ...lines].join("\n");
}
__name(todayText, "todayText");
var CRLF = "\r\n";
function escapeText(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
__name(escapeText, "escapeText");
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) {
      out.push(cur);
      cur = ` ${ch}`;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join(CRLF);
}
__name(fold, "fold");
var compact = /* @__PURE__ */ __name((ymd) => ymd.replaceAll("-", ""), "compact");
var stamp = /* @__PURE__ */ __name((d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""), "stamp");
function buildIcs(feed, { now = /* @__PURE__ */ new Date(), lang = "en" } = {}) {
  const x = w(lang);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Home Memory//Tasks and to-dos//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`${feed.household} Home Memory`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H"
  ];
  for (const t of feed.tasks) {
    const start = t.next_due_at;
    const endInclusive = t.due_until && t.due_until >= start ? t.due_until : start;
    const title = taskTitle(t, lang);
    const description = [`${scheduleText(t, lang)}.`, t.last_done_at ? fmt(x.lastDone, { d: t.last_done_at }) : x.notDone, taskNotes(t, lang)].filter(Boolean).join(" ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.id}@homememory`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `DTEND;VALUE=DATE:${compact(addDays(endInclusive, 1))}`,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(description)}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(title)}`,
      "TRIGGER:PT9H",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  const placeById = new Map(feed.places.map((p) => [p.id, p]));
  for (const t of feed.todos) {
    if (!t.due_on) continue;
    const place = t.place_id ? placeById.get(t.place_id) : null;
    const time = hhmm(t.due_time);
    const title = firstLine(t.body, lang);
    const where = place ? [place.name, place.address].filter(Boolean).join(", ") : "";
    lines.push("BEGIN:VEVENT", `UID:todo-${t.id}@homememory`, `DTSTAMP:${stamp(now)}`);
    if (time) {
      const start = new Date(Date.UTC(+t.due_on.slice(0, 4), +t.due_on.slice(5, 7) - 1, +t.due_on.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5)));
      const end = new Date(start.getTime() + 30 * 6e4);
      const local = /* @__PURE__ */ __name((d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, ""), "local");
      lines.push(`DTSTART:${local(start)}`, `DTEND:${local(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(t.due_on)}`, `DTEND;VALUE=DATE:${compact(addDays(t.due_on, 1))}`);
    }
    const rrule = { daily: "FREQ=DAILY", weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekly: "FREQ=WEEKLY", biweekly: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY", yearly: "FREQ=YEARLY" }[t.repeat_rule ?? ""];
    if (rrule) lines.push(`RRULE:${rrule}`);
    lines.push(`SUMMARY:${escapeText(title)}`);
    if (where) lines.push(`LOCATION:${escapeText(where)}`);
    lines.push("TRANSP:TRANSPARENT", "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(title)}`, time ? "TRIGGER:PT0S" : "TRIGGER:PT9H", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}
__name(buildIcs, "buildIcs");
async function loadFeed({ url, anonKey, key, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/rpc/reminder_feed`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: key })
    });
    if (!res.ok) return { status: "error" };
    const data = await res.json();
    return data ? { status: "ok", feed: data } : { status: "invalid" };
  } catch {
    return { status: "error" };
  }
}
__name(loadFeed, "loadFeed");

// netlify/functions/remind.mjs
var netlifyEnv = /* @__PURE__ */ __name((name) => globalThis.Netlify?.env?.get?.(name) ?? globalThis.process?.env?.[name], "netlifyEnv");
var text = /* @__PURE__ */ __name((body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }), "text");
async function handle(req, env = (name) => netlifyEnv(name)) {
  const url = new URL(req.url);
  const supabaseUrl = env("VITE_SUPABASE_URL") ?? env("SUPABASE_URL");
  const anonKey = env("VITE_SUPABASE_ANON_KEY") ?? env("SUPABASE_ANON_KEY");
  if (url.searchParams.has("ping")) return text(supabaseUrl && anonKey ? "ok: configured" : "ok: missing Supabase environment variables");
  if (!supabaseUrl || !anonKey) return text("Not configured.", 500);
  const key = url.searchParams.get("key") ?? "";
  if (!/^hmr_[0-9a-f]{64}$/.test(key)) return text("This reminder link is not valid.", 401);
  const result = await loadFeed({ url: supabaseUrl, anonKey, key });
  if (result.status === "invalid") return text("This reminder link is not valid (it may have been revoked).", 401);
  if (result.status === "error") return text("Could not read your data right now. Try again later.", 502);
  const { feed } = result;
  const lang = pickLang(url.searchParams.get("lang"));
  if (url.pathname.endsWith(".ics")) {
    return new Response(buildIcs(feed, { lang }), {
      status: 200,
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="home-memory.ics"', "Cache-Control": "no-store" }
    });
  }
  const place = url.searchParams.get("place");
  const category = url.searchParams.get("category");
  const tz = url.searchParams.get("tz") || void 0;
  if (place || category) return text(placeText(feed, { place, category, lang }));
  return text(url.searchParams.get("mode") === "today" ? todayText(feed, { tz, lang }) : digestText(feed, { tz, lang }));
}
__name(handle, "handle");

// worker/upload-relay.js
var HOSTS = /* @__PURE__ */ new Set(["outlook.office.com", "outlook.office365.com", "outlook.live.com"]);
var MAX_SLICE = 4 * 1024 * 1024;
function isUploadAddress(value) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    return false;
  }
  let path;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.port && !u.username && !u.password && HOSTS.has(u.hostname) && /\/AttachmentSessions\(/i.test(path);
}
__name(isUploadAddress, "isUploadAddress");
async function relayUpload(request, send = fetch) {
  const reply = /* @__PURE__ */ __name((status, message) => new Response(JSON.stringify({ error: { code: "relay", message } }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Post-Relay": "1" } }), "reply");
  if (request.method !== "PUT") return reply(405, "PUT only");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return reply(403, "Post only");
  const target = request.headers.get("X-Upload-Url") ?? "";
  if (!isUploadAddress(target)) return reply(400, "Not an Outlook upload address");
  const range = request.headers.get("Content-Range") ?? "";
  if (!/^bytes \d{1,12}-\d{1,12}\/\d{1,12}$/.test(range)) return reply(400, "Content-Range is missing");
  const announced = Number(request.headers.get("Content-Length"));
  if (announced > MAX_SLICE) return reply(413, "Slice too big");
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_SLICE) return reply(bytes.byteLength ? 413 : 400, bytes.byteLength ? "Slice too big" : "Nothing to upload");
  let res;
  try {
    res = await send(target, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Range": range }, body: bytes, redirect: "manual" });
  } catch {
    return reply(502, "Could not reach Outlook");
  }
  const headers = new Headers({ "Cache-Control": "no-store", "X-Post-Relay": "1" });
  const type = res.headers.get("Content-Type");
  if (type) headers.set("Content-Type", type);
  return new Response(res.status === 204 || res.status === 205 || res.status === 304 ? null : res.body, { status: res.status, headers });
}
__name(relayUpload, "relayUpload");

// worker/index.js
var worker_default = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/remind" || pathname === "/calendar.ics") return handle(request, (name) => env[name]);
    if (pathname === "/api/post-upload") return relayUpload(request);
    return env.ASSETS.fetch(request);
  }
};

// ../../../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-UhThDI/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-UhThDI/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
