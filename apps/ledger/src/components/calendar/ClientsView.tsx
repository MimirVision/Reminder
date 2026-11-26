// Clients across the month: one row per client, one column per day, a dot in its type's colour for each task due.
// Shows at a glance who has what when, and where deadlines pile up on the same days. A dot opens that client's day.
import { Link } from '../../router';
import { useStore } from '../../data/store';
import { parts, weekday, type ISODate } from '../../lib/dates';
import { formatDayLong } from '../../lib/format';
import { typeColor } from '../../lib/insights';
import { isOpen, type Occurrence } from '../../lib/types';
import { cn } from '../../ui/cn';
import { Popover } from '../../ui/overlay';
import { EmptyState } from '../../ui/states';
import { Users } from 'lucide-react';
import { TaskChip } from './chips';

export function ClientsView({ days, today, byDay }: { days: ISODate[]; today: ISODate; byDay: Map<ISODate, Occurrence[]> }) {
  const { clientById } = useStore();
  // client → day → tasks
  const rows = new Map<string, Map<ISODate, Occurrence[]>>();
  for (const d of days) for (const t of byDay.get(d) ?? []) {
    const r = rows.get(t.clientId) ?? new Map<ISODate, Occurrence[]>();
    r.set(d, [...(r.get(d) ?? []), t]);
    rows.set(t.clientId, r);
  }
  const clients = [...rows.keys()].map((id) => clientById.get(id)).filter((c) => !!c).sort((a, b) => a!.name.localeCompare(b!.name, 'nb'));
  // How many clients have something due each day: the busy days stand out along the bottom.
  const perDay = days.map((d) => new Set((byDay.get(d) ?? []).filter((t) => isOpen(t.status)).map((t) => t.clientId)).size);
  const peak = Math.max(1, ...perDay);
  const cols = `minmax(150px,220px) repeat(${days.length}, minmax(26px, 1fr)) 48px`;

  if (!clients.length) return <div className="rounded-xl border border-line bg-surface py-10"><EmptyState icon={Users} title="Nothing this month" body="No client has a task due in this month." /></div>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div className="min-w-[880px]" role="table" aria-label="Tasks per client and day">
        <div role="row" className="sticky top-0 z-10 grid border-b border-line bg-surface" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader" className="px-3 py-1.5 text-[11.5px] font-medium text-ink-3">Client</span>
          {days.map((d) => (
            <span role="columnheader" key={d} aria-label={formatDayLong(d)}
              className={cn('flex flex-col items-center py-1 text-[10.5px] leading-tight', weekday(d) >= 6 ? 'bg-canvas/60 text-ink-3/70' : 'text-ink-3', d === today && 'bg-accent-soft font-semibold text-accent-ink')}>
              <span>{new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))}</span>
              <span className="num text-[11.5px]">{parts(d)[2]}</span>
            </span>
          ))}
          <span role="columnheader" className="py-1.5 pr-3 text-right text-[11.5px] font-medium text-ink-3">Open</span>
        </div>
        {clients.map((c) => {
          const r = rows.get(c!.id)!;
          const open = [...r.values()].flat().filter((t) => isOpen(t.status)).length;
          return (
            <div role="row" key={c!.id} className="group grid border-b border-line/70 last:border-b-0 hover:bg-hover/40" style={{ gridTemplateColumns: cols }}>
              <span role="rowheader" className="flex min-w-0 items-center px-3 py-1.5">
                <Link to={`/clients/${c!.id}`} className="truncate text-[13px] hover:text-accent hover:underline">{c!.name}</Link>
              </span>
              {days.map((d) => {
                const list = r.get(d) ?? [];
                const overdue = list.some((t) => isOpen(t.status) && t.dueDate < today);
                return (
                  <span role="cell" key={d} className={cn('flex items-center justify-center', weekday(d) >= 6 && 'bg-canvas/60', d === today && 'bg-accent-soft/50')}>
                    {list.length > 0 && (
                      <Popover trigger={
                        <button aria-label={`${c!.name}, ${formatDayLong(d)}: ${list.length} task${list.length === 1 ? '' : 's'}${overdue ? ', overdue' : ''}`}
                          className={cn('flex min-h-6 min-w-6 flex-wrap items-center justify-center gap-[2px] rounded-md p-0.5 hover:bg-surface hover:shadow-pop', overdue && 'ring-2 ring-danger/70')}>
                          {list.length <= 4 ? list.map((t) => (
                            <span key={t.id} className={cn('size-2 rounded-full', !isOpen(t.status) && 'opacity-35')} style={{ background: typeColor(t.taskType) }} />
                          )) : <span className="num text-[11px] font-semibold text-ink-2">{list.length}</span>}
                        </button>
                      }>
                        <div className="w-80 p-2">
                          <p className="mb-1.5 px-1 text-[12.5px] font-semibold">{c!.name} <span className="font-normal text-ink-3">· {formatDayLong(d)}</span></p>
                          <div className="flex flex-col gap-0.5">{list.map((t) => <TaskChip key={t.id} task={t} today={today} hideClient />)}</div>
                        </div>
                      </Popover>
                    )}
                  </span>
                );
              })}
              <span role="cell" className="num flex items-center justify-end pr-3 text-[12.5px] text-ink-2">{open || ''}</span>
            </div>
          );
        })}
        {/* Clients with something due, per day. */}
        <div role="row" className="grid border-t border-line bg-canvas/40" style={{ gridTemplateColumns: cols }}>
          <span role="rowheader" className="px-3 py-1.5 text-[11.5px] text-ink-3">Clients due</span>
          {perDay.map((n, i) => (
            <span role="cell" key={days[i]} className="flex items-end justify-center px-0.5 py-1" title={`${formatDayLong(days[i])}: ${n} client${n === 1 ? '' : 's'}`}>
              {n > 0 && <span className="w-full max-w-[14px] rounded-t-[3px] bg-accent/70" style={{ height: 4 + (n / peak) * 18 }} />}
            </span>
          ))}
          <span />
        </div>
      </div>
    </div>
  );
}
