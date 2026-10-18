// Fictional demo data. Every client, name and number here is invented; dates are relative to today so the demo
// always looks current. Built with the real generation logic, so it behaves exactly like real data would.

import { addDays, addMonths, fromParts, parts, startOfMonth, type ISODate } from '../lib/dates';
import { occurrenceFromPeriod, planGeneration } from '../lib/generation';
import { createOn, frequencyToUnit, listPeriods, periodContaining, periodKey, recurrenceOf } from '../lib/recurrence';
import type { Activity, Client, DueRule, Frequency, Occurrence, Priority, Schedule, Snapshot, TaskStatus, TaskType } from '../lib/types';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

const CLIENTS: [name: string, ref: string, notes: string][] = [
  ['Nordvik Snekkeri AS', 'C-1001', 'Carpentry workshop, 9 employees. Bank feed connected; receipts arrive by email.'],
  ['Fjellbris Kafé AS', 'C-1002', 'Café with two locations. Cash register exports monthly.'],
  ['Havbris Eiendom AS', 'C-1003', 'Property holding company, four rental units. Fiscal year follows the calendar year.'],
  ['Lysaker Design ENK', 'C-1004', 'Sole proprietor, graphic design. Prefers questions collected in one email.'],
  ['Elvebakken Rør AS', 'C-1005', 'Plumbing, 14 employees, payroll on the 20th.'],
  ['Solberg Tannklinikk AS', 'C-1006', 'Dental clinic. VAT-exempt services, separate VAT for retail.'],
  ['Granli Gartneri AS', 'C-1007', 'Seasonal garden centre: quiet November–February.'],
  ['Brattli Transport AS', 'C-1008', 'Haulage, 22 employees, weekly bank reconciliation.'],
  ['Kystlys Regnskapsdata AS', 'C-1009', 'Small software consultancy. Fiscal year runs July–June.'],
  ['Mørkved Bakeri AS', 'C-1010', 'Bakery, three shops. Supplier invoices are often late.'],
  ['Vestheim Arkitekter AS', 'C-1011', 'Architects, project-based invoicing.'],
  ['Tindeland Sport AS', 'C-1012', 'Sports retailer. Inventory count at year end.'],
  ['Åsgard Helse AS', 'C-1013', 'Physiotherapy practice, VAT-exempt.'],
  ['Strandvik Marina AS', 'C-1014', 'Boat storage and marina. New client since last month.'],
  ['Bergsli Elektro AS', 'C-1015', 'Electrical contractor, 11 employees.'],
  ['Furulund Barnehage SA', 'C-1016', 'Cooperative kindergarten. Board meeting in March.'],
  ['Kvitfjell Hytteutleie ENK', 'C-1017', 'Cabin rentals. High season in winter.'],
  ['Hagen & Lie Advokater DA', 'C-1018', 'Law partnership, two partners.'],
  ['Sjøgløtt Fisk AS', 'C-1019', 'Fish wholesaler. Moved to another accountant; kept for history.'],
  ['Dalsrud Maskin AS', 'C-1020', 'Machine rental. Quarterly management report for the bank.'],
];

interface ScheduleSpec {
  client: number;
  title: string;
  description: string;
  type: TaskType;
  frequency: Frequency;
  custom?: { unit: 'week' | 'month'; interval: number };
  anchor?: number;
  rule: DueRule;
  lead: number;
  priority?: Priority;
  /** Months before today the schedule started. */
  startedMonthsAgo: number;
  /** Months before today it started creating tasks automatically (defaults to its start). */
  generatingMonthsAgo?: number;
  auto?: boolean;
}

const BOOKKEEPING: DueRule = { kind: 'month_offset', from: 'end', months: 1, day: 15, adjust: 'next_business_day' };
const VAT: DueRule = { kind: 'month_offset', from: 'end', months: 2, day: 10, adjust: 'next_business_day' };
const A_MELDING: DueRule = { kind: 'month_offset', from: 'end', months: 1, day: 5, adjust: 'next_business_day' };
const PAYROLL: DueRule = { kind: 'month_offset', from: 'start', months: 0, day: 18, adjust: 'previous_business_day' };
const QUARTERLY: DueRule = { kind: 'month_offset', from: 'end', months: 1, day: 20, adjust: 'next_business_day' };
const ANNUAL: DueRule = { kind: 'month_offset', from: 'end', months: 5, day: 31 };
const SHAREHOLDERS: DueRule = { kind: 'month_offset', from: 'end', months: 1, day: 31 };
const WEEKLY_FRIDAY: DueRule = { kind: 'weekday', weekday: 5 };

