// Demo mode: fictional data kept in this browser only (localStorage), for trying Ledger without a database.
// It follows the same rules as the database (the same constraints, history and idempotent generation), but it is
// not a safe place for real work, and the app says so on every screen.

import { todayIn, type ISODate } from '../lib/dates';
import { liveSchedules, planGeneration } from '../lib/generation';
import { dueDateFor, validateRecurrence } from '../lib/recurrence';
import type { Activity, Client, Meeting, Occurrence, Schedule, Snapshot } from '../lib/types';
import { meetingErrors } from '../lib/meetings';
import { isOpen } from '../lib/types';
import { buildSeed } from './seed';
import type { Backup, MeetingPatch, NewMeeting, ClientPatch, NewClient, NewOccurrence, NewReview, NewSchedule, OccurrencePatch, Repo, SchedulePatch } from './repo';
import { checklistError, RepoError, upgradeRows } from './repo';
import { calendarOf } from '../lib/holidays';

const KEY = 'ledger-demo-v1';
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export class DemoRepo implements Repo {
  readonly mode = 'demo' as const;
  readonly current = true;
  readonly meetings = true;
  private s: Snapshot;
  private storage: Storage | null;

  constructor(storage: Storage | null = safeStorage(), opts: { today?: ISODate } = {}) {
    this.storage = storage;
    const saved = this.read();
    this.s = saved ?? buildSeed(opts.today ?? todayIn());
    if (!saved) this.save();
  }

  private read(): Snapshot | null {
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw) as Snapshot;
      return upgradeRows({ ...snap, meetings: snap.meetings ?? [] });
    } catch { return null; }
  }

  private save() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.s)); } catch { /* storage full or blocked: keep working in memory */ }
  }

  private today() { return todayIn(this.s.workspace.timezone); }

  private log(entity: Activity['entity'], entityId: string, clientId: string | null, action: string, details: Record<string, unknown>) {
    this.s.activity.unshift({ id: uid(), workspaceId: this.s.workspace.id, entity, entityId, clientId, action, details, actorId: 'demo', createdAt: now() });
    if (this.s.activity.length > 3000) this.s.activity.length = 3000;
  }

  async load(): Promise<Snapshot> {
    return structuredClone(this.s);
  }

  async updateWorkspace(patch: Partial<Pick<Snapshot['workspace'], 'name' | 'timezone' | 'settings'>>) {
    if (patch.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: patch.timezone }); } catch { throw new RepoError('Unknown time zone.'); }
    }
    Object.assign(this.s.workspace, patch);
    this.save();
  }

  // Clients ------------------------------------------------------------------------------------------------------
  private checkClient(c: Pick<Client, 'name' | 'reference'> & Partial<Client>, id?: string) {
    if (!c.name.trim() || c.name.length > 200) throw new RepoError('A client needs a name (up to 200 characters).');
    if ((c.contactName?.length ?? 0) > 200 || (c.contactEmail?.length ?? 0) > 200 || (c.contactPhone?.length ?? 0) > 50) throw new RepoError('A contact detail is too long.');
    if (c.documents && (c.documents.length > 100 || c.documents.some((d) => !d.text.trim() || d.text.length > 300))) throw new RepoError('Each document needs a name (up to 300 characters), and a client holds up to 100.');
    if (c.reference && this.s.clients.some((x) => x.id !== id && x.reference?.toLowerCase() === c.reference!.toLowerCase())) {
      throw new RepoError('Another client already uses that reference.');
    }
  }

  async createClient(c: NewClient): Promise<Client> {
    this.checkClient(c);
    const row: Client = {
      id: uid(), workspaceId: this.s.workspace.id, status: 'active', contactName: '', contactEmail: '', contactPhone: '', documents: [],
      ...c, reference: c.reference || null, createdAt: now(), updatedAt: now(),
    };
    this.s.clients.push(row);
    this.log('client', row.id, row.id, 'created', { name: row.name });
    this.save();
    return structuredClone(row);
  }

  async updateClient(id: string, patch: ClientPatch) {
    const c = this.find(this.s.clients, id);
    this.checkClient({ ...c, ...patch, name: patch.name ?? c.name, reference: patch.reference === undefined ? c.reference : patch.reference }, id);
    const before = { ...c };
    Object.assign(c, patch, { updatedAt: now() });
    if (patch.reference === '') c.reference = null;
    const edited = (['name', 'reference', 'notes', 'contactName', 'contactEmail', 'contactPhone'] as const).some((k) => before[k] !== c[k]);
    if (before.status !== c.status) this.log('client', id, id, c.status === 'archived' ? 'archived' : 'reactivated', { name: c.name });
    else if (edited) this.log('client', id, id, 'edited', { name: c.name });
    this.save();
  }

  async deleteClient(id: string) {
    if (this.s.occurrences.some((o) => o.clientId === id) || this.s.schedules.some((s) => s.clientId === id) || this.s.meetings.some((m) => m.clientId === id)) {
      throw new RepoError('It still has tasks or schedules attached. Archive it instead, so its history is kept.');
    }
    this.s.clients = this.s.clients.filter((c) => c.id !== id);
    this.save();
  }

  // Schedules ----------------------------------------------------------------------------------------------------
  private checkSchedule(s: Omit<Schedule, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>) {
    if (!s.title.trim() || s.title.length > 200) throw new RepoError('A schedule needs a title (up to 200 characters).');
    const errs = validateRecurrence(s);
    if (errs.length) throw new RepoError(errs[0]);
    if (!this.s.clients.some((c) => c.id === s.clientId)) throw new RepoError('Choose a client.');
    const cl = checklistError(s.checklist);
    if (cl) throw new RepoError(cl);
  }

  async createSchedule(input: NewSchedule): Promise<Schedule> {
    const row: Schedule = { checklist: [], ...input, id: uid(), workspaceId: this.s.workspace.id, status: 'active', createdAt: now(), updatedAt: now() };
    this.checkSchedule(row);
    this.s.schedules.push(row);
    this.log('schedule', row.id, row.clientId, 'created', { title: row.title });
    this.save();
    return structuredClone(row);
  }

  async updateSchedule(id: string, patch: SchedulePatch) {
    const s = this.find(this.s.schedules, id);
    const next = { ...s, ...patch };
    this.checkSchedule(next);
    const locked: (keyof Schedule)[] = ['unit', 'interval', 'anchorMonth', 'startDate', 'clientId'];
    if (locked.some((k) => next[k] !== s[k]) && this.s.occurrences.some((o) => o.scheduleId === id)) {
      throw new RepoError('The client, start date and how often a schedule repeats cannot change once it has tasks. End it and create a new schedule instead.');
    }
    const fields = (['title', 'description', 'dueRule', 'endDate', 'leadDays', 'defaultPriority', 'autoGenerate', 'taskType', 'checklist'] as const)
      .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(s[k]));
    if (next.status !== s.status) this.log('schedule', id, s.clientId, next.status === 'paused' ? 'paused' : next.status === 'ended' ? 'ended' : 'resumed', { title: next.title, end: next.endDate });
    if (fields.length) this.log('schedule', id, s.clientId, 'edited', { title: next.title, fields });
    Object.assign(s, patch, { updatedAt: now() });
    this.save();
  }

  async deleteSchedule(id: string) {
    if (this.s.occurrences.some((o) => o.scheduleId === id)) throw new RepoError('It still has tasks or schedules attached. Archive it instead, so its history is kept.');
    const s = this.find(this.s.schedules, id);
    this.s.schedules = this.s.schedules.filter((x) => x.id !== id);
    this.s.pauses = this.s.pauses.filter((p) => p.scheduleId !== id);
    this.s.reviews = this.s.reviews.filter((r) => r.scheduleId !== id);
    this.log('schedule', id, s.clientId, 'deleted', { title: s.title });
    this.save();
  }

  async setPaused(id: string, paused: boolean, on: ISODate) {
    const s = this.find(this.s.schedules, id);
    if (s.status === 'ended') throw new RepoError('This schedule has ended.');
    const open = this.s.pauses.find((p) => p.scheduleId === id && p.resumedOn === null);
    if (paused) {
      if (open) return;
      // Change the schedule first: if that is refused, no stray pause is left behind.
      await this.updateSchedule(id, { status: 'paused' });
      this.s.pauses.push({ id: uid(), workspaceId: s.workspaceId, scheduleId: id, pausedFrom: on, resumedOn: null, createdAt: now() });
      this.save();
    } else {
      if (open) open.resumedOn = on < open.pausedFrom ? open.pausedFrom : on;
      await this.updateSchedule(id, { status: 'active' });
    }
  }

  async endSchedule(id: string, end: ISODate, cancelLater: boolean) {
    const s = this.find(this.s.schedules, id);
    if (end < s.startDate) throw new RepoError('The end date is before the schedule starts.');
    for (const p of this.s.pauses) if (p.scheduleId === id && p.resumedOn === null) p.resumedOn = end < p.pausedFrom ? p.pausedFrom : end;
    await this.updateSchedule(id, { endDate: end, status: 'ended' });
    let n = 0;
    if (cancelLater) {
      for (const o of this.s.occurrences) {
        if (o.scheduleId === id && o.periodStart && o.periodStart > end && isOpen(o.status)) {
          this.setStatus(o, 'cancelled');
          n++;
        }
      }
    }
    this.save();
    return n;
  }

  async applySchedule(id: string, from: ISODate, oldTitle: string, oldDescription: string) {
    const s = this.find(this.s.schedules, id);
    let n = 0;
    for (const o of this.s.occurrences) {
      if (o.scheduleId !== id || !isOpen(o.status) || o.dueDate < from || !o.periodStart || !o.periodEnd) continue;
      const due = dueDateFor(s.dueRule, o.periodStart, o.periodEnd, calendarOf(this.s.workspace.settings));
      const moved = o.scheduledDueDate !== null && o.dueDate !== o.scheduledDueDate;
      const patch: OccurrencePatch = { taskType: s.taskType };
      if (o.title === oldTitle) patch.title = s.title;
      if (o.description === oldDescription) patch.description = s.description;
      if (!moved) patch.dueDate = due;
      await this.updateOccurrence(o.id, patch);
      o.scheduledDueDate = due;
      n++;
    }
    this.save();
    return n;
  }

  // Occurrences --------------------------------------------------------------------------------------------------
  private checkOccurrence(o: Pick<Occurrence, 'title' | 'clientId' | 'scheduleId' | 'tags'> & { checklist?: Occurrence['checklist'] }) {
    const cl = checklistError(o.checklist ?? []);
    if (cl) throw new RepoError(cl);
    if (!o.title.trim() || o.title.length > 200) throw new RepoError('A task needs a title (up to 200 characters).');
    if (!this.s.clients.some((c) => c.id === o.clientId)) throw new RepoError('Choose a client.');
    if (o.scheduleId && this.s.schedules.find((s) => s.id === o.scheduleId)?.clientId !== o.clientId) throw new RepoError('A schedule task must belong to the schedule’s client.');
    if (o.tags.length > 20) throw new RepoError('Up to 20 tags.');
  }

  private insertOccurrence(input: NewOccurrence): Occurrence {
    this.checkOccurrence(input);
    if (input.scheduleId && this.s.occurrences.some((o) => o.scheduleId === input.scheduleId && o.periodKey === input.periodKey)) {
      throw new RepoError('A task for that period already exists.');
    }
    const row: Occurrence = {
      ...input, id: uid(), workspaceId: this.s.workspace.id, createdAt: now(), updatedAt: now(),
      completedAt: input.status === 'done' ? input.completedAt ?? now() : null,
      checklist: input.checklist ?? [],
      waitingSince: input.status === 'waiting' ? input.waitingSince ?? now() : null,
    };
    this.s.occurrences.push(row);
    this.log('occurrence', row.id, row.clientId, row.scheduleId ? 'generated' : 'created', { title: row.title, due: row.dueDate, period: row.periodKey });
    return row;
  }

  async createOccurrence(input: NewOccurrence): Promise<Occurrence> {
    const row = this.insertOccurrence(input);
    this.save();
    return structuredClone(row);
  }

  private setStatus(o: Occurrence, status: Occurrence['status']) {
    if (o.status === status) return;
    this.log('occurrence', o.id, o.clientId, 'status', { title: o.title, from: o.status, to: status });
    o.status = status;
    o.completedAt = status === 'done' ? now() : null;
    o.waitingSince = status === 'waiting' ? now() : null;
    o.updatedAt = now();
  }

  async updateOccurrence(id: string, patch: OccurrencePatch) {
    const o = this.find(this.s.occurrences, id);
    const next = { ...o, ...patch };
    this.checkOccurrence(next);
    if (patch.status) this.setStatus(o, patch.status);
    if (patch.dueDate && patch.dueDate !== o.dueDate) {
      this.log('occurrence', id, o.clientId, 'rescheduled', { title: next.title, from: o.dueDate, to: patch.dueDate });
    }
    const fields = ([['title', 'title'], ['description', 'notes'], ['priority', 'priority'], ['tags', 'tags'], ['taskType', 'type'], ['clientId', 'client']] as const)
      .filter(([k]) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(o[k])).map(([, label]) => label);
    if (fields.length) this.log('occurrence', id, next.clientId, 'edited', { title: next.title, fields });
    const { status: _s, ...rest } = patch;
    Object.assign(o, rest, { updatedAt: now() });
    this.save();
  }

  async deleteOccurrence(id: string) {
    const o = this.find(this.s.occurrences, id);
    if (o.scheduleId) throw new RepoError('Tasks from a schedule can’t be deleted. Mark it cancelled instead, so the period stays accounted for.');
    this.s.occurrences = this.s.occurrences.filter((x) => x.id !== id);
    this.log('occurrence', id, o.clientId, 'deleted', { title: o.title, due: o.dueDate });
    this.save();
  }

  // Meetings -----------------------------------------------------------------------------------------------------
  private checkMeeting(m: NewMeeting) {
    const e = meetingErrors(m);
    if (e.title || e.time) throw new RepoError((e.title ?? e.time)!);
    if (m.clientId && !this.s.clients.some((c) => c.id === m.clientId)) throw new RepoError('That client no longer exists.');
    if (m.location.length > 500 || m.notes.length > 10000) throw new RepoError('The location or notes are too long.');
  }

  async createMeeting(input: NewMeeting): Promise<Meeting> {
    this.checkMeeting(input);
    const row: Meeting = { ...input, id: uid(), workspaceId: this.s.workspace.id, createdAt: now(), updatedAt: now() };
    this.s.meetings.push(row);
    this.log('meeting', row.id, row.clientId, 'created', { title: row.title, date: row.date, start: row.start });
    this.save();
    return structuredClone(row);
  }

  async updateMeeting(id: string, patch: MeetingPatch) {
    const m = this.find(this.s.meetings, id);
    const next = { ...m, ...patch };
    this.checkMeeting(next);
    if (next.date !== m.date || next.start !== m.start) this.log('meeting', id, next.clientId, 'rescheduled', { title: next.title, from: m.date, to: next.date, start: next.start });
    Object.assign(m, patch, { updatedAt: now() });
    this.save();
  }

  async deleteMeeting(id: string) {
    const m = this.find(this.s.meetings, id);
    this.s.meetings = this.s.meetings.filter((x) => x.id !== id);
    this.log('meeting', id, m.clientId, 'deleted', { title: m.title, date: m.date });
    this.save();
  }

  // Reviews ------------------------------------------------------------------------------------------------------
  async saveReview(r: NewReview) {
    if (r.status === 'exception' && !r.note.trim()) throw new RepoError('Say why this is an exception.');
    const s = this.find(this.s.schedules, r.scheduleId);
    const existing = this.s.reviews.find((x) => x.scheduleId === r.scheduleId && x.periodKey === r.periodKey);
    if (existing) Object.assign(existing, r, { updatedAt: now() });
    else this.s.reviews.push({ ...r, id: uid(), workspaceId: this.s.workspace.id, createdAt: now(), updatedAt: now() });
    this.log('review', r.scheduleId, s.clientId, r.status, { period: r.periodKey, note: r.note });
    this.save();
  }

  async deleteReview(id: string) {
    const r = this.find(this.s.reviews, id);
    this.s.reviews = this.s.reviews.filter((x) => x.id !== id);
    this.log('review', r.scheduleId, this.s.schedules.find((s) => s.id === r.scheduleId)?.clientId ?? null, 'review_cleared', { period: r.periodKey });
    this.save();
  }

  // Generation ---------------------------------------------------------------------------------------------------
  async generate() {
    const run = { id: uid(), workspaceId: this.s.workspace.id, trigger: 'app' as const, startedAt: now(), finishedAt: null as string | null, created: 0, errors: [] as { scheduleId: string; message: string }[] };
    const today = this.today();
    for (const s of liveSchedules(this.s.schedules, this.s.clients)) {
      // Like the database: a schedule that fails partway keeps none of that run's tasks.
      const before = this.s.occurrences.length, logged = this.s.activity.length;
      try {
        for (const o of planGeneration([s], this.s.pauses, this.s.occurrences, today, calendarOf(this.s.workspace.settings))) this.insertOccurrence(o);
        run.created += this.s.occurrences.length - before;
      } catch (e) {
        this.s.occurrences.length = before;
        this.s.activity.splice(0, this.s.activity.length - logged);
        run.errors.push({ scheduleId: s.id, message: (e as Error).message });
      }
    }
    run.finishedAt = now();
    this.s.runs = [run, ...this.s.runs].slice(0, 100);
    this.save();
    return run.created;
  }

  // Backup -------------------------------------------------------------------------------------------------------
  async restore(b: Backup) {
    if (this.s.clients.length || this.s.occurrences.length) throw new RepoError('Restore needs an empty workspace. Erase it first.');
    const ws = this.s.workspace.id;
    const fix = <T extends { workspaceId: string }>(xs: T[]) => xs.map((x) => ({ ...x, workspaceId: ws }));
    Object.assign(this.s.workspace, { name: b.workspace.name, timezone: b.workspace.timezone, settings: b.workspace.settings });
    const u = upgradeRows(b);
    this.s.clients = fix(u.clients);
    this.s.schedules = fix(u.schedules);
    this.s.pauses = fix(b.pauses);
    this.s.occurrences = fix(u.occurrences);
    this.s.reviews = fix(b.reviews);
    this.s.meetings = fix(b.meetings ?? []);
    this.s.activity = fix(b.activity ?? []);
    this.save();
  }

  async erase() {
    Object.assign(this.s, { clients: [], schedules: [], pauses: [], occurrences: [], reviews: [], meetings: [], activity: [], runs: [] });
    this.save();
  }

  /** Back to the original demo data. */
  reset(today = todayIn()) {
    this.s = buildSeed(today);
    this.save();
  }

  private find<T extends { id: string }>(xs: T[], id: string): T {
    const x = xs.find((r) => r.id === id);
    if (!x) throw new RepoError('It no longer exists. Reload to see the latest.');
    return x;
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
