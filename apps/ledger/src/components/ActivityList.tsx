import { CheckCircle2, CirclePlus, Clock, Edit3, Pause, Play, Repeat, ShieldCheck, Square, Trash2, Archive, RotateCcw, CalendarClock, Users } from 'lucide-react';
import { useStore } from '../data/store';
import { formatDate, formatTimestamp } from '../lib/format';
import { STATUS_LABEL } from '../lib/labels';
import { periodLabel } from '../lib/recurrence';
import type { Activity, TaskStatus } from '../lib/types';

function describe(a: Activity): { icon: typeof Clock; text: string } {
  const d = a.details as Record<string, string | string[] | undefined>;
  const title = (d.title as string) ?? (d.name as string) ?? '';
  switch (`${a.entity}:${a.action}`) {
    case 'occurrence:created': return { icon: CirclePlus, text: `Created “${title}”` };
    case 'occurrence:generated': return { icon: Repeat, text: `Created from schedule${d.period ? ` for ${periodLabel(d.period as string)}` : ''}: “${title}”` };
    case 'occurrence:status': return { icon: d.to === 'done' ? CheckCircle2 : Clock, text: `“${title}”: ${STATUS_LABEL[d.from as TaskStatus] ?? d.from} → ${STATUS_LABEL[d.to as TaskStatus] ?? d.to}` };
    case 'occurrence:rescheduled': return { icon: CalendarClock, text: `“${title}” moved from ${formatDate(d.from as string)} to ${formatDate(d.to as string)}` };
    case 'occurrence:edited': return { icon: Edit3, text: `“${title}”: changed ${(d.fields as string[] | undefined)?.join(', ') ?? 'details'}` };
    case 'occurrence:deleted': return { icon: Trash2, text: `Deleted “${title}”` };
    case 'schedule:created': return { icon: Repeat, text: `Schedule created: “${title}”` };
    case 'schedule:edited': return { icon: Edit3, text: `Schedule “${title}”: changed ${(d.fields as string[] | undefined)?.join(', ') ?? 'details'}` };
    case 'schedule:paused': return { icon: Pause, text: `Schedule “${title}” paused` };
    case 'schedule:resumed': return { icon: Play, text: `Schedule “${title}” resumed` };
    case 'schedule:ended': return { icon: Square, text: `Schedule “${title}” ended${d.end ? ` on ${formatDate(d.end as string)}` : ''}` };
    case 'schedule:deleted': return { icon: Trash2, text: `Schedule “${title}” deleted` };
    case 'client:created': return { icon: CirclePlus, text: `Client added: ${title}` };
    case 'client:edited': return { icon: Edit3, text: `Client details updated` };
    case 'client:archived': return { icon: Archive, text: `Client archived` };
    case 'client:reactivated': return { icon: RotateCcw, text: `Client reactivated` };
    case 'review:reviewed': return { icon: ShieldCheck, text: `Missing ${periodLabel(d.period as string)} marked as reviewed` };
    case 'review:exception': return { icon: ShieldCheck, text: `Exception for ${periodLabel(d.period as string)}: ${d.note}` };
    case 'review:review_cleared': return { icon: RotateCcw, text: `Review for ${periodLabel(d.period as string)} cleared` };
    case 'meeting:created': return { icon: Users, text: `Meeting booked: “${title}”, ${formatDate(d.date as string)}${d.start ? ` at ${d.start}` : ''}` };
    case 'meeting:rescheduled': return { icon: CalendarClock, text: `Meeting “${title}” moved to ${formatDate(d.to as string)}${d.start ? ` at ${d.start}` : ''}` };
    case 'meeting:deleted': return { icon: Trash2, text: `Meeting “${title}” on ${formatDate(d.date as string)} removed` };
    default: return { icon: Clock, text: `${a.entity} ${a.action}` };
  }
}

export function ActivityList({ items, empty, limit = 30 }: { items: Activity[]; empty: string; limit?: number }) {
  const { repo } = useStore();
  if (!items.length) return <p className="py-2 text-[12.5px] text-ink-3">{empty}</p>;
  return (
    <ol className="relative flex flex-col">
      {items.slice(0, limit).map((a) => {
        const { icon: Icon, text } = describe(a);
        return (
          <li key={a.id} className="flex gap-2.5 py-1.5">
            <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-2">{text}</div>
            <time className="tnum shrink-0 text-[11.5px] text-ink-3" dateTime={a.createdAt} title={a.actorId ? (repo.mode === 'demo' ? 'Demo' : 'You') : 'Automatic (nightly run)'}>
              {formatTimestamp(a.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
