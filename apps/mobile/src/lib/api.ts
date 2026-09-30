import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import type { CaptureKey, HouseProfile, Household, MaintenanceEvent, MaintenanceTask, Member, Memory, Place, Suggestion } from './types';

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
  if (!id) throw new Error('That invite code is not valid.');
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

export async function addPlace(p: Omit<Place, 'id'>) {
  check(await supabase.from('places').insert(p));
}

export async function deletePlace(id: string) {
  check(await supabase.from('places').delete().eq('id', id));
}

export async function updateMemory(id: string, patch: Partial<Pick<Memory, 'status' | 'place_id' | 'done_at'>>) {
  check(await supabase.from('memories').update(patch).eq('id', id));
}

export async function markDone(ids: string[]) {
  check(
    await supabase.from('memories').update({ status: 'done', done_at: new Date().toISOString() }).in('id', ids),
  );
}

export async function deleteMemory(id: string) {
  check(await supabase.from('memories').delete().eq('id', id));
}

export type NewMemory = {
  id: string; // client-generated so offline retries are idempotent
  household_id: string;
  body: string;
  place_id: string | null;
  capture_lat: number | null;
  capture_lon: number | null;
};

export async function insertMemory(m: NewMemory) {
  const status = m.place_id ? 'active' : 'inbox';
  const res = await supabase.from('memories').upsert({ ...m, status }, { onConflict: 'id', ignoreDuplicates: true });
  if (res.error) throw new Error(res.error.message);
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

export async function reopenMemory(id: string) {
  check(await supabase.from('memories').update({ status: 'active', done_at: null }).eq('id', id));
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
