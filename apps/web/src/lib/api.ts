import { supabase } from './supabase';
import type { Fact, FactCategory } from './facts';
import type { ReportSummary } from './report';
import type { Hit } from './placeSearch';
import { enqueue, flushQueue, isNetworkError, pendingFor, type KV, type QueuedTodo } from './outbox.ts';
import type { HouseProfile, Household, MaintenanceEvent, MaintenanceTask, Media, Member, Memory, MemoryStatus, Place, RepeatRule, Suggestion } from './types';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function getHousehold(): Promise<Household | null> {
  const rows = check(
    await supabase.from('household_members').select('households(id, name, invite_code)').limit(1),
  ) as unknown as { households: Household | null }[];
  return rows[0]?.households ?? null;
}

export async function createHousehold(name: string, displayName: string) {
  check(await supabase.rpc('create_household', { p_name: name, p_display_name: displayName }));
}

export async function joinHousehold(code: string, displayName: string) {
  const id = check(await supabase.rpc('join_household', { p_invite_code: code, p_display_name: displayName }));
  if (!id) throw new Error('invalid_invite');
}

export async function rotateInviteCode(householdId: string): Promise<string> {
  return check(await supabase.rpc('rotate_invite_code', { p_household_id: householdId })) as string;
}

export async function listMembers(householdId: string): Promise<Member[]> {
  return check(await supabase.from('household_members').select('user_id, display_name').eq('household_id', householdId));
}

// localStorage that never throws (private windows, blocked storage).
export const safeKV: KV = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const cacheKey = (householdId: string) => `hm.cache.open.${householdId}`;

