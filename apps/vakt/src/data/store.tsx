// The app's state: everything is loaded once, changed here first so the screen answers at once, then saved.
// If a save fails the change is rolled back and a message says so, so the screen never shows what isn't stored.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Data, Repo } from './repo';
import { friendlyError } from './config';
import type { DayOff, Employer, Payslip, Settings, Setup, Shift, Supplement } from '../lib/types';

interface Store extends Data {
  local: boolean;
  email: string | null;
  saveSettings(s: Settings): Promise<boolean>;
  saveShift(s: Shift): Promise<boolean>;
  deleteShift(id: string): Promise<boolean>;
  saveSupplement(s: Supplement): Promise<boolean>;
  deleteSupplement(id: string): Promise<boolean>;
  saveEmployer(e: Employer): Promise<boolean>;
  /** Refused (false, with a message) while the employer still has shifts. */
  deleteEmployer(id: string): Promise<boolean>;
  /** Saves an employer with exactly these supplements, replacing the ones it had (adding or copying a setup). */
  replaceSetup(e: Employer, supplements: Supplement[]): Promise<boolean>;
  saveDayOff(d: DayOff): Promise<boolean>;
  deleteDayOff(id: string): Promise<boolean>;
  savePayslip(p: Payslip): Promise<boolean>;
  deletePayslip(id: string): Promise<boolean>;
  /** Wage, supplements and employers: everything a calculation needs. */
  setup: Setup;
  toast(text: string, opts?: { celebrate?: boolean; undo?: () => void; error?: boolean }): void;
  toastState: Toast | null;
}

export interface Toast { id: number; text: string; celebrate?: boolean; undo?: () => void; error?: boolean }

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

const upsert = <T extends { id: string }>(list: T[], x: T) => list.some((y) => y.id === x.id) ? list.map((y) => y.id === x.id ? x : y) : [...list, x];

export function StoreProvider({ repo, initial, local, email, children }: { repo: Repo; initial: Data; local: boolean; email: string | null; children: ReactNode }) {
  const [data, setData] = useState<Data>(initial);
  const [toastState, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const dataRef = useRef(data);
  dataRef.current = data;

  const toast = useCallback((text: string, opts: { celebrate?: boolean; undo?: () => void; error?: boolean } = {}) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, ...opts });
    timer.current = window.setTimeout(() => setToast(null), opts.undo || opts.error ? 6000 : 3200);
  }, []);

  /** Apply a change now, save it, and put things back if the save fails. */
  const run = useCallback(async (change: (d: Data) => Data, save: () => Promise<void>) => {
    const before = dataRef.current;
    setData(change(before));
    try {
      await save();
      return true;
    } catch (e) {
      setData(before);
      toast(`Ble ikke lagret: ${friendlyError(e)}`, { error: true });
      return false;
    }
  }, [toast]);

  const store = useMemo<Store>(() => ({
    ...data,
    local,
    email,
    toast,
    toastState,
    saveSettings: (s) => run((d) => ({ ...d, settings: s }), () => repo.saveSettings(s)),
    saveShift: (s) => run((d) => ({ ...d, shifts: upsert(d.shifts, s) }), () => repo.saveShift(s)),
    deleteShift: (id) => run((d) => ({ ...d, shifts: d.shifts.filter((x) => x.id !== id) }), () => repo.deleteShift(id)),
    setup: { employers: data.employers, supplements: data.supplements, sickPercent: data.settings.sick_percent },
    saveDayOff: (x) => run((d) => ({ ...d, daysOff: upsert(d.daysOff.filter((y) => y.date !== x.date || y.id === x.id), x) }), () => repo.saveDayOff(x)),
    deleteDayOff: (id) => run((d) => ({ ...d, daysOff: d.daysOff.filter((x) => x.id !== id) }), () => repo.deleteDayOff(id)),
    savePayslip: (x) => run((d) => ({ ...d, payslips: upsert(d.payslips.filter((y) => y.month !== x.month || y.id === x.id), x) }), () => repo.savePayslip(x)),
    deletePayslip: (id) => run((d) => ({ ...d, payslips: d.payslips.filter((x) => x.id !== id) }), () => repo.deletePayslip(id)),
    saveSupplement: (s) => run((d) => ({ ...d, supplements: upsert(d.supplements, s) }), () => repo.saveSupplements([s])),
    deleteSupplement: (id) => run((d) => ({ ...d, supplements: d.supplements.filter((x) => x.id !== id) }), () => repo.deleteSupplements([id])),
    saveEmployer: (e) => run((d) => ({ ...d, employers: upsert(d.employers, e) }), () => repo.saveEmployer(e)),
    deleteEmployer: async (id) => {
      const n = dataRef.current.shifts.filter((s) => s.employer_id === id).length;
      if (n > 0) { toast(`Har ${n} vakter. Flytt eller slett dem først.`, { error: true }); return false; }
      return run((d) => ({ ...d, employers: d.employers.filter((x) => x.id !== id), supplements: d.supplements.filter((x) => x.employer_id !== id) }), () => repo.deleteEmployer(id));
    },
    replaceSetup: (e, sups) => {
      const old = dataRef.current.supplements.filter((x) => x.employer_id === e.id && !sups.some((y) => y.id === x.id)).map((x) => x.id);
      return run(
        (d) => ({ ...d, employers: upsert(d.employers, e), supplements: [...d.supplements.filter((x) => x.employer_id !== e.id), ...sups] }),
        async () => { await repo.saveEmployer(e); await repo.deleteSupplements(old); await repo.saveSupplements(sups); },
      );
    },
  }), [data, local, email, toast, toastState, run, repo]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
