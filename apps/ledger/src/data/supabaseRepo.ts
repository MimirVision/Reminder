// The real workspace: Supabase Postgres with row level security. Only the publishable (anon) key is used here;
// every row is protected by the policies in supabase/migrations/0001_ledger_init.sql.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISODate } from '../lib/dates';
import type { Activity, Client, GenerationRun, Meeting, Occurrence, Pause, Review, Schedule, Snapshot, Workspace } from '../lib/types';
import type { Backup, MeetingPatch, NewMeeting, ClientPatch, NewClient, NewOccurrence, NewReview, NewSchedule, OccurrencePatch, Repo, SchedulePatch } from './repo';
import { RepoError, withUuids } from './repo';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toWorkspace = (r: Row): Workspace => ({ id: r.id, name: r.name, timezone: r.timezone, settings: r.settings ?? {} });
const toClient = (r: Row): Client => ({
  id: r.id, workspaceId: r.workspace_id, name: r.name, reference: r.reference, status: r.status, notes: r.notes,
  contactName: r.contact_name ?? '', contactEmail: r.contact_email ?? '', contactPhone: r.contact_phone ?? '', documents: r.documents ?? [],
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const toSchedule = (r: Row): Schedule => ({
  id: r.id, workspaceId: r.workspace_id, clientId: r.client_id, title: r.title, description: r.description, taskType: r.task_type,
  frequency: r.frequency, unit: r.unit, interval: r.interval_count, anchorMonth: r.anchor_month, dueRule: r.due_rule,
  startDate: r.start_date, endDate: r.end_date, generateFrom: r.generate_from, leadDays: r.lead_days, reminderDays: r.reminder_days,
  autoGenerate: r.auto_generate, status: r.status, defaultPriority: r.default_priority, checklist: r.checklist ?? [], createdAt: r.created_at, updatedAt: r.updated_at,
});
const toPause = (r: Row): Pause => ({ id: r.id, workspaceId: r.workspace_id, scheduleId: r.schedule_id, pausedFrom: r.paused_from, resumedOn: r.resumed_on, createdAt: r.created_at });
const toOccurrence = (r: Row): Occurrence => ({
  id: r.id, workspaceId: r.workspace_id, clientId: r.client_id, scheduleId: r.schedule_id, title: r.title, description: r.description,
  taskType: r.task_type, periodKey: r.period_key, periodStart: r.period_start, periodEnd: r.period_end, dueDate: r.due_date,
  scheduledDueDate: r.scheduled_due_date, status: r.status, priority: r.priority, tags: r.tags ?? [], completedAt: r.completed_at,
  checklist: r.checklist ?? [], waitingSince: r.waiting_since ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const hhmm = (t: string) => String(t ?? '').slice(0, 5);
const toMeeting = (r: Row): Meeting => ({
  id: r.id, workspaceId: r.workspace_id, clientId: r.client_id, title: r.title, date: r.meeting_date, start: hhmm(r.start_time), end: hhmm(r.end_time),
  location: r.location ?? '', notes: r.notes ?? '', createdAt: r.created_at, updatedAt: r.updated_at,
});
const meetingRow = (m: Partial<NewMeeting>): Row => strip({
  client_id: m.clientId, title: m.title, meeting_date: m.date, start_time: m.start, end_time: m.end, location: m.location, notes: m.notes,
});
const toReview = (r: Row): Review => ({ id: r.id, workspaceId: r.workspace_id, scheduleId: r.schedule_id, periodKey: r.period_key, status: r.status, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at });
const toActivity = (r: Row): Activity => ({ id: String(r.id), workspaceId: r.workspace_id, entity: r.entity, entityId: r.entity_id, clientId: r.client_id, action: r.action, details: r.details ?? {}, actorId: r.actor_id, createdAt: r.created_at });
const toRun = (r: Row): GenerationRun => ({ id: String(r.id), workspaceId: r.workspace_id, trigger: r.trigger, startedAt: r.started_at, finishedAt: r.finished_at, created: r.created_count, errors: r.errors ?? [] });

const scheduleRow = (s: Partial<Schedule>): Row => strip({
  client_id: s.clientId, title: s.title, description: s.description, task_type: s.taskType, frequency: s.frequency, unit: s.unit,
  interval_count: s.interval, anchor_month: s.anchorMonth, due_rule: s.dueRule, start_date: s.startDate, end_date: s.endDate,
  generate_from: s.generateFrom, lead_days: s.leadDays, reminder_days: s.reminderDays, auto_generate: s.autoGenerate,
  status: s.status, default_priority: s.defaultPriority, checklist: s.checklist,
});
const occurrenceRow = (o: Partial<Occurrence>): Row => strip({
  client_id: o.clientId, schedule_id: o.scheduleId, title: o.title, description: o.description, task_type: o.taskType,
  period_key: o.periodKey, period_start: o.periodStart, period_end: o.periodEnd, due_date: o.dueDate,
  scheduled_due_date: o.scheduledDueDate, status: o.status, priority: o.priority, tags: o.tags, completed_at: o.completedAt,
  checklist: o.checklist, waiting_since: o.waitingSince,
});
const clientRow = (c: Partial<Client>): Row => strip({
  name: c.name, reference: c.reference === '' ? null : c.reference, status: c.status, notes: c.notes,
  contact_name: c.contactName, contact_email: c.contactEmail, contact_phone: c.contactPhone, documents: c.documents,
});

/** Columns added by 0003_ledger_v3.sql, left out of writes until that file has been run. */
const V3_COLUMNS = ['checklist', 'waiting_since', 'contact_name', 'contact_email', 'contact_phone', 'documents'];

function strip(r: Row): Row {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
}

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export class SupabaseRepo implements Repo {
  readonly mode = 'supabase' as const;
  current = false;
  meetings = false;
  private ws: Workspace | null = null;
  constructor(private sb: SupabaseClient) {}

  /** A row to write, without the newer columns while the database doesn't have them yet. */
  private w(r: Row): Row {
    return this.current ? r : Object.fromEntries(Object.entries(r).filter(([k]) => !V3_COLUMNS.includes(k)));
  }

  private async workspaceId(): Promise<string> {
    if (!this.ws) this.ws = toWorkspace(check(await this.sb.rpc('ledger_my_workspace')) as Row);
    return this.ws.id;
  }

  /** Reads a whole table in pages (PostgREST returns at most 1000 rows per request). */
  private async all(table: string, order = 'created_at'): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const page = check(await this.sb.from(table).select('*').order(order).order('id').range(from, from + 999)) as Row[];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  async load(): Promise<Snapshot> {
    this.ws = null;
    await this.workspaceId();
    // ledger_schema_version() exists once the v3 SQL has been run.
    const v = await this.sb.rpc('ledger_schema_version');
    this.current = !v.error && Number(v.data) >= 3;
    this.meetings = !v.error && Number(v.data) >= 4;
    const [clients, schedules, pauses, occurrences, reviews, meetings, activity, runs] = await Promise.all([
      this.all('ledger_clients'), this.all('ledger_schedules'), this.all('ledger_schedule_pauses'), this.all('ledger_occurrences', 'due_date'),
      this.all('ledger_reviews'),
      this.meetings ? this.all('ledger_meetings', 'meeting_date') : Promise.resolve([] as Row[]),
      this.sb.from('ledger_activity').select('*').order('created_at', { ascending: false }).limit(1000).then(check),
      this.sb.from('ledger_generation_runs').select('*').order('started_at', { ascending: false }).limit(20).then(check),
    ]);
    return {
      workspace: this.ws!,
      clients: clients.map(toClient), schedules: schedules.map(toSchedule), pauses: pauses.map(toPause),
      occurrences: occurrences.map(toOccurrence), reviews: reviews.map(toReview), meetings: meetings.map(toMeeting),
      activity: (activity as Row[]).map(toActivity), runs: (runs as Row[]).map(toRun),
    };
  }

  async updateWorkspace(patch: Partial<Pick<Workspace, 'name' | 'timezone' | 'settings'>>) {
    check(await this.sb.from('ledger_workspaces').update(patch).eq('id', await this.workspaceId()));
  }

  async createClient(c: NewClient): Promise<Client> {
    const row = check(await this.sb.from('ledger_clients').insert(this.w({ ...clientRow(c), workspace_id: await this.workspaceId() })).select().single());
    return toClient(row as Row);
  }
  async updateClient(id: string, patch: ClientPatch) {
    check(await this.sb.from('ledger_clients').update(this.w(clientRow(patch))).eq('id', id));
  }
  async deleteClient(id: string) {
    const res = check(await this.sb.from('ledger_clients').delete().eq('id', id).select('id'));
    if (!(res as Row[]).length) throw new RepoError('It could not be deleted.');
  }

  async createSchedule(s: NewSchedule): Promise<Schedule> {
    const row = check(await this.sb.from('ledger_schedules').insert(this.w({ ...scheduleRow(s), workspace_id: await this.workspaceId() })).select().single());
    return toSchedule(row as Row);
  }
  async updateSchedule(id: string, patch: SchedulePatch) {
    check(await this.sb.from('ledger_schedules').update(this.w(scheduleRow(patch))).eq('id', id));
  }
  async deleteSchedule(id: string) {
    check(await this.sb.from('ledger_schedules').delete().eq('id', id));
  }
  async setPaused(id: string, paused: boolean, on: ISODate) {
    check(await this.sb.rpc('ledger_set_paused', { p_schedule: id, p_paused: paused, p_on: on }));
  }
  async endSchedule(id: string, end: ISODate, cancelLater: boolean) {
    return Number(check(await this.sb.rpc('ledger_end_schedule', { p_schedule: id, p_end: end, p_cancel_later: cancelLater })));
  }
  async applySchedule(id: string, from: ISODate, oldTitle: string, oldDescription: string) {
    return Number(check(await this.sb.rpc('ledger_apply_schedule', { p_schedule: id, p_from: from, p_old_title: oldTitle, p_old_description: oldDescription })));
  }

  async createOccurrence(o: NewOccurrence): Promise<Occurrence> {
    const row = check(await this.sb.from('ledger_occurrences').insert(this.w({ ...occurrenceRow(o), workspace_id: await this.workspaceId() })).select().single());
    return toOccurrence(row as Row);
  }
  async updateOccurrence(id: string, patch: OccurrencePatch) {
    const res = check(await this.sb.from('ledger_occurrences').update(this.w(occurrenceRow(patch))).eq('id', id).select('id'));
    if (!(res as Row[]).length) throw new RepoError('That task no longer exists. Reload to see the latest.');
  }
  async deleteOccurrence(id: string) {
    const res = check(await this.sb.from('ledger_occurrences').delete().eq('id', id).select('id'));
    if (!(res as Row[]).length) throw new RepoError('Tasks from a schedule can’t be deleted. Mark it cancelled instead, so the period stays accounted for.');
  }

  async createMeeting(m: NewMeeting): Promise<Meeting> {
    if (!this.meetings) throw new RepoError('Meetings need the database update: run ledger.sql again (see Settings).');
    return toMeeting(check(await this.sb.from('ledger_meetings').insert({ ...meetingRow(m), workspace_id: await this.workspaceId() }).select().single()) as Row);
  }
  async updateMeeting(id: string, patch: MeetingPatch) {
    const res = check(await this.sb.from('ledger_meetings').update(meetingRow(patch)).eq('id', id).select('id'));
    if (!(res as Row[]).length) throw new RepoError('That meeting no longer exists. Reload to see the latest.');
  }
  async deleteMeeting(id: string) {
    check(await this.sb.from('ledger_meetings').delete().eq('id', id));
  }

  async saveReview(r: NewReview) {
    check(await this.sb.from('ledger_reviews').upsert(
      { workspace_id: await this.workspaceId(), schedule_id: r.scheduleId, period_key: r.periodKey, status: r.status, note: r.note },
      { onConflict: 'schedule_id,period_key' }));
  }
  async deleteReview(id: string) {
    check(await this.sb.from('ledger_reviews').delete().eq('id', id));
  }

  async generate() {
    return Number(check(await this.sb.rpc('ledger_generate')));
  }

  async restore(backup: Backup) {
    const b = withUuids(backup);
    const ws = await this.workspaceId();
    const existing = check(await this.sb.from('ledger_clients').select('id').limit(1)) as Row[];
    if (existing.length) throw new RepoError('Restore needs an empty workspace. Erase it first.');
    await this.updateWorkspace({ name: b.workspace.name, timezone: b.workspace.timezone, settings: b.workspace.settings });
    const put = async (table: string, rows: Row[]) => {
      for (let i = 0; i < rows.length; i += 500) check(await this.sb.from(table).insert(rows.slice(i, i + 500).map((r) => this.w(r))));
    };
    await put('ledger_clients', b.clients.map((c) => ({ id: c.id, workspace_id: ws, ...clientRow(c), created_at: c.createdAt })));
    await put('ledger_schedules', b.schedules.map((s) => ({ id: s.id, workspace_id: ws, ...scheduleRow(s), created_at: s.createdAt })));
    await put('ledger_schedule_pauses', b.pauses.map((p) => ({ id: p.id, workspace_id: ws, schedule_id: p.scheduleId, paused_from: p.pausedFrom, resumed_on: p.resumedOn })));
    await put('ledger_occurrences', b.occurrences.map((o) => ({ id: o.id, workspace_id: ws, ...occurrenceRow(o), created_at: o.createdAt })));
    await put('ledger_reviews', b.reviews.map((r) => ({ id: r.id, workspace_id: ws, schedule_id: r.scheduleId, period_key: r.periodKey, status: r.status, note: r.note })));
    if (this.meetings) await put('ledger_meetings', (b.meetings ?? []).map((m) => ({ id: m.id, workspace_id: ws, ...meetingRow(m), created_at: m.createdAt })));
  }

  async erase() {
    check(await this.sb.rpc('ledger_erase_workspace', { p_confirm: await this.workspaceId() }));
  }
}
