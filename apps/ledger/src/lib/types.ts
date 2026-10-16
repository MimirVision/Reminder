import type { ISODate } from './dates';

export type ClientStatus = 'active' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskType = 'bookkeeping' | 'vat' | 'payroll' | 'reporting' | 'annual' | 'tax' | 'follow_up' | 'other';
export type ScheduleStatus = 'active' | 'paused' | 'ended';
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type IntervalUnit = 'week' | 'month';

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'done', 'cancelled'];
export const OPEN_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'waiting'];
export const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];
export const TASK_TYPES: TaskType[] = ['bookkeeping', 'vat', 'payroll', 'reporting', 'annual', 'tax', 'follow_up', 'other'];

/**
 * When an occurrence is due, relative to its period. A tagged union so accounting-specific rules (public holidays,
 * "n-th business day", authority calendars) can be added later as new kinds without touching existing schedules.
 */
export type DueRule =
  /** Day `day` of the month that is `months` months after the period's first (`from: 'start'`) or last (`from: 'end'`) month. */
  | { kind: 'month_offset'; from: 'start' | 'end'; months: number; day: number | 'last'; adjust?: Adjust }
  /** `days` days after the period's last day. */
  | { kind: 'days_after_end'; days: number; adjust?: Adjust }
  /** A weekday inside the period's first week (weekly schedules). */
  | { kind: 'weekday'; weekday: number; adjust?: Adjust };

/** What to do when the date lands on a Saturday or Sunday. */
export type Adjust = 'none' | 'next_business_day' | 'previous_business_day';

export interface Recurrence {
  unit: IntervalUnit;
  interval: number;
  /** Month (1–12) that month-based periods are aligned to: 1 gives calendar quarters/years, 7 gives a July fiscal year. */
  anchorMonth: number;
  startDate: ISODate;
  endDate: ISODate | null;
  dueRule: DueRule;
}

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  settings: WorkspaceSettings;
}

export interface WorkspaceSettings {
  displayName?: string;
  locale?: string;
  weekStartsOn?: 1;
  defaultCalendarView?: 'month' | 'week';
  defaultLeadDays?: number;
  defaultReminderDays?: number;
  theme?: 'light' | 'dark' | 'system';
}

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  reference: string | null;
  status: ClientStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  workspaceId: string;
  clientId: string;
  title: string;
  description: string;
  taskType: TaskType;
  frequency: Frequency;
  unit: IntervalUnit;
  interval: number;
  anchorMonth: number;
  dueRule: DueRule;
  startDate: ISODate;
  endDate: ISODate | null;
  /** Periods due before this date are never created automatically; they are reported for review instead. */
  generateFrom: ISODate;
  /** How many days before the due date an occurrence is created. */
  leadDays: number;
  reminderDays: number | null;
  autoGenerate: boolean;
  status: ScheduleStatus;
  defaultPriority: Priority;
  createdAt: string;
  updatedAt: string;
}

export interface Pause {
  id: string;
  workspaceId: string;
  scheduleId: string;
  pausedFrom: ISODate;
  resumedOn: ISODate | null;
  createdAt: string;
}

export interface Occurrence {
  id: string;
  workspaceId: string;
  clientId: string;
  scheduleId: string | null;
  title: string;
  description: string;
  taskType: TaskType;
  periodKey: string | null;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  dueDate: ISODate;
  /** The due date the schedule calculated; differs from dueDate when this one occurrence was moved. */
  scheduledDueDate: ISODate | null;
  status: TaskStatus;
  priority: Priority;
  tags: string[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReviewStatus = 'reviewed' | 'exception';

export interface Review {
  id: string;
  workspaceId: string;
  scheduleId: string;
  periodKey: string;
  status: ReviewStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  workspaceId: string;
  entity: 'occurrence' | 'schedule' | 'client' | 'review';
  entityId: string;
  clientId: string | null;
  action: string;
  details: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

export interface GenerationRun {
  id: string;
  workspaceId: string;
  trigger: 'cron' | 'app' | 'manual';
  startedAt: string;
  finishedAt: string | null;
  created: number;
  errors: { scheduleId: string; message: string }[];
}

export interface Snapshot {
  workspace: Workspace;
  clients: Client[];
  schedules: Schedule[];
  pauses: Pause[];
  occurrences: Occurrence[];
  reviews: Review[];
  activity: Activity[];
  runs: GenerationRun[];
}

export const isOpen = (s: TaskStatus) => s === 'todo' || s === 'in_progress' || s === 'waiting';
