import type { ISODate } from './dates';

/** The days a supplement can apply on. A date can match several: 17 May on a Saturday is both 'sat' and 'holiday'. */
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'holiday' | 'holiday_eve';
export const WEEKDAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** kr per time, prosent av timelønnen per time, or a fixed sum for each shift that touches the window. */
export type AmountType = 'kr_per_hour' | 'percent' | 'kr_per_shift';

/** A tillegg: what it pays, and on which days between which times. */
export interface Supplement {
  id: string;
  /** The employer (or department) whose setup this supplement belongs to. */
  employer_id: string;
  name: string;
  color: string;
  amount_type: AmountType;
  amount: number;
  /** For percent: at least this many kr per hour (many tariffs say "25 %, minst kr 60"). */
  min_per_hour: number | null;
  days: DayKey[];
  /** 'HH:MM'. When end is at or before start the window runs past midnight (21:00–06:00 is one night); equal means all day. */
  start_time: string;
  end_time: string;
  active: boolean;
  sort: number;
}

export interface Shift {
  id: string;
  /** Which employer the shift is for; null only for shifts saved before employers existed (counted as the first). */
  employer_id: string | null;
  date: ISODate;
  start_time: string;
  /** At or before the start means the shift ends the next day (a night shift). */
  end_time: string;
  /** Unpaid break, taken off the paid hours. */
  break_minutes: number;
  /** Overtime on top of the hourly wage for the whole shift: 0, 50 or 100 (percent). */
  overtime_percent: number;
  note: string;
}

/** The hourly wage from a date on, so a pay rise never changes what earlier months were worth. */
export interface Wage { from: ISODate; hourly: number }

/** A shift she works often, one tap to fill in the times. */
export interface ShiftTemplate { id: string; name: string; start_time: string; end_time: string; break_minutes: number }

/** A job: an employer, or a department with its own pay setup. Each has its own wage, supplements and shift types. */
export interface Employer {
  id: string;
  name: string;
  color: string;
  wages: Wage[];
  templates: ShiftTemplate[];
  sort: number;
}

/** What she set up once and every calculation reads. */
export interface Setup { employers: Employer[]; supplements: Supplement[] }

export interface Settings {
  name: string;
  /** Monthly goal in kr before tax, or none. */
  goal: number | null;
  /** Tax deduction (skattetrekk) in percent, to show roughly what lands in the account. */
  tax_percent: number | null;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = { name: '', goal: null, tax_percent: null, onboarded: false };

export const DEFAULT_TEMPLATES: ShiftTemplate[] = [
  { id: 'dag', name: 'Dag', start_time: '07:30', end_time: '15:30', break_minutes: 0 },
  { id: 'kveld', name: 'Kveld', start_time: '15:00', end_time: '22:30', break_minutes: 0 },
  { id: 'natt', name: 'Natt', start_time: '22:00', end_time: '07:45', break_minutes: 0 },
];
