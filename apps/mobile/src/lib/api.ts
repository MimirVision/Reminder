import * as ImageManipulator from 'expo-image-manipulator';
import { readJson, writeJson } from './store';
import { supabase } from './supabase';
import type { FactCategory } from '../core/facts.ts';
import type { Hit } from '../shared/lib/placeSearch';
import type { CaptureKey, HouseFact, HouseProfile, Household, MaintenanceEvent, MaintenanceTask, Member, Memory, Place, Suggestion } from './types';

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

export async function listMemories(householdId: string, statuses: Memory['status'][]): Promise<Memory[]> {
  return check(
    await supabase
      .from('memories')
      .select('*')
      .eq('household_id', householdId)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .limit(200),
  );
}

export async function listPlaces(householdId: string): Promise<Place[]> {
  return check(await supabase.from('places').select('*').eq('household_id', householdId).order('created_at'));
}

export async function addPlace(p: Omit<Place, 'id'>): Promise<Place> {
  return check(await supabase.from('places').insert(p).select().single()) as Place;
}

export async function deletePlace(id: string) {
  check(await supabase.from('places').delete().eq('id', id));
}

export async function updatePlaceCategory(id: string, category: string | null) {
  check(await supabase.from('places').update({ category }).eq('id', id));
}

// A to-do with a place or a date is "active" (it has a reason to surface); one with neither waits in the inbox.
export const statusFor = (m: { place_id?: string | null; due_on?: string | null }): Memory['status'] => (m.place_id || m.due_on ? 'active' : 'inbox');

type Patch = Partial<Pick<Memory, 'status' | 'place_id' | 'done_at' | 'body' | 'due_on' | 'due_time' | 'repeat_rule' | 'done_by'>>;

export async function updateMemory(id: string, patch: Patch) {
  check(await supabase.from('memories').update(patch).eq('id', id));
}

/** Edit text, place and date together. The status follows what the to-do now has. */
export async function updateMemoryFields(id: string, f: { body: string; place_id: string | null; due_on: string | null; due_time: string | null; repeat_rule?: Memory['repeat_rule'] }) {
  await updateMemory(id, { ...f, due_time: f.due_on ? f.due_time : null, repeat_rule: f.due_on ? f.repeat_rule ?? null : null, status: statusFor(f) });
}

/** Ticks a to-do off. A repeating one also gets its next occurrence; that new to-do's id is returned so it can be undone. */
export async function completeMemory(id: string): Promise<string | null> {
  return (check(await supabase.rpc('complete_memory', { p_id: id })) as string | null) ?? null;
}

export async function markDone(ids: string[]) {
  for (const id of ids) await completeMemory(id);
}

export async function reopenMemory(id: string, m: { place_id: string | null; due_on: string | null }) {
  await updateMemory(id, { status: statusFor(m), done_at: null, done_by: null });
}

/** Deleting is a soft delete so it can be undone. Old dismissed to-dos are purged after 30 days. */
export async function softDelete(id: string) {
  await updateMemory(id, { status: 'dismissed' });
}

export async function purgeDismissed(householdId: string, olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  await supabase.from('memories').delete().eq('household_id', householdId).eq('status', 'dismissed').lt('created_at', cutoff);
}

export async function deleteMemory(id: string) {
  check(await supabase.from('memories').delete().eq('id', id));
}

export async function getMemory(id: string): Promise<Memory | null> {
  const res = await supabase.from('memories').select('*').eq('id', id).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return (res.data as Memory | null) ?? null;
}

export async function listDoneSince(householdId: string, days = 7): Promise<Pick<Memory, 'id' | 'done_at' | 'done_by' | 'author_id'>[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return check(await supabase.from('memories').select('id, done_at, done_by, author_id').eq('household_id', householdId).eq('status', 'done').gte('done_at', since).limit(500));
}

