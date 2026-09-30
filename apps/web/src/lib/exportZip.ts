import { supabase } from './supabase';
import { buildMarkdown, type ExportData } from './export';
import type { Lang, T } from '../i18n/core';

async function all<T>(table: string, columns: string, householdId: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).eq('household_id', householdId).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

// Builds a zip with export.json, home-memory.md and every photo, and downloads it.
export async function downloadExport(householdId: string, householdName: string, onProgress: (msg: string) => void, t: T, lang: Lang) {
  onProgress(t('data.collecting'));
  const [memories, places, tasks, events, facts, media] = await Promise.all([
    all<ExportData['memories'][number]>('memories', 'id, body, status, place_id, created_at, done_at, due_on, due_time', householdId),
    all<ExportData['places'][number]>('places', 'id, name, kind, category, lat, lon, radius_m, address', householdId),
    all<ExportData['tasks'][number]>('maintenance_tasks', 'id, template_key, title, notes, schedule, interval_months, window_start_month, window_end_month, last_done_at, next_due_at, active', householdId),
    all<ExportData['events'][number]>('maintenance_events', 'task_id, done_at, cost_nok, note', householdId),
    all<ExportData['facts'][number]>('house_facts', 'title, value, category, surface_at', householdId),
    all<{ memory_id: string; storage_path: string }>('media', 'memory_id, storage_path', householdId),
  ]);

  const files: Record<string, Uint8Array> = {};
  const photos: ExportData['photos'] = [];
  const counter = new Map<string, number>();
  const urls: { memory_id: string; url: string }[] = [];
  for (let i = 0; i < media.length; i += 100) {
    const chunk = media.slice(i, i + 100);
    const signed = await supabase.storage.from('media').createSignedUrls(chunk.map((m) => m.storage_path), 600);
    if (signed.error) throw new Error(signed.error.message);
    const byPath = new Map(signed.data.map((s) => [s.path, s.signedUrl] as const));
    for (const m of chunk) { const u = byPath.get(m.storage_path); if (u) urls.push({ memory_id: m.memory_id, url: u }); }
  }
  let done = 0;
  for (const { memory_id, url } of urls) {
    onProgress(t('data.photosProgress', { a: ++done, b: urls.length }));
    const res = await fetch(url);
    if (!res.ok) continue;
    const n = (counter.get(memory_id) ?? 0) + 1;
    counter.set(memory_id, n);
    const file = `photos/${memory_id}-${n}.jpg`;
    files[file] = new Uint8Array(await res.arrayBuffer());
    photos.push({ memory_id, file });
  }

  const data: ExportData = { exportedAt: new Date().toISOString(), household: { name: householdName }, memories, places, tasks, events, facts, photos };
  onProgress(t('data.packing'));
  const { zipSync, strToU8 } = await import('fflate');
  files['export.json'] = strToU8(JSON.stringify(data, null, 2));
  files['home-memory.md'] = strToU8(buildMarkdown(data, t, lang));
  const blob = new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `home-memory-export-${data.exportedAt.slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  onProgress(t('data.finished', { a: memories.length, b: tasks.length, c: photos.length }));
}
