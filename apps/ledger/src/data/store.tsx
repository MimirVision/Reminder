// The app's single source of truth while it runs: the workspace snapshot from the repository, plus every action.
// Screens read derived data from here and never keep their own copies, so the list, calendar, client pages and
// dashboard always show the same records.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { todayIn, type ISODate } from '../lib/dates';
import { setLocale } from '../lib/format';
import { liveSchedules } from '../lib/generation';
import { detectExpected, needsReview, type ExpectedItem } from '../lib/missing';
import type { Client, Occurrence, Schedule, Snapshot, WorkspaceSettings } from '../lib/types';
import { isNotInstalled } from './config';
import { friendlyError, type Repo } from './repo';
import { useToast } from '../ui/toast';

export type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'not_installed' } | { kind: 'error'; message: string };

interface Store {
  repo: Repo;
  state: LoadState;
  snap: Snapshot;
  today: ISODate;
  clientById: Map<string, Client>;
  scheduleById: Map<string, Schedule>;
  expected: ExpectedItem[];
  reviewCount: number;
  lastGeneration: { at: string; created: number; error: string | null } | null;
  reload(): Promise<void>;
  /** Runs a change, shows its outcome, and refreshes. Returns false if it failed (the error is shown). */
  run<T>(fn: (repo: Repo) => Promise<T>, opts?: { success?: string | ((r: T) => string); generate?: boolean; quiet?: boolean }): Promise<T | undefined>;
  /** Updates a task immediately on screen and saves it; reverts with a message if saving fails. */
  patchOccurrence(id: string, patch: Partial<Occurrence>, success?: string): Promise<boolean>;
  /** Changes workspace settings on screen at once and saves them in order; a failure shows a message and reloads. */
  saveSettings(patch: Partial<WorkspaceSettings>): Promise<boolean>;
}

const EMPTY: Snapshot = {
  workspace: { id: '', name: '', timezone: 'Europe/Oslo', settings: {} },
  clients: [], schedules: [], pauses: [], occurrences: [], reviews: [], activity: [], runs: [],
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  const toast = useToast();
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [today, setToday] = useState(() => todayIn());
  const [genError, setGenError] = useState<string | null>(null);
  const refreshTimer = useRef<number | undefined>(undefined);
  const settingsRef = useRef<WorkspaceSettings>({});
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve());

  const reload = useCallback(async () => {
    const s = await repo.load();
    settingsRef.current = s.workspace.settings;
    setSnap(s);
    if (s.workspace.settings.locale) setLocale(s.workspace.settings.locale);
    setToday(todayIn(s.workspace.timezone));
  }, [repo]);

  // On open: create anything that is due, then load. Generation is idempotent, so this is safe on every open/refresh.
  const open = useCallback(async () => {
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    try {
      try {
        await repo.generate();
        setGenError(null);
      } catch (e) {
        if (isNotInstalled(e)) throw e;
        setGenError(friendlyError(e));
      }
      await reload();
      setState({ kind: 'ready' });
    } catch (e) {
      setState(isNotInstalled(e) ? { kind: 'not_installed' } : { kind: 'error', message: friendlyError(e) });
    }
  }, [repo, reload]);

  useEffect(() => { void open(); }, [open]);

  // When the date changes while Ledger is open (it often stays open overnight), generate and refresh.
  useEffect(() => {
    const t = window.setInterval(() => {
      const d = todayIn(snap.workspace.timezone || undefined);
      if (d !== today) void open();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [today, snap.workspace.timezone, open]);

  // Refresh quietly when the window comes back after a while, so a second device's changes show up.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) void open();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [open]);

  const softRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { reload().catch(() => {}); }, 1200);
  }, [reload]);

  const run: Store['run'] = useCallback(async (fn, opts = {}) => {
    try {
      const r = await fn(repo);
      if (opts.generate) await repo.generate().catch((e) => setGenError(friendlyError(e)));
      await reload();
      if (opts.success) toast.show(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      return r;
    } catch (e) {
      if (!opts.quiet) toast.show(friendlyError(e), { tone: 'error' });
      await reload().catch(() => {});
      return undefined;
    }
  }, [repo, reload, toast]);

  const patchOccurrence: Store['patchOccurrence'] = useCallback(async (id, patch, success) => {
    let before: Occurrence | undefined;
    setSnap((s) => ({
      ...s,
      occurrences: s.occurrences.map((o) => {
        if (o.id !== id) return o;
        before = o;
        const next = { ...o, ...patch };
        if (patch.status) next.completedAt = patch.status === 'done' ? (o.completedAt ?? new Date().toISOString()) : null;
        return next;
      }),
    }));
    try {
      await repo.updateOccurrence(id, patch);
      if (success) toast.show(success, before ? { undo: () => { void patchOccurrenceRef.current(id, pick(before!, patch)); } } : {});
      softRefresh();
      return true;
    } catch (e) {
      if (before) setSnap((s) => ({ ...s, occurrences: s.occurrences.map((o) => (o.id === id ? before! : o)) }));
      toast.show(friendlyError(e), { tone: 'error' });
      return false;
    }
  }, [repo, toast, softRefresh]);
  const patchOccurrenceRef = useRef(patchOccurrence);
  patchOccurrenceRef.current = patchOccurrence;

  const clientById = useMemo(() => new Map(snap.clients.map((c) => [c.id, c])), [snap.clients]);
  const scheduleById = useMemo(() => new Map(snap.schedules.map((s) => [s.id, s])), [snap.schedules]);
  const expected = useMemo(
    () => detectExpected({ ...snap, schedules: liveSchedules(snap.schedules, snap.clients) }, today),
    [snap, today],
  );
  const reviewCount = useMemo(() => needsReview(expected).length, [expected]);
  const lastGeneration = useMemo(() => {
    const r = snap.runs[0];
    if (!r) return null;
    return { at: r.finishedAt ?? r.startedAt, created: r.created, error: genError ?? (r.errors.length ? `${r.errors.length} schedule${r.errors.length === 1 ? '' : 's'} failed: ${r.errors[0].message}` : null) };
  }, [snap.runs, genError]);

  const saveSettings: Store['saveSettings'] = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSnap((s) => ({ ...s, workspace: { ...s.workspace, settings: next } }));
    const job = settingsQueue.current.then(() => repo.updateWorkspace({ settings: next })).then(() => true, async (e) => {
      toast.show(friendlyError(e), { tone: 'error' });
      await reload().catch(() => {});
      return false;
    });
    settingsQueue.current = job;
    return job;
  }, [repo, toast, reload]);

  const value: Store = { repo, state, snap, today, clientById, scheduleById, expected, reviewCount, lastGeneration, reload: open, run, patchOccurrence, saveSettings };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function pick(o: Occurrence, patch: Partial<Occurrence>): Partial<Occurrence> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, o[k as keyof Occurrence]]));
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