/** Live updates: calls onChange when anything in this household's to-dos or places changes (the partner added something). */
export function subscribeHousehold(householdId: string, onChange: () => void): () => void {
  const ch = supabase
    .channel(`hm-${householdId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memories', filter: `household_id=eq.${householdId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places', filter: `household_id=eq.${householdId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}

export type NewMemory = {
  id: string; // client-generated so offline retries are idempotent
  household_id: string;
  body: string;
  place_id: string | null;
  due_on?: string | null;
  due_time?: string | null;
  repeat_rule?: Memory['repeat_rule'];
  capture_lat: number | null;
  capture_lon: number | null;
};

export async function insertMemory(m: NewMemory) {
  const row = { ...m, due_time: m.due_on ? m.due_time ?? null : null, repeat_rule: m.due_on ? m.repeat_rule ?? null : null, status: statusFor(m) };
  const res = await supabase.from('memories').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (res.error) throw new Error(res.error.message);
}

/** Where a to-do goes, as chosen in the add screen. */
export type Where =
  | { kind: 'none' }
  | { kind: 'place'; placeId: string }
  | { kind: 'category'; category: string; name: string }
  | { kind: 'hit'; hit: Hit; kindOfShop: string | null };

/** Turns the choice into a place id, reusing a saved place when there is one (no duplicates). */
export async function resolveWhere(householdId: string, where: Where, places: Place[], find: (places: Place[], hit: Hit) => Place | null): Promise<string | null> {
  if (where.kind === 'none') return null;
  if (where.kind === 'place') return where.placeId;
  if (where.kind === 'category') {
    const have = places.find((p) => p.kind === 'category' && p.category === where.category);
    if (have) return have.id;
    return (await addPlace({ household_id: householdId, name: where.name, kind: 'category', category: where.category, lat: null, lon: null, radius_m: 150 })).id;
  }
  const have = find(places, where.hit);
  if (have) return have.id;
  return (await addPlace({
    household_id: householdId, name: where.hit.name, kind: 'fixed', category: where.kindOfShop ?? where.hit.category,
    lat: where.hit.lat, lon: where.hit.lon, radius_m: where.hit.isAddress ? 150 : 200, address: where.hit.address || null,
  })).id;
}

export async function uploadPhoto(householdId: string, memoryId: string, uri: string) {
  const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const bytes = await (await fetch(small.uri)).arrayBuffer();
  const path = `${householdId}/${memoryId}/${Date.now()}.jpg`;
  const up = await supabase.storage.from('media').upload(path, bytes, { contentType: 'image/jpeg' });
  if (up.error) throw new Error(up.error.message);
  check(await supabase.from('media').insert({ memory_id: memoryId, household_id: householdId, kind: 'photo', storage_path: path }));
}

export async function listPhotoUrls(memoryIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (memoryIds.length === 0) return out;
  const media: { memory_id: string; storage_path: string }[] = check(
    await supabase.from('media').select('memory_id, storage_path').in('memory_id', memoryIds).eq('kind', 'photo'),
  );
  if (media.length === 0) return out;
  const signed = await supabase.storage.from('media').createSignedUrls(media.map((m) => m.storage_path), 3600);
  if (signed.error) throw new Error(signed.error.message);
  const byPath = new Map(signed.data.map((s) => [s.path, s.signedUrl] as const));
  for (const m of media) {
    const u = byPath.get(m.storage_path);
    if (u) (out[m.memory_id] ??= []).push(u);
  }
  return out;
}

export async function listCaptureKeys(): Promise<CaptureKey[]> {
  return check(await supabase.from('capture_keys').select('id, label, created_at, last_used_at').order('created_at'));
}

export async function createCaptureKey(householdId: string, label: string): Promise<string> {
  return check(await supabase.rpc('create_capture_key', { p_household_id: householdId, p_label: label })) as string;
}

export async function deleteCaptureKey(id: string) {
  check(await supabase.from('capture_keys').delete().eq('id', id));
}

export async function updatePlaceRadius(id: string, radius: number) {
  check(await supabase.from('places').update({ radius_m: radius }).eq('id', id));
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

// Facts are cached on the device so the emergency card works offline.
const FACTS_CACHE = 'hm.facts';

export async function listFacts(householdId: string): Promise<HouseFact[]> {
  try {
    const rows = check(await supabase.from('house_facts').select('id, household_id, title, value, category, surface_at').eq('household_id', householdId)) as HouseFact[];
    writeJson(FACTS_CACHE, rows);
    return rows;
  } catch {
    return readJson<HouseFact[]>(FACTS_CACHE, []);
  }
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

// Photo of a label, tin, receipt or warranty: upload, then let the AI turn it into a fact to confirm.
export type LabelFact = { title: string; value: string; category: FactCategory; surface_at: string[] };

export async function readLabel(householdId: string, uri: string, lang: 'en' | 'nb'): Promise<LabelFact> {
  const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1800 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  const bytes = await (await fetch(small.uri)).arrayBuffer();
  const path = `${householdId}/labels/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const up = await supabase.storage.from('media').upload(path, bytes, { contentType: 'image/jpeg' });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await supabase.functions.invoke('read-label', { body: { path, lang } });
  if (error) {
    let code = '';
    try { code = ((await (error as { context?: Response }).context?.json()) as { error?: string })?.error ?? ''; } catch { /* no body */ }
    throw new Error(`label:${['not_configured', 'too_large', 'unreadable'].includes(code) ? code : 'failed'}`);
  }
  return (data as { fact: LabelFact }).fact;
}
