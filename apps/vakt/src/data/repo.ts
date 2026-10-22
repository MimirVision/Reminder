// Where the data lives: Supabase when signed in, this browser's storage in local mode. Same shape either way.
import { supabase } from './config';
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATES, type Employer, type Settings, type Shift, type Supplement, type Wage } from '../lib/types';

export interface Data { settings: Settings; employers: Employer[]; supplements: Supplement[]; shifts: Shift[] }

export interface Repo {
  load(): Promise<Data>;
  saveSettings(s: Settings): Promise<void>;
  saveShift(s: Shift): Promise<void>;
  deleteShift(id: string): Promise<void>;
  saveSupplements(list: Supplement[]): Promise<void>;
  deleteSupplements(ids: string[]): Promise<void>;
  saveEmployer(e: Employer): Promise<void>;
  deleteEmployer(id: string): Promise<void>;
}

export const newId = () => crypto.randomUUID();

const settingsFrom = (raw: unknown): Settings => {
  const { name, goal, tax_percent, onboarded } = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) } as Settings;
  return { name, goal, tax_percent, onboarded };
};

const SHIFT_COLS = 'id, employer_id, date, start_time, end_time, break_minutes, overtime_percent, note';
const SUP_COLS = 'id, employer_id, name, color, amount_type, amount, min_per_hour, days, start_time, end_time, active, sort';

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
      const [p, emp, sup, sh] = await Promise.all([
        db.from('vakt_profiles').select('settings').maybeSingle(),
        db.from('vakt_employers').select('id, name, color, wages, templates, sort').order('sort').order('created_at'),
        db.from('vakt_supplements').select(SUP_COLS).order('sort').order('created_at'),
        db.from('vakt_shifts').select(SHIFT_COLS).order('date').order('start_time'),
      ]);
      check(p); check(emp); check(sup); check(sh);
      return {
        settings: settingsFrom(p.data?.settings),
        employers: (emp.data ?? []) as Employer[],
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
    async saveSupplements(list) { if (list.length) check(await db.from('vakt_supplements').upsert(list)); },
    async deleteSupplements(ids) { if (ids.length) check(await db.from('vakt_supplements').delete().in('id', ids)); },
    async saveEmployer(e) { check(await db.from('vakt_employers').upsert(e)); },
    async deleteEmployer(id) { check(await db.from('vakt_employers').delete().eq('id', id)); },
  };
}

const LOCAL = 'vakt-local-data';

/** Kept in this browser only: for development, the end-to-end tests and trying the app without an account. */
export function localRepo(): Repo {
  const read = (): Data => {
    try {
      const d = JSON.parse(localStorage.getItem(LOCAL) ?? 'null');
      if (d) {
        const data = withEmployer({ settings: settingsFrom(d.settings), employers: d.employers ?? [], supplements: d.supplements ?? [], shifts: d.shifts ?? [] }, d.settings);
        if (data.employers.length && !d.employers?.length) localStorage.setItem(LOCAL, JSON.stringify(data));
        return data;
      }
    } catch { /* start fresh */ }
    return { settings: settingsFrom(null), employers: [], supplements: [], shifts: [] };
  };
  const write = (f: (d: Data) => Data) => { localStorage.setItem(LOCAL, JSON.stringify(f(read()))); return Promise.resolve(); };
  const upsert = <T extends { id: string }>(list: T[], x: T) => list.some((y) => y.id === x.id) ? list.map((y) => y.id === x.id ? x : y) : [...list, x];
  return {
    load: () => Promise.resolve(read()),
    saveSettings: (settings) => write((d) => ({ ...d, settings })),
    saveShift: (s) => write((d) => ({ ...d, shifts: upsert(d.shifts, s) })),
    deleteShift: (id) => write((d) => ({ ...d, shifts: d.shifts.filter((x) => x.id !== id) })),
    saveSupplements: (list) => write((d) => ({ ...d, supplements: list.reduce(upsert, d.supplements) })),
    deleteSupplements: (ids) => write((d) => ({ ...d, supplements: d.supplements.filter((x) => !ids.includes(x.id)) })),
    saveEmployer: (e) => write((d) => ({ ...d, employers: upsert(d.employers, e) })),
    deleteEmployer: (id) => write((d) => ({ ...d, employers: d.employers.filter((x) => x.id !== id), supplements: d.supplements.filter((x) => x.employer_id !== id) })),
  };
}

/** Browser data from before employers existed: one employer from the old wage and shift types, like the database upgrade. */
function withEmployer(d: Data, raw: { wages?: Wage[]; templates?: Data['employers'][number]['templates'] } | undefined): Data {
  if (d.employers.length || !(d.settings.onboarded || d.shifts.length || d.supplements.length)) return d;
  const e: Employer = { id: newId(), name: 'Jobben min', color: '#7c3aed', wages: raw?.wages ?? [], templates: raw?.templates ?? DEFAULT_TEMPLATES, sort: 0 };
  return {
    ...d,
    employers: [e],
    shifts: d.shifts.map((s) => ({ ...s, employer_id: s.employer_id ?? e.id })),
    supplements: d.supplements.map((s) => ({ ...s, employer_id: s.employer_id ?? e.id })),
  };
}
