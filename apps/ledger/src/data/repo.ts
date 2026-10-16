import type { ISODate } from '../lib/dates';
import type { Client, Occurrence, Review, Schedule, Snapshot, Workspace } from '../lib/types';

export type NewClient = Pick<Client, 'name' | 'reference' | 'notes'> & Partial<Pick<Client, 'status'>>;
export type ClientPatch = Partial<Pick<Client, 'name' | 'reference' | 'notes' | 'status'>>;

export type NewSchedule = Omit<Schedule, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'status'>;
export type SchedulePatch = Partial<Omit<Schedule, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>;

export type NewOccurrence = Omit<Occurrence, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'completedAt'> & { completedAt?: string | null };
export type OccurrencePatch = Partial<Pick<Occurrence, 'title' | 'description' | 'taskType' | 'dueDate' | 'status' | 'priority' | 'tags' | 'clientId'>>;

export type NewReview = Pick<Review, 'scheduleId' | 'periodKey' | 'status' | 'note'>;

/** A full export of a workspace. Restoring it recreates the same ids, so it is also the restore format. */
export interface Backup {
  format: 'ledger-backup';
  version: 1;
  exportedAt: string;
  workspace: Pick<Workspace, 'name' | 'timezone' | 'settings'>;
  clients: Client[];
  schedules: Schedule[];
  pauses: Snapshot['pauses'];
  occurrences: Occurrence[];
  reviews: Review[];
  activity: Snapshot['activity'];
}

/**
 * Everything the app reads and writes. Two implementations: Supabase (the real, persisted workspace) and Demo
 * (fictional data kept in this browser only, clearly labelled in the app). The app never talks to storage directly.
 */
export interface Repo {
  readonly mode: 'supabase' | 'demo';
  load(): Promise<Snapshot>;
  updateWorkspace(patch: Partial<Pick<Workspace, 'name' | 'timezone' | 'settings'>>): Promise<void>;

  createClient(c: NewClient): Promise<Client>;
  updateClient(id: string, patch: ClientPatch): Promise<void>;
  deleteClient(id: string): Promise<void>;

  createSchedule(s: NewSchedule): Promise<Schedule>;
  updateSchedule(id: string, patch: SchedulePatch): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  setPaused(id: string, paused: boolean, on: ISODate): Promise<void>;
  /** Returns how many open later tasks were cancelled. */
  endSchedule(id: string, end: ISODate, cancelLater: boolean): Promise<number>;
  /** Returns how many open tasks were updated. */
  applySchedule(id: string, from: ISODate, oldTitle: string, oldDescription: string): Promise<number>;

  createOccurrence(o: NewOccurrence): Promise<Occurrence>;
  updateOccurrence(id: string, patch: OccurrencePatch): Promise<void>;
  deleteOccurrence(id: string): Promise<void>;

  saveReview(r: NewReview): Promise<void>;
  deleteReview(id: string): Promise<void>;

  /** Creates every occurrence that should exist by now. Idempotent. Returns how many were created. */
  generate(): Promise<number>;

  restore(b: Backup): Promise<void>;
  erase(): Promise<void>;
}

export class RepoError extends Error {}

/** Turns a database error into a sentence for a person. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string; details?: string };
  const msg = String(err?.message ?? e ?? 'Something went wrong');
  if (err?.code === '23505' || /duplicate key/.test(msg)) {
    if (/reference/.test(msg)) return 'Another client already uses that reference.';
    if (/schedule_period/.test(msg)) return 'A task for that period already exists.';
    return 'That already exists.';
  }
  if (err?.code === '23503' || /foreign key/.test(msg)) return 'It still has tasks or schedules attached. Archive it instead, so its history is kept.';
  if (err?.code === '42501' || /row-level security|permission denied/.test(msg)) return 'You don’t have access to that. Try signing in again.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Couldn’t reach the server. Check your connection; nothing was saved.';
  if (/JWT|token/i.test(msg)) return 'Your session has expired. Sign in again.';
  if (/check constraint/.test(msg)) return 'Some values aren’t allowed. Check the form and try again.';
  return msg.replace(/^ledger:\s*/, '').replace(/^./, (c) => c.toUpperCase());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gives every row that lacks one a real UUID (demo data uses readable ids), keeping all references intact. */
export function withUuids(b: Backup): Backup {
  const map = new Map<string, string>();
  const id = (x: string) => {
    if (UUID.test(x)) return x;
    let y = map.get(x);
    if (!y) map.set(x, (y = crypto.randomUUID()));
    return y;
  };
  return {
    ...b,
    clients: b.clients.map((c) => ({ ...c, id: id(c.id) })),
    schedules: b.schedules.map((s) => ({ ...s, id: id(s.id), clientId: id(s.clientId) })),
    pauses: b.pauses.map((p) => ({ ...p, id: id(p.id), scheduleId: id(p.scheduleId) })),
    occurrences: b.occurrences.map((o) => ({ ...o, id: id(o.id), clientId: id(o.clientId), scheduleId: o.scheduleId && id(o.scheduleId) })),
    reviews: b.reviews.map((r) => ({ ...r, id: id(r.id), scheduleId: id(r.scheduleId) })),
    activity: [],
  };
}

export function toBackup(s: import('../lib/types').Snapshot): Backup {
  return {
    format: 'ledger-backup', version: 1, exportedAt: new Date().toISOString(),
    workspace: { name: s.workspace.name, timezone: s.workspace.timezone, settings: s.workspace.settings },
    clients: s.clients, schedules: s.schedules, pauses: s.pauses, occurrences: s.occurrences, reviews: s.reviews, activity: s.activity,
  };
}

/** Checks a parsed file really is a Ledger backup before anything is written. */
export function parseBackup(raw: unknown): Backup {
  const b = raw as Partial<Backup>;
  if (!b || b.format !== 'ledger-backup' || b.version !== 1) throw new RepoError('This isn’t a Ledger backup file.');
  for (const k of ['clients', 'schedules', 'pauses', 'occurrences', 'reviews'] as const) {
    if (!Array.isArray(b[k])) throw new RepoError(`The backup is missing its ${k}.`);
  }
  return { activity: [], ...b } as Backup;
}
