// Where the data lives: Supabase when signed in, this browser's storage in local mode. Same shape either way.
import { supabase } from './config';
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATES, type DayOff, type Employer, type Payslip, type Settings, type Shift, type Supplement, type Wage } from '../lib/types';

export interface Data { settings: Settings; employers: Employer[]; supplements: Supplement[]; shifts: Shift[]; daysOff: DayOff[]; payslips: Payslip[] }

export interface Repo {
  load(): Promise<Data>;
  saveSettings(s: Settings): Promise<void>;
  saveShifts(list: Shift[]): Promise<void>;
  deleteShift(id: string): Promise<void>;
  saveSupplements(list: Supplement[]): Promise<void>;
  deleteSupplements(ids: string[]): Promise<void>;
  saveEmployer(e: Employer): Promise<void>;
  deleteEmployer(id: string): Promise<void>;
  saveDayOff(d: DayOff): Promise<void>;
  deleteDayOff(id: string): Promise<void>;
  savePayslip(p: Payslip): Promise<void>;
  deletePayslip(id: string): Promise<void>;
}

export const newId = () => crypto.randomUUID();

const settingsFrom = (raw: unknown): Settings => {
  const r = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) } as Settings;
  return {
    name: r.name, goal: r.goal, tax_percent: r.tax_percent, onboarded: r.onboarded, toured: r.toured,
    holiday_pay_percent: Number(r.holiday_pay_percent) || DEFAULT_SETTINGS.holiday_pay_percent,
    sick_percent: Number.isFinite(Number(r.sick_percent)) ? Number(r.sick_percent) : DEFAULT_SETTINGS.sick_percent,
    reminders: { ...DEFAULT_SETTINGS.reminders, ...(r.reminders ?? {}) },
  };
};

// Rows from before a field existed get its default, so older data (and browser data) always has every field.
const toEmployer = (e: Partial<Employer>): Employer => ({ pay_day: 12, pay_delay: 'supplements', wages: [], templates: [], sort: 0, ...e } as Employer);
const toShift = (s: Partial<Shift>): Shift => ({ status: 'worked', break_minutes: 0, overtime_percent: 0, note: '', ...s } as Shift);
const toPayslip = (p: Record<string, unknown>): Payslip => ({ ...(p as unknown as Payslip), gross: Number(p.gross), net: p.net === null || p.net === undefined ? null : Number(p.net) });

const SHIFT_COLS = 'id, employer_id, date, start_time, end_time, break_minutes, overtime_percent, note, status';
const DAYOFF_COLS = 'id, date, kind, note';
const PAYSLIP_COLS = 'id, month, gross, net, note';
const SUP_COLS = 'id, employer_id, name, color, amount_type, amount, min_per_hour, days, start_time, end_time, active, sort';

// Only the table's columns go to the database: an extra field in an object (from a form, say) would make the save fail.
const pick = <T extends object>(x: T, cols: string): T =>
  Object.fromEntries(cols.split(', ').filter((k) => k in x).map((k) => [k, (x as Record<string, unknown>)[k]])) as T;
const EMP_COLS = 'id, name, color, wages, templates, sort, pay_day, pay_delay';

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
      const [p, emp, sup, sh, off, slips] = await Promise.all([
        db.from('vakt_profiles').select('settings').maybeSingle(),
        db.from('vakt_employers').select(EMP_COLS).order('sort').order('created_at'),
        db.from('vakt_supplements').select(SUP_COLS).order('sort').order('created_at'),
        db.from('vakt_shifts').select(SHIFT_COLS).order('date').order('start_time'),
        db.from('vakt_days_off').select(DAYOFF_COLS).order('date'),
        db.from('vakt_payslips').select(PAYSLIP_COLS).order('month'),
      ]);
      check(p); check(emp); check(sup); check(sh); check(off); check(slips);
      return {
        settings: settingsFrom(p.data?.settings),
        employers: ((emp.data ?? []) as Partial<Employer>[]).map(toEmployer),
        supplements: (sup.data ?? []).map(toSupplement),
        shifts: ((sh.data ?? []) as Partial<Shift>[]).map(toShift),
        daysOff: (off.data ?? []) as DayOff[],
        payslips: (slips.data ?? []).map(toPayslip),
      };
    },
    async saveSettings(settings) {
      const { data } = await db.auth.getUser();
      check(await db.from('vakt_profiles').upsert({ owner_id: data.user?.id, settings }));
    },
    async saveShifts(list) { if (list.length) check(await db.from('vakt_shifts').upsert(list.map((s) => pick(s, SHIFT_COLS)))); },
    async deleteShift(id) { check(await db.from('vakt_shifts').delete().eq('id', id)); },
    async saveSupplements(list) { if (list.length) check(await db.from('vakt_supplements').upsert(list.map((x) => pick(x, SUP_COLS)))); },
    async deleteSupplements(ids) { if (ids.length) check(await db.from('vakt_supplements').delete().in('id', ids)); },
    async saveEmployer(e) { check(await db.from('vakt_employers').upsert(pick(e, EMP_COLS))); },
    async deleteEmployer(id) { check(await db.from('vakt_employers').delete().eq('id', id)); },
    async saveDayOff(d) { check(await db.from('vakt_days_off').upsert(pick(d, DAYOFF_COLS))); },
    async deleteDayOff(id) { check(await db.from('vakt_days_off').delete().eq('id', id)); },
    async savePayslip(x) { check(await db.from('vakt_payslips').upsert(pick(x, PAYSLIP_COLS), { onConflict: 'owner_id,month' })); },
    async deletePayslip(id) { check(await db.from('vakt_payslips').delete().eq('id', id)); },
  };
}

