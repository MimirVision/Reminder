// The app's state: everything is loaded once, changed here first so the screen answers at once, then saved.
// If a save fails the change is rolled back and a message says so, so the screen never shows what isn't stored.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Data, Repo } from './repo';
import { friendlyError } from './config';
import type { Settings, Shift, Supplement } from '../lib/types';

interface Store extends Data {
  local: boolean;
  email: string | null;
  saveSettings(s: Settings): Promise<boolean>;
  saveShift(s: Shift): Promise<boolean>;
  deleteShift(id: string): Promise<boolean>;
  saveSupplement(s: Supplement): Promise<boolean>;
  deleteSupplement(id: string): Promise<boolean>;
  toast(text: string, opts?: { celebrate?: boolean; undo?: () => void }): void;
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
    saveSupplement: (s) => run((d) => ({ ...d, supplements: upsert(d.supplements, s) }), () => repo.saveSupplement(s)),
    deleteSupplement: (id) => run((d) => ({ ...d, supplements: d.supplements.filter((x) => x.id !== id) }), () => repo.deleteSupplement(id)),
  }), [data, local, email, toast, toastState, run, repo]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