/** The last open list we saw, for opening the app without a connection. */
export function cachedOpenMemories(householdId: string): Memory[] {
  try { const v = JSON.parse(safeKV.getItem(cacheKey(householdId)) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function listMemories(householdId: string, statuses: MemoryStatus[]): Promise<Memory[]> {
  const list: Memory[] = check(
    await supabase
      .from('memories')
      .select('*')
      .eq('household_id', householdId)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .limit(200)
      .retry(false), // fail fast when offline (the default retries for several seconds), the list then comes from the device
  );
  if (statuses.includes('active') || statuses.includes('inbox')) safeKV.setItem(cacheKey(householdId), JSON.stringify(list.slice(0, 100)));
  return list;
}

/** Finished to-dos from the last few days, for the weekly recap. */
export async function listDoneSince(householdId: string, days = 7): Promise<Pick<Memory, 'id' | 'done_at' | 'done_by' | 'author_id'>[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return check(await supabase.from('memories').select('id, done_at, done_by, author_id').eq('household_id', householdId).eq('status', 'done').gte('done_at', since).limit(500));
}

export type NewMemory = {
  id?: string;
  household_id: string;
  body: string;
  place_id?: string | null;
  place_category?: string | null;
  due_on?: string | null;
  due_time?: string | null;
  repeat_rule?: RepeatRule | null;
  capture_lat?: number | null;
  capture_lon?: number | null;
  capture_accuracy_m?: number | null;
};

// A to-do with a place or a date is "active" (it has a reason to surface); one with neither waits in the inbox.
export const statusFor = (m: { place_id?: string | null; place_category?: string | null; due_on?: string | null }): MemoryStatus =>
  m.place_id || m.place_category || m.due_on ? 'active' : 'inbox';

const toRow = (m: NewMemory & { id: string }) => ({
  ...m, due_time: m.due_on ? m.due_time ?? null : null, repeat_rule: m.due_on ? m.repeat_rule ?? null : null, status: statusFor(m),
});

/** The to-do as it shows on this device while it waits to be sent. */
export function queuedToMemory(q: QueuedTodo): Memory {
  return {
    id: q.id, household_id: q.household_id, author_id: q.author_id, body: q.body, status: q.due_on || q.place_id ? 'active' : 'inbox',
    place_id: q.place_id, place_category: null, created_at: q.created_at, done_at: null, suggestion: null, suggested_at: new Date().toISOString(),
    due_on: q.due_on, due_time: q.due_on ? q.due_time : null, repeat_rule: (q.repeat_rule as RepeatRule | null) ?? null, pending: true,
  };
}

/** Saves a to-do. Without a connection it is kept on the device and sent later (see flushOutbox); the result then has `pending: true`. */
export async function addMemory(m: NewMemory): Promise<Memory> {
  const row = toRow({ ...m, id: m.id ?? crypto.randomUUID() });
  try {
    return check(await supabase.from('memories').insert(row).select().single());
  } catch (e) {
    if (!isNetworkError(e, navigator.onLine)) throw e;
    const { data } = await supabase.auth.getSession();
    const q: QueuedTodo = {
      id: row.id, household_id: m.household_id, body: m.body, place_id: m.place_id ?? null, due_on: row.due_on ?? null, due_time: row.due_time,
      repeat_rule: row.repeat_rule, author_id: data.session?.user.id ?? '', created_at: new Date().toISOString(),
    };
    enqueue(safeKV, q);
    return queuedToMemory(q);
  }
}

export const pendingTodos = (householdId: string): Memory[] => pendingFor(safeKV, householdId).map(queuedToMemory);

/** Sends whatever was written offline. Returns the ids that reached the server. */
export async function flushOutbox(): Promise<string[]> {
  const r = await flushQueue(safeKV, async (q) => {
    const { error } = await supabase.from('memories').insert(toRow({
      id: q.id, household_id: q.household_id, body: q.body, place_id: q.place_id, due_on: q.due_on, due_time: q.due_time, repeat_rule: q.repeat_rule as RepeatRule | null,
    }));
    if (error && !/duplicate key|23505/.test(error.message + (error as { code?: string }).code)) throw new Error(error.message);
  }, navigator.onLine);
  return r.sent;
}

type Patch = Partial<Pick<Memory, 'body' | 'status' | 'place_id' | 'place_category' | 'done_at' | 'due_on' | 'due_time' | 'repeat_rule' | 'done_by'>>;

export async function updateMemory(id: string, patch: Patch) {
  check(await supabase.from('memories').update(patch).eq('id', id));
}

/** Edit text, place and date together. The status follows what the to-do now has. */
export async function updateMemoryFields(id: string, f: { body: string; place_id: string | null; due_on: string | null; due_time: string | null; repeat_rule?: RepeatRule | null }) {
  await updateMemory(id, { ...f, due_time: f.due_on ? f.due_time : null, repeat_rule: f.due_on ? f.repeat_rule ?? null : null, status: statusFor(f) });
}

/** Ticks a to-do off (and, for a repeating one, creates the next occurrence). Returns the next occurrence's id, if any. */
export async function markDone(id: string): Promise<string | null> {
  const next = check(await supabase.rpc('complete_memory', { p_id: id })) as string | null;
  return next ?? null;
}

export async function reopen(id: string, m: { place_id: string | null; due_on: string | null }) {
  await updateMemory(id, { status: statusFor(m), done_at: null, done_by: null });
}

/** Deleting is a soft delete so it can be undone. Old dismissed to-dos are purged by purgeDismissed. */
export async function softDelete(id: string) {
  await updateMemory(id, { status: 'dismissed' });
}

export async function restoreMemory(id: string, m: { place_id: string | null; due_on: string | null }) {
  await updateMemory(id, { status: statusFor(m), done_at: null });
}

export async function purgeDismissed(householdId: string, olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  await supabase.from('memories').delete().eq('household_id', householdId).eq('status', 'dismissed').lt('created_at', cutoff);
}

export async function deleteMemory(id: string) {
  check(await supabase.from('memories').delete().eq('id', id));
}

/** Live updates: calls onChange when anything in this household's to-dos or places changes (partner added something). */
export function subscribeHousehold(householdId: string, onChange: () => void): () => void {
  const ch = supabase
    .channel(`hm-${householdId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memories', filter: `household_id=eq.${householdId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places', filter: `household_id=eq.${householdId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}

export async function listPlaces(householdId: string): Promise<Place[]> {
  return check(await supabase.from('places').select('*').eq('household_id', householdId).order('created_at'));
}

export async function addPlace(p: Omit<Place, 'id'>): Promise<Place> {
  return check(await supabase.from('places').insert(p).select().single());
}

/** Where a to-do goes, as chosen in the add sheet. */
export type Where =
  | { kind: 'none' }
  | { kind: 'place'; placeId: string }
  | { kind: 'category'; category: string; name: string }
  | { kind: 'hit'; hit: Hit; kindOfShop: string | null };

/** Turns the choice into a place id, reusing a saved place when there is one (no duplicates). */
export async function resolveWhere(householdId: string, where: Where, places: Place[], find: (places: Place[], hit: Hit) => Place | null): Promise<{ placeId: string | null; created: Place | null }> {
  if (where.kind === 'none') return { placeId: null, created: null };
  if (where.kind === 'place') return { placeId: where.placeId, created: null };
  if (where.kind === 'category') {
    const have = places.find((p) => p.kind === 'category' && p.category === where.category);
    if (have) return { placeId: have.id, created: null };
    const created = await addPlace({ household_id: householdId, name: where.name, kind: 'category', category: where.category, lat: null, lon: null, radius_m: 150 });
    return { placeId: created.id, created };
  }
  const have = find(places, where.hit);
  if (have) return { placeId: have.id, created: null };
  const created = await addPlace({
    household_id: householdId, name: where.hit.name, kind: 'fixed', category: where.kindOfShop ?? where.hit.category,
    lat: where.hit.lat, lon: where.hit.lon, radius_m: where.hit.isAddress ? 150 : 200, address: where.hit.address || null,
  });
  return { placeId: created.id, created };
}

export async function updatePlaceCategory(id: string, category: string | null) {
  check(await supabase.from('places').update({ category }).eq('id', id));
}

export async function deletePlace(id: string) {
  check(await supabase.from('places').delete().eq('id', id));
}

// Photos are downscaled in the browser first: phone photos are several MB each.
async function downscale(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85),
  );
}

export async function uploadPhoto(householdId: string, memoryId: string, file: File) {
  const blob = await downscale(file);
  const path = `${householdId}/${memoryId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from('media').upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) throw new Error(up.error.message);
  check(await supabase.from('media').insert({ memory_id: memoryId, household_id: householdId, kind: 'photo', storage_path: path }));
}

export async function listPhotoUrls(memoryIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (memoryIds.length === 0) return out;
  const media: Media[] = check(await supabase.from('media').select('*').in('memory_id', memoryIds).eq('kind', 'photo'));
  if (media.length === 0) return out;
  const signed = await supabase.storage.from('media').createSignedUrls(media.map((m) => m.storage_path), 3600);
  if (signed.error) throw new Error(signed.error.message);
  const urlByPath = new Map(signed.data.map((s) => [s.path, s.signedUrl] as const));
  for (const m of media) {
    const url = urlByPath.get(m.storage_path);
    if (url) out.set(m.memory_id, [...(out.get(m.memory_id) ?? []), url]);
  }
  return out;
}

export type CaptureKey = { id: string; label: string; created_at: string; last_used_at: string | null };

export async function listCaptureKeys(): Promise<CaptureKey[]> {
  return check(await supabase.from('capture_keys').select('id, label, created_at, last_used_at').order('created_at'));
}

export async function createCaptureKey(householdId: string, label: string): Promise<string> {
  return check(await supabase.rpc('create_capture_key', { p_household_id: householdId, p_label: label })) as string;
}

export async function deleteCaptureKey(id: string) {
  check(await supabase.from('capture_keys').delete().eq('id', id));
}

export async function listTasks(householdId: string): Promise<MaintenanceTask[]> {
  return check(await supabase.from('maintenance_tasks').select('*').eq('household_id', householdId).eq('active', true));
}

export async function seedHouseTemplate(householdId: string, profile: HouseProfile): Promise<number> {
  return check(await supabase.rpc('seed_house_template', { p_household_id: householdId, p_profile: profile })) as number;
}

export async function completeTask(id: string, opts: { cost?: number | null; note?: string; doneAt?: string }) {
  check(
    await supabase.rpc('complete_maintenance', {
      p_task_id: id, p_done_at: opts.doneAt ?? new Date().toISOString().slice(0, 10),
      p_cost: opts.cost ?? null, p_note: opts.note ?? null,
    }),
  );
}

export async function listTaskEvents(taskId: string): Promise<MaintenanceEvent[]> {
  return check(
    await supabase.from('maintenance_events').select('id, done_at, cost_nok, note').eq('task_id', taskId).order('done_at', { ascending: false }).limit(20),
  );
}

export async function retireTask(id: string) {
  check(await supabase.from('maintenance_tasks').update({ active: false }).eq('id', id));
}

export async function updatePlaceRadius(id: string, radius: number) {
  check(await supabase.from('places').update({ radius_m: radius }).eq('id', id));
}

// AI place suggestion (edge function `suggest`). Resolves to null when the feature is not set up or nothing fits.
export async function requestSuggestion(memoryId: string): Promise<{ suggestion: Suggestion | null; unavailable: boolean }> {
  const { data, error } = await supabase.functions.invoke('suggest', { body: { memory_id: memoryId } });
  if (error) return { suggestion: null, unavailable: true };
  return { suggestion: ((data as { suggestion?: Suggestion | null } | null)?.suggestion) ?? null, unavailable: false };
}

export async function acceptSuggestion(memoryId: string, householdId: string, s: Suggestion) {
  if (s.kind === 'recurring' && s.recurring) {
    // Turn the to-do into a recurring house task, and retire the to-do.
    await addTask({
      householdId, title: s.recurring.title, schedule: s.recurring.schedule,
      intervalMonths: s.recurring.interval_months, windowStart: s.recurring.window_start, windowEnd: s.recurring.window_end,
    });
    check(await supabase.from('memories').update({ status: 'dismissed', suggestion: null }).eq('id', memoryId));
    return;
  }
  let placeId = s.place_id;
  if (s.kind === 'category' && s.category) {
    const row = check(
      await supabase.from('places').insert({ household_id: householdId, name: s.label, kind: 'category', category: s.category, radius_m: 150 }).select('id').single(),
    ) as { id: string };
    placeId = row.id;
  }
  if (!placeId) throw new Error('No place to attach');
  check(await supabase.from('memories').update({ place_id: placeId, status: 'active', suggestion: null }).eq('id', memoryId));
}

export async function dismissSuggestion(memoryId: string) {
  check(await supabase.from('memories').update({ suggestion: null }).eq('id', memoryId));
}

export async function listFacts(householdId: string): Promise<Fact[]> {
  return check(await supabase.from('house_facts').select('id, household_id, title, value, category, surface_at').eq('household_id', householdId));
}

export async function addFact(f: { household_id: string; title: string; value: string; category: FactCategory; surface_at: string[] }) {
  check(await supabase.from('house_facts').insert(f));
}

export async function deleteFact(id: string) {
  check(await supabase.from('house_facts').delete().eq('id', id));
}

export async function addTask(t: {
  householdId: string; title: string; notes?: string; schedule: 'interval' | 'seasonal';
  intervalMonths?: number; windowStart?: number; windowEnd?: number; lastDone?: string | null;
}) {
  check(
    await supabase.rpc('add_maintenance_task', {
      p_household_id: t.householdId, p_title: t.title, p_notes: t.notes ?? null, p_schedule: t.schedule,
      p_interval_months: t.intervalMonths ?? null, p_ws: t.windowStart ?? null, p_we: t.windowEnd ?? null,
      p_last_done: t.lastDone ?? null,
    }),
  );
}

// Tilstandsrapport import: upload the PDF to the private bucket, then ask the edge function to read it.
export async function importReport(householdId: string, file: File): Promise<ReportSummary> {
  const path = `${householdId}/reports/${crypto.randomUUID()}.pdf`;
  const up = await supabase.storage.from('media').upload(path, file, { contentType: 'application/pdf' });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await supabase.functions.invoke('import-report', { body: { path } });
  if (error) {
    let code = '';
    try { code = ((await (error as { context?: Response }).context?.json()) as { error?: string })?.error ?? ''; } catch { /* no body */ }
    throw new Error(`report:${['not_configured', 'too_large', 'incomplete', 'unreadable', 'limit'].includes(code) ? (code === 'unreadable' ? 'incomplete' : code) : 'failed'}`);
  }
  return (data as { report: ReportSummary }).report;
}

// Reminder keys: read-only links for iPhone Shortcuts automations and the Calendar app (served by the Netlify function).
export type FeedKey = { id: string; label: string; created_at: string; last_used_at: string | null };

export async function listFeedKeys(): Promise<FeedKey[]> {
  return check(await supabase.from('feed_keys').select('id, label, created_at, last_used_at').order('created_at'));
}

export async function createFeedKey(householdId: string, label: string): Promise<string> {
  return check(await supabase.rpc('create_feed_key', { p_household_id: householdId, p_label: label })) as string;
}

export async function deleteFeedKey(id: string) {
  check(await supabase.from('feed_keys').delete().eq('id', id));
}

// The "get set up" checklist: cheap head-only counts, so nothing is downloaded.
export async function getSetupStatus(householdId: string): Promise<import('./setup').SetupStatus> {
  const has = async (table: string, col: string, filter?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from(table).select(col, { count: 'exact', head: true });
    q = filter ? filter(q) : q;
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  };
  const [places, todos, calendar, emergency, reminders, members] = await Promise.all([
    has('places', 'id', (q) => q.eq('household_id', householdId)),
    has('memories', 'id', (q) => q.eq('household_id', householdId)),
    has('maintenance_tasks', 'id', (q) => q.eq('household_id', householdId).eq('active', true)),
    has('house_facts', 'id', (q) => q.eq('household_id', householdId).eq('category', 'emergency')),
    has('feed_keys', 'id'),
    supabase.from('household_members').select('user_id', { count: 'exact', head: true }).eq('household_id', householdId),
  ]);
  return { places, todos, calendar, emergency, reminders, partner: (members.count ?? 0) > 1 };
}


// Photo of a label, tin, receipt or warranty: upload, then let the AI turn it into a fact to confirm.
export type LabelFact = { title: string; value: string; category: FactCategory; surface_at: string[] };

export async function readLabel(householdId: string, file: File, lang: 'en' | 'nb'): Promise<LabelFact> {
  const blob = await downscale(file, 1800);
  const path = `${householdId}/labels/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from('media').upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await supabase.functions.invoke('read-label', { body: { path, lang } });
  if (error) {
    let code = '';
    try { code = ((await (error as { context?: Response }).context?.json()) as { error?: string })?.error ?? ''; } catch { /* no body */ }
    throw new Error(`label:${['not_configured', 'too_large', 'unreadable', 'limit'].includes(code) ? code : 'failed'}`);
  }
  return (data as { fact: LabelFact }).fact;
}

export { notifyPartner as notifyPartnerIfSet } from './push';


// Deleting your account: first the photos and files of any household you are alone in, then the database rows and the login.
async function removeHouseholdFiles(householdId: string) {
  const bucket = supabase.storage.from('media');
  const paths: string[] = [];
  const top = await bucket.list(householdId, { limit: 1000 });
  for (const e of top.data ?? []) {
    if (e.id) { paths.push(`${householdId}/${e.name}`); continue; }
    const sub = await bucket.list(`${householdId}/${e.name}`, { limit: 1000 });
    for (const f of sub.data ?? []) if (f.id) paths.push(`${householdId}/${e.name}/${f.name}`);
  }
  for (let i = 0; i < paths.length; i += 100) await bucket.remove(paths.slice(i, i + 100));
}

export async function deleteMyAccount(householdId: string | null) {
  if (householdId) {
    const members = await listMembers(householdId);
    if (members.length <= 1) await removeHouseholdFiles(householdId).catch(() => {});
  }
  check(await supabase.rpc('delete_my_account'));
  await supabase.auth.signOut().catch(() => {});
}