const LOCAL = 'vakt-local-data';

/** Kept in this browser only: for development, the end-to-end tests and trying the app without an account. */
export function localRepo(): Repo {
  const read = (): Data => {
    try {
      const d = JSON.parse(localStorage.getItem(LOCAL) ?? 'null');
      if (d) {
        const data = withEmployer({
          settings: settingsFrom(d.settings), employers: (d.employers ?? []).map(toEmployer), supplements: d.supplements ?? [],
          shifts: (d.shifts ?? []).map(toShift), daysOff: d.daysOff ?? [], payslips: d.payslips ?? [],
        }, d.settings);
        if (data.employers.length && !d.employers?.length) localStorage.setItem(LOCAL, JSON.stringify(data));
        return data;
      }
    } catch { /* start fresh */ }
    return { settings: settingsFrom(null), employers: [], supplements: [], shifts: [], daysOff: [], payslips: [] };
  };
  const write = (f: (d: Data) => Data) => { localStorage.setItem(LOCAL, JSON.stringify(f(read()))); return Promise.resolve(); };
  const upsert = <T extends { id: string }>(list: T[], x: T) => list.some((y) => y.id === x.id) ? list.map((y) => y.id === x.id ? x : y) : [...list, x];
  return {
    load: () => Promise.resolve(read()),
    saveSettings: (settings) => write((d) => ({ ...d, settings })),
    // Stored the way the database stores them, so a field the tables don't have shows up in local mode too.
    saveShifts: (list) => write((d) => ({ ...d, shifts: list.map((s) => pick(s, SHIFT_COLS)).reduce(upsert, d.shifts) })),
    deleteShift: (id) => write((d) => ({ ...d, shifts: d.shifts.filter((x) => x.id !== id) })),
    saveSupplements: (list) => write((d) => ({ ...d, supplements: list.map((x) => pick(x, SUP_COLS)).reduce(upsert, d.supplements) })),
    deleteSupplements: (ids) => write((d) => ({ ...d, supplements: d.supplements.filter((x) => !ids.includes(x.id)) })),
    saveEmployer: (e) => write((d) => ({ ...d, employers: upsert(d.employers, pick(e, EMP_COLS)) })),
    deleteEmployer: (id) => write((d) => ({ ...d, employers: d.employers.filter((x) => x.id !== id), supplements: d.supplements.filter((x) => x.employer_id !== id) })),
    // One day off per date, and one pay slip per month, as in the database.
    saveDayOff: (x) => write((d) => ({ ...d, daysOff: upsert(d.daysOff.filter((y) => y.date !== x.date || y.id === x.id), pick(x, DAYOFF_COLS)) })),
    deleteDayOff: (id) => write((d) => ({ ...d, daysOff: d.daysOff.filter((x) => x.id !== id) })),
    savePayslip: (x) => write((d) => ({ ...d, payslips: upsert(d.payslips.filter((y) => y.month !== x.month || y.id === x.id), pick(x, PAYSLIP_COLS)) })),
    deletePayslip: (id) => write((d) => ({ ...d, payslips: d.payslips.filter((x) => x.id !== id) })),
  };
}

/** Browser data from before employers existed: one employer from the old wage and shift types, like the database upgrade. */
function withEmployer(d: Data, raw: { wages?: Wage[]; templates?: Data['employers'][number]['templates'] } | undefined): Data {
  if (d.employers.length || !(d.settings.onboarded || d.shifts.length || d.supplements.length)) return d;
  const e = toEmployer({ id: newId(), name: 'Jobben min', color: '#7c3aed', wages: raw?.wages ?? [], templates: raw?.templates ?? DEFAULT_TEMPLATES, sort: 0 });
  return {
    ...d,
    employers: [e],
    shifts: d.shifts.map((s) => ({ ...s, employer_id: s.employer_id ?? e.id })),
    supplements: d.supplements.map((s) => ({ ...s, employer_id: s.employer_id ?? e.id })),
  };
}
