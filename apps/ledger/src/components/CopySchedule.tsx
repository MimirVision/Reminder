// Copies a recurring schedule to other clients: the same work, rhythm, due-date rule, lead time and checklist, as a
// separate schedule for each. The copies are independent; changing one later changes only that one.
import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { useStore } from '../data/store';
import type { NewSchedule } from '../data/repo';
import { formatDate } from '../lib/format';
import { describeDueRule, describeRecurrence } from '../lib/recurrence';
import type { Schedule } from '../lib/types';
import { Button } from '../ui/button';
import { Dialog } from '../ui/overlay';
import { ClientsPicker } from './ClientsPicker';

/** The copy for one client: everything but the client, starting from today's period. */
export function copyOf(s: Schedule, clientId: string, today: string): NewSchedule {
  return {
    clientId, title: s.title, description: s.description, taskType: s.taskType, frequency: s.frequency, unit: s.unit, interval: s.interval,
    anchorMonth: s.anchorMonth, dueRule: s.dueRule,
    // From the current period on, like a new schedule: earlier periods are not created for the new client.
    startDate: today, endDate: s.endDate && s.endDate > today ? s.endDate : null, generateFrom: today,
    leadDays: s.leadDays, reminderDays: s.reminderDays, autoGenerate: s.autoGenerate, defaultPriority: s.defaultPriority,
    checklist: s.checklist.map((i) => ({ ...i, done: false })),
  };
}

export function CopyScheduleDialog({ schedule, open, onOpenChange, onDone }: {
  schedule: Schedule; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void;
}) {
  const { snap, today, run, clientById } = useStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Clients that already have a running schedule like this one: offered, but marked, so nothing is doubled by accident.
  const similar = useMemo(() => new Set(snap.schedules
    .filter((s) => s.id !== schedule.id && s.status !== 'ended' && s.title.trim().toLowerCase() === schedule.title.trim().toLowerCase()
      && s.unit === schedule.unit && s.interval === schedule.interval)
    .map((s) => s.clientId)), [snap.schedules, schedule]);
  const doubles = selected.filter((id) => similar.has(id)).length;

  const copy = async () => {
    if (!selected.length) return;
    setBusy(true);
    const n = await run(async (r) => {
      for (const clientId of selected) await r.createSchedule(copyOf(schedule, clientId, today));
      return selected.length;
    }, { generate: true, success: (k) => `“${schedule.title}” copied to ${k} client${k === 1 ? '' : 's'}. Tasks due soon were added.` });
    setBusy(false);
    if (n) { setSelected([]); onOpenChange(false); onDone?.(); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setSelected([]); onOpenChange(o); }} title="Copy to other clients" width="max-w-xl"
      description={<>Each client gets its own copy of “{schedule.title}”: {describeRecurrence(schedule).toLowerCase()}, {describeDueRule(schedule.dueRule).replace(/^./, (c) => c.toLowerCase())}.</>}
      footer={<>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!selected.length} onClick={() => void copy()}>
          <Copy /> {selected.length ? `Copy to ${selected.length} client${selected.length === 1 ? '' : 's'}` : 'Copy'}
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        {/* Picking a whole group leaves out the clients that already have this schedule; tick them by hand if wanted. */}
        <ClientsPicker selected={selected} onChange={setSelected} exclude={[schedule.clientId]}
          onGroup={(g) => setSelected((cur) => cur.filter((id) => !(similar.has(id) && g.ids.includes(id))))}
          hint={(id) => (similar.has(id) ? 'has one already' : null)} />
        <ul className="list-disc pl-5 text-[12.5px] text-ink-3">
          <li>Copied: the title, type, checklist, due-date rule, how early tasks are created, and priority{schedule.endDate && schedule.endDate > today ? `, and the end date (${formatDate(schedule.endDate)})` : ''}.</li>
          <li>Each copy starts from the current period: tasks for earlier periods aren’t created.</li>
          <li>The copies are separate schedules. Changing one later changes only that one; {clientById.get(schedule.clientId)?.name ?? 'this client'}’s stays as it is.</li>
        </ul>
        {doubles > 0 && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            {doubles} of the ticked clients already {doubles === 1 ? 'has' : 'have'} a “{schedule.title}” schedule with the same rhythm. They would get a second one.
          </p>
        )}
      </div>
    </Dialog>
  );
}
