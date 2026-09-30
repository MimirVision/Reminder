import { supabase } from './supabase';
import type { Household, Media, Member, Memory, MemoryStatus, Place } from './types';

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
  check(await supabase.rpc('join_household', { p_invite_code: code, p_display_name: displayName }));
}

export async function listMembers(householdId: string): Promise<Member[]> {
  return check(await supabase.from('household_members').select('user_id, display_name').eq('household_id', householdId));
}

export async function listMemories(householdId: string, statuses: MemoryStatus[]): Promise<Memory[]> {
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

export type NewMemory = {
  household_id: string;
  body: string;
  place_id?: string | null;
  place_category?: string | null;
  capture_lat?: number | null;
  capture_lon?: number | null;
  capture_accuracy_m?: number | null;
};

export async function addMemory(m: NewMemory): Promise<Memory> {
  const status: MemoryStatus = m.place_id || m.place_category ? 'active' : 'inbox';
  return check(await supabase.from('memories').insert({ ...m, status }).select().single());
}

export async function updateMemory(id: string, patch: Partial<Pick<Memory, 'body' | 'status' | 'place_id' | 'place_category' | 'done_at'>>) {
  check(await supabase.from('memories').update(patch).eq('id', id));
}

export async function markDone(id: string) {
  await updateMemory(id, { status: 'done', done_at: new Date().toISOString() });
}

export async function reopen(id: string, hasPlace: boolean) {
  await updateMemory(id, { status: hasPlace ? 'active' : 'inbox', done_at: null });
}

export async function deleteMemory(id: string) {
  check(await supabase.from('memories').delete().eq('id', id));
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