function schedulesSpec(): ScheduleSpec[] {
  const out: ScheduleSpec[] = [];
  const book = (client: number, extra: Partial<ScheduleSpec> = {}) => out.push({
    client, title: 'Monthly bookkeeping', description: 'Post receipts and invoices, reconcile bank, check open items.',
    type: 'bookkeeping', frequency: 'monthly', rule: BOOKKEEPING, lead: 20, startedMonthsAgo: 10, ...extra,
  });
  const vat = (client: number, extra: Partial<ScheduleSpec> = {}) => out.push({
    client, title: 'VAT return', description: 'Two-monthly VAT return. Check the deadline for the term before submitting.',
    type: 'vat', frequency: 'custom', custom: { unit: 'month', interval: 2 }, rule: VAT, lead: 25, priority: 'high', startedMonthsAgo: 12, ...extra,
  });
  const payroll = (client: number) => {
    out.push({ client, title: 'Payroll run', description: 'Check hours and changes, run payroll, send payslips.', type: 'payroll', frequency: 'monthly', rule: PAYROLL, lead: 10, priority: 'high', startedMonthsAgo: 10 });
    out.push({ client, title: 'Payroll reporting (a-melding)', description: 'Monthly employer report.', type: 'payroll', frequency: 'monthly', rule: A_MELDING, lead: 10, priority: 'high', startedMonthsAgo: 10 });
  };
  const annual = (client: number, extra: Partial<ScheduleSpec> = {}) => out.push({
    client, title: 'Annual accounts', description: 'Year-end closing, annual accounts and notes.', type: 'annual', frequency: 'yearly',
    rule: ANNUAL, lead: 120, priority: 'high', startedMonthsAgo: 22, ...extra,
  });

  for (const c of [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 17, 19]) book(c);
  for (const c of [0, 1, 4, 5, 7, 9, 11, 14, 19]) vat(c);
  for (const c of [0, 4, 7, 9, 14]) payroll(c);
  for (const c of [0, 2, 4, 7, 10, 11, 14, 19]) annual(c);
  annual(8, { anchor: 7, title: 'Annual accounts (FY July–June)' });
  out.push({ client: 2, title: 'Shareholder register statement', description: 'Annual shareholder register report.', type: 'reporting', frequency: 'yearly', rule: SHAREHOLDERS, lead: 45, startedMonthsAgo: 22 });
  out.push({ client: 19, title: 'Quarterly management report', description: 'P&L and balance sheet with comments, for the bank.', type: 'reporting', frequency: 'quarterly', rule: QUARTERLY, lead: 21, startedMonthsAgo: 12 });
  out.push({ client: 10, title: 'Quarterly project review', description: 'Review WIP and unbilled hours with the partners.', type: 'reporting', frequency: 'quarterly', rule: QUARTERLY, lead: 14, startedMonthsAgo: 9 });
  out.push({ client: 7, title: 'Weekly bank reconciliation', description: 'Match bank transactions and flag anything unusual.', type: 'bookkeeping', frequency: 'weekly', rule: WEEKLY_FRIDAY, lead: 4, startedMonthsAgo: 2 });
  out.push({ client: 9, title: 'Weekly supplier invoice check', description: 'Approve and post supplier invoices.', type: 'bookkeeping', frequency: 'weekly', rule: WEEKLY_FRIDAY, lead: 4, startedMonthsAgo: 2 });
  // Genuine missing examples: a new client whose schedule started before it was added to Ledger …
  book(13, { startedMonthsAgo: 4, generatingMonthsAgo: 1 });
  vat(13, { startedMonthsAgo: 6, generatingMonthsAgo: 1 });
  // … and a check-only schedule (automatic creation off) whose last period has no task.
  out.push({ client: 16, title: 'Monthly booking reconciliation', description: 'Reconcile booking platform payouts against bank. Created by hand when statements arrive.', type: 'bookkeeping', frequency: 'monthly', rule: BOOKKEEPING, lead: 20, startedMonthsAgo: 5, auto: false });
  // A seasonal client (paused below) and a client who left (archived).
  book(6, { startedMonthsAgo: 12 });
  book(18, { startedMonthsAgo: 14 });
  vat(18, { startedMonthsAgo: 14 });
  return out;
}

