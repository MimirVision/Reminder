// Where the data lives: Supabase when signed in, this browser's storage in local mode. Same shape either way.
import { supabase } from './config';
import { DEFAULT_SETTINGS, type Settings, type Shift, type Supplement } from '../lib/types';

export interface Data { settings: Settings; supplements: Supplement[]; shifts: Shift[] }

export interface Repo {
  load(): Promise<Data>;
  saveSettings(s: Settings): Promise<void>;
  saveShift(s: Shift): Promise<void>;
  deleteShift(id: string): Promise<void>;
  saveSupplement(s: Supplement): Promise<void>;
  deleteSupplement(id: string): Promise<void>;
}

export const newId = () => crypto.randomUUID();

const settingsFrom = (raw: unknown): Settings => ({ ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) });

const SHIFT_COLS = 'id, date, start_time, end_time, break_minutes, overtime_percent, note';
const SUP_COLS = 'id, name, color, amount_type, amount, min_per_hour, days, start_time, end_time, active, sort';

const toSupplement = (r: Record<string, unknown>): Supplement => ({
  ...(r as unknown as Supplement),
  amount: Number(r.amount),
  min_per_hour: r.min_per_hour === null || r.min_per_hour === undefined ? null : Number(r.min_per_hour),
});

export function supabaseRepo(): Repo {
  const db = supabase();
  const check = <T extends { error: unknown }>(r: T) => { if (r.error) throw r.error; return r; };
  return {
    async load() {
      const [p, sup, sh] = await Promise.all([
        db.from('vakt_profiles').select('settings').maybeSingle(),
        db.from('vakt_supplements').select(SUP_COLS).order('sort').order('created_at'),
        db.from('vakt_shifts').select(SHIFT_COLS).order('date').order('start_time'),
      ]);
      check(p); check(sup); check(sh);
      return {
        settings: settingsFrom(p.data?.settings),
        supplements: (sup.data ?? []).map(toSupplement),
        shifts: (sh.data ?? []) as Shift[],
      };
    },
    async saveSettings(settings) {
      const { data } = await db.auth.getUser();
      check(await db.from('vakt_profiles').upsert({ owner_id: data.user?.id, settings }));
    },
    async saveShift(s) { check(await db.from('vakt_shifts').upsert(s)); },
    async deleteShift(id) { check(await db.from('vakt_shifts').delete().eq('id', id)); },
    async saveSupplement(s) { check(await db.from('vakt_supplements').upsert(s)); },
    async deleteSupplement(id) { check(await db.from('vakt_supplements').delete().eq('id', id)); },
  };
}

const LOCAL = 'vakt-local-data';

/** Kept in this browser only: for development, the end-to-end tests and trying the app without an account. */
export function localRepo(): Repo {
  const read = (): Data => {
    try {
      const d = JSON.parse(localStorage.getItem(LOCAL) ?? 'null');
      if (d) return { settings: settingsFrom(d.settings), supplements: d.supplements ?? [], shifts: d.shifts ?? [] };
    } catch { /* start fresh */ }
    return { settings: settingsFrom(null), supplements: [], shifts: [] };
  };
  const write = (f: (d: Data) => Data) => { localStorage.setItem(LOCAL, JSON.stringify(f(read()))); return Promise.resolve(); };
  const upsert = <T extends { id: string }>(list: T[], x: T) => list.some((y) => y.id === x.id) ? list.map((y) => y.id === x.id ? x : y) : [...list, x];
  return {
    load: () => Promise.resolve(read()),
    saveSettings: (settings) => write((d) => ({ ...d, settings })),
    saveShift: (s) => write((d) => ({ ...d, shifts: upsert(d.shifts, s) })),
    deleteShift: (id) => write((d) => ({ ...d, shifts: d.shifts.filter((x) => x.id !== id) })),
    saveSupplement: (s) => write((d) => ({ ...d, supplements: upsert(d.supplements, s) })),
    deleteSupplement: (id) => write((d) => ({ ...d, supplements: d.supplements.filter((x) => x.id !== id) })),
  };
}
