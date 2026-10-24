// "Gjenta vakter": copy a week, or a rota of several weeks, forward. Shifts she already has are never doubled.
import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { addDays, isoWeek, weekday, type ISODate } from '../lib/dates';
import { kr, longDate } from '../lib/format';
import { repeatShifts, summarize } from '../lib/pay';
import { Button, Chip, Label, Sheet, confetti } from './ui';

const mondayOf = (d: ISODate) => addDays(d, 1 - weekday(d));

export function RepeatSheet({ from, onClose }: { from: ISODate; onClose: () => void }) {
  const { shifts, setup, saveShifts, toast } = useStore();
  const [start, setStart] = useState(mondayOf(from));
  const [weeks, setWeeks] = useState(1);
  const [times, setTimes] = useState(3);
  const end = addDays(start, weeks * 7 - 1);
  const source = useMemo(() => shifts.filter((s) => s.date >= start && s.date <= end), [shifts, start, end]);
  const plan = useMemo(() => repeatShifts(source, weeks * 7, times, shifts, newId), [source, weeks, times, shifts]);
  const sum = summarize(plan, setup);

  const save = async () => {
    if (!(await saveShifts(plan))) return;
    confetti();
    toast(`${plan.length} vakter lagt inn · +${kr(sum.total)} 🎉`);
    onClose();
  };

  return (
    <Sheet title="Gjenta vakter" onClose={onClose} footer={
      <Button variant="primary" className="w-full" disabled={plan.length === 0} onClick={() => void save()}>
        {plan.length ? `Legg inn ${plan.length} vakter` : 'Ingen vakter å legge inn'}
      </Button>
    }>
      <p className="mb-4 text-[14.5px] text-ink-2">Kopier vaktene i en uke – eller hele turnusen – fremover. Vakter du allerede har, blir ikke lagt inn to ganger.</p>

      <Label>Turnusen er</Label>
      <div className="mb-4 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 6].map((w) => <Chip key={w} active={weeks === w} onClick={() => setWeeks(w)}>{w === 1 ? '1 uke' : `${w} uker`}</Chip>)}
      </div>

      <Label hint={`${source.length} vakter`}>Kopier fra</Label>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="soft" className="min-h-10 px-3" aria-label="Uka før" onClick={() => setStart(addDays(start, -7))}>‹</Button>
        <div className="flex-1 rounded-2xl bg-surface px-4 py-2.5 text-center text-[14px] font-semibold shadow-card">
          Uke {isoWeek(start)}{weeks > 1 ? `–${isoWeek(end)}` : ''}
          <span className="block text-[12.5px] font-normal text-ink-3">{longDate(start)} – {longDate(end)}</span>
        </div>
        <Button variant="soft" className="min-h-10 px-3" aria-label="Uka etter" onClick={() => setStart(addDays(start, 7))}>›</Button>
      </div>

      <Label>Hvor mange ganger</Label>
      <div className="mb-5 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 6, 8].map((t) => <Chip key={t} active={times === t} onClick={() => setTimes(t)}>{t}×</Chip>)}
      </div>

      {plan.length > 0 && (
        <div className="hero rounded-3xl p-5 text-white">
          <p className="text-[13px] text-white/80">{plan.length} nye vakter, til og med {longDate(plan[plan.length - 1].date)}</p>
          <p className="tabular font-display text-[34px] font-semibold" data-testid="repeat-total">{kr(sum.total)}</p>
        </div>
      )}
      {source.length === 0 && <p className="text-[14px] text-ink-3">Ingen vakter i disse ukene. Bla til uka du vil kopiere.</p>}
    </Sheet>
  );
}