const ONE_OFFS: [client: number, title: string, type: TaskType, dueOffset: number, status: TaskStatus, priority: Priority, tags: string[], notes: string][] = [
  [9, 'Chase missing supplier invoices for September', 'follow_up', -4, 'waiting', 'high', ['receipts'], 'Asked on email; reminder sent once.'],
  [1, 'Request cash register export for both locations', 'follow_up', -2, 'waiting', 'normal', ['receipts'], ''],
  [3, 'Collect year-to-date questions in one email', 'follow_up', 0, 'todo', 'normal', [], 'Client prefers one email with all questions.'],
  [13, 'Onboarding: get access to bank feed', 'other', -6, 'in_progress', 'urgent', ['onboarding'], 'Bank says access is pending signature.'],
  [13, 'Onboarding: opening balance from previous accountant', 'bookkeeping', 3, 'waiting', 'high', ['onboarding'], ''],
  [11, 'Plan year-end inventory count', 'annual', 12, 'todo', 'normal', ['year-end'], ''],
  [15, 'Prepare figures for board meeting', 'reporting', 9, 'todo', 'normal', ['meeting'], ''],
  [17, 'Clarify private use of company car', 'follow_up', 1, 'todo', 'high', [], ''],
  [5, 'Check VAT split between exempt and retail sales', 'vat', 5, 'in_progress', 'normal', [], ''],
  [0, 'Fixed asset register update', 'bookkeeping', 18, 'todo', 'low', ['year-end'], ''],
  [10, 'Invoice review with partners', 'reporting', -1, 'todo', 'normal', ['meeting'], ''],
  [12, 'Confirm new opening hours for payroll', 'payroll', 2, 'todo', 'low', [], ''],
  [2, 'Lease contract renewal: check accruals', 'bookkeeping', -9, 'done', 'normal', [], ''],
  [14, 'Holiday pay calculation check', 'payroll', -15, 'done', 'high', [], ''],
  [19, 'Send loan covenant figures to bank', 'reporting', 6, 'todo', 'urgent', ['bank'], ''],
  [4, 'Year-end planning call', 'annual', 24, 'todo', 'normal', ['meeting', 'year-end'], ''],
];

