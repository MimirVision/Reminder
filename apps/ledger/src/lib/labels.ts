import type { Priority, ScheduleStatus, TaskStatus, TaskType } from './types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do', in_progress: 'In progress', waiting: 'Waiting for client', done: 'Done', cancelled: 'Cancelled',
};
export const STATUS_SHORT: Record<TaskStatus, string> = {
  todo: 'To do', in_progress: 'In progress', waiting: 'Waiting', done: 'Done', cancelled: 'Cancelled',
};
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
export const TYPE_LABEL: Record<TaskType, string> = {
  bookkeeping: 'Bookkeeping', vat: 'VAT', payroll: 'Payroll', reporting: 'Reporting', annual: 'Annual', tax: 'Tax', follow_up: 'Follow-up', other: 'Other',
};
export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = { active: 'Active', paused: 'Paused', ended: 'Ended' };
