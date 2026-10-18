import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, CircleDot, CircleSlash, Clock, Flag } from 'lucide-react';
import { diffDays, type ISODate } from '../lib/dates';
import { formatDue } from '../lib/format';
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_SHORT } from '../lib/labels';
import type { Priority, TaskStatus } from '../lib/types';
import { cn } from './cn';
import { Menu, MenuItem } from './overlay';

export const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  todo: Circle, in_progress: CircleDot, waiting: Clock, done: CheckCircle2, cancelled: CircleSlash,
};
const STATUS_TONE: Record<TaskStatus, string> = {
  todo: 'text-ink-2', in_progress: 'text-info', waiting: 'text-warn', done: 'text-ok', cancelled: 'text-ink-3',
};
const STATUS_BG: Record<TaskStatus, string> = {
  todo: 'bg-sunken', in_progress: 'bg-info-soft', waiting: 'bg-warn-soft', done: 'bg-ok-soft', cancelled: 'bg-sunken',
};

export function StatusBadge({ status, short }: { status: TaskStatus; short?: boolean }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-[12px] font-medium whitespace-nowrap', STATUS_BG[status], STATUS_TONE[status])}>
      <Icon className="size-3.5" strokeWidth={2.2} />
      {short ? STATUS_SHORT[status] : STATUS_LABEL[status]}
    </span>
  );
}

/** The status badge as a button that opens a menu to change it. */
export function StatusPicker({ status, onChange, short = true }: { status: TaskStatus; onChange: (s: TaskStatus) => void; short?: boolean }) {
  return (
    <Menu label={`Status: ${STATUS_LABEL[status]}. Change status`} trigger={
      <button className="rounded-full transition-shadow hover:ring-2 hover:ring-line-strong" onClick={(e) => e.stopPropagation()}>
        <StatusBadge status={status} short={short} />
      </button>
    }>
      {(['todo', 'in_progress', 'waiting', 'done', 'cancelled'] as TaskStatus[]).map((s) => {
        const Icon = STATUS_ICON[s];
        return (
          <MenuItem key={s} onSelect={() => s !== status && onChange(s)}>
            <Icon className={cn(STATUS_TONE[s], '!text-current')} />
            <span className={s === status ? 'font-medium' : ''}>{STATUS_LABEL[s]}</span>
          </MenuItem>
        );
      })}
    </Menu>
  );
}

export function PriorityLabel({ priority, compact }: { priority: Priority; compact?: boolean }) {
  if (priority === 'normal' && compact) return <span className="sr-only">Normal priority</span>;
  if (priority === 'normal' || priority === 'low') {
    return <span className="text-[12.5px] text-ink-3">{PRIORITY_LABEL[priority]}</span>;
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12.5px] font-medium', priority === 'urgent' ? 'text-danger' : 'text-warn')}>
      <Flag className="size-3.5" fill="currentColor" strokeWidth={2} />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/** A due date with its urgency spelled out, so colour is never the only signal. */
export function DueDate({ date, today, open }: { date: ISODate; today: ISODate; open: boolean }) {
  const n = diffDays(date, today);
  const overdue = open && n < 0;
  return (
    <span className={cn('num inline-flex items-center gap-1 text-[12.5px] whitespace-nowrap',
      overdue ? 'font-medium text-danger' : open && n === 0 ? 'font-medium text-accent-ink' : open ? 'text-ink-2' : 'text-ink-3')}>
      {overdue && <AlertTriangle className="size-3.5" aria-label="Overdue" />}
      {formatDue(date, today)}
      {overdue && n < -1 && <span className="font-normal text-danger/70">· {-n}d</span>}
    </span>
  );
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger' | 'warn' | 'ok' | 'info'; className?: string }) {
  const tones = {
    neutral: 'bg-sunken text-ink-2', accent: 'bg-accent-soft text-accent-ink', danger: 'bg-danger-soft text-danger',
    warn: 'bg-warn-soft text-warn', ok: 'bg-ok-soft text-ok', info: 'bg-info-soft text-info',
  };
  return <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap [&_svg]:size-3', tones[tone], className)}>{children}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-[18px] items-center rounded border border-line px-1.5 text-[11px] text-ink-3">{children}</span>;
}