export function buildSeed(today: ISODate): Snapshot {
  const r = rng(Number(today.replaceAll('-', '')));
  const ws = 'demo-workspace';
  const stamp = new Date().toISOString();
  const thisMonth = startOfMonth(today);
  const [ty] = parts(today);

  const clients: Client[] = CLIENTS.map(([name, reference, notes], i) => ({
    id: `client-${i + 1}`, workspaceId: ws, name, reference, notes, status: i === 18 ? 'archived' : 'active', createdAt: stamp, updatedAt: stamp,
  }));

  const schedules: Schedule[] = schedulesSpec().map((s, i) => {
    const { unit, interval } = frequencyToUnit(s.frequency, s.custom);
    const anchor = s.anchor ?? 1;
    // Yearly schedules start at the beginning of a (fiscal) year; others at the start of a month.
    const startDate = s.frequency === 'yearly' ? fromParts(ty - 2, anchor, 1) : addMonths(thisMonth, -s.startedMonthsAgo);
    const generateFrom = s.generatingMonthsAgo !== undefined ? addMonths(thisMonth, -s.generatingMonthsAgo) : startDate;
    return {
      id: `schedule-${i + 1}`, workspaceId: ws, clientId: `client-${s.client + 1}`, title: s.title, description: s.description,
      taskType: s.type, frequency: s.frequency, unit, interval, anchorMonth: anchor, dueRule: s.rule,
      startDate, endDate: null, generateFrom, leadDays: s.lead, reminderDays: 3, autoGenerate: s.auto ?? true,
      status: 'active', defaultPriority: s.priority ?? 'normal', createdAt: stamp, updatedAt: stamp,
    };
  });

  // The seasonal garden centre is paused for the winter; the client who left had their schedules ended.
  const pauses: Snapshot['pauses'] = [];
  const seasonal = schedules.find((s) => s.clientId === 'client-7')!;
  seasonal.status = 'paused';
  pauses.push({ id: 'pause-1', workspaceId: ws, scheduleId: seasonal.id, pausedFrom: addDays(today, -20), resumedOn: null, createdAt: stamp });
  const leftOn = addMonths(thisMonth, -2);
  for (const s of schedules.filter((x) => x.clientId === 'client-19')) { s.status = 'ended'; s.endDate = addDays(leftOn, -1); }

  // Occurrences, generated as the database would, then given a realistic history.
  const occurrences: Occurrence[] = [];
  const add = (o: Omit<Occurrence, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>) => {
    const row: Occurrence = { ...o, id: `task-${occurrences.length + 1}`, workspaceId: ws, createdAt: stamp, updatedAt: stamp };
    occurrences.push(row);
    return row;
  };
  for (const o of planGeneration(schedules, pauses, [], today)) {
    const age = -(Date.parse(o.dueDate) - Date.parse(today)) / 86_400_000;
    let status: TaskStatus = 'todo';
    if (age > 45) status = r() < 0.995 ? 'done' : 'todo';
    else if (age > 10) status = r() < 0.85 ? 'done' : r() < 0.5 ? 'waiting' : 'todo';
    else if (age > 0) status = r() < 0.65 ? 'done' : r() < 0.5 ? 'waiting' : 'in_progress';
    else if (age > -7) status = r() < 0.25 ? 'in_progress' : r() < 0.1 ? 'waiting' : 'todo';
    // The client who left: everything up to their departure was finished.
    if (o.clientId === 'client-19' && o.dueDate < today) status = 'done';
    const completedAt = status === 'done' ? new Date(Date.parse(o.dueDate) - Math.floor(r() * 5) * 86_400_000 + 15 * 3_600_000).toISOString() : null;
    add({ ...o, status, completedAt });
  }
  // The check-only schedule: tasks were added by hand for every period except the latest one.
  const checkOnly = schedules.find((s) => !s.autoGenerate)!;
  const due = listPeriods(recurrenceOf(checkOnly), today).filter((p) => createOn(p.due, checkOnly.leadDays) <= today);
  for (const p of due.slice(0, -1)) {
    add({ ...occurrenceFromPeriod(checkOnly, p), status: 'done', completedAt: new Date(Date.parse(p.due) - 2 * 86_400_000).toISOString() });
  }
  // One task was moved by hand (a client asked for more time), another was skipped.
  const movable = occurrences.find((o) => o.status === 'todo' && o.dueDate > today && o.taskType === 'bookkeeping');
  if (movable) movable.dueDate = addDays(movable.dueDate, 7);
  const skippable = occurrences.find((o) => o.status === 'done' && o.clientId === 'client-12');
  if (skippable) { skippable.status = 'cancelled'; skippable.completedAt = null; skippable.description = 'No activity this period; agreed with client to skip.'; }

  for (const [client, title, type, due, status, priority, tags, notes] of ONE_OFFS) {
    add({
      clientId: `client-${client + 1}`, scheduleId: null, title, description: notes, taskType: type, periodKey: null, periodStart: null, periodEnd: null,
      dueDate: addDays(today, due), scheduledDueDate: null, status, priority, tags,
      completedAt: status === 'done' ? new Date(Date.parse(addDays(today, due))).toISOString() : null,
    });
  }

  // One recorded exception and one reviewed item among the missing periods of the new client.
  const reviews: Snapshot['reviews'] = [];
  const newVat = schedules.find((s) => s.clientId === 'client-14' && s.taskType === 'vat')!;
  const firstVatKey = periodKey(newVat, periodContaining(recurrenceOf(newVat), newVat.startDate).start);
  reviews.push({ id: 'review-1', workspaceId: ws, scheduleId: newVat.id, periodKey: firstVatKey, status: 'exception', note: 'Filed by the previous accountant before we took over.', createdAt: stamp, updatedAt: stamp });

  // Recent history.
  const activity: Activity[] = occurrences
    .filter((o) => o.completedAt && Date.parse(o.completedAt) > Date.parse(addDays(today, -14)))
    .map((o, i) => ({
      id: `act-${i}`, workspaceId: ws, entity: 'occurrence' as const, entityId: o.id, clientId: o.clientId, action: 'status',
      details: { title: o.title, from: 'in_progress', to: 'done' }, actorId: 'demo', createdAt: o.completedAt!,
    }));
  activity.push({ id: 'act-pause', workspaceId: ws, entity: 'schedule', entityId: seasonal.id, clientId: seasonal.clientId, action: 'paused', details: { title: seasonal.title }, actorId: 'demo', createdAt: new Date(Date.parse(addDays(today, -20))).toISOString() });
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    workspace: { id: ws, name: 'Demo workspace', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Oslo', settings: { displayName: '', pinnedClients: ['client-10', 'client-1', 'client-14'] } },
    clients, schedules, pauses, occurrences, reviews, activity,
    runs: [{ id: 'run-1', workspaceId: ws, trigger: 'app', startedAt: stamp, finishedAt: stamp, created: occurrences.length, errors: [] }],
  };
}
