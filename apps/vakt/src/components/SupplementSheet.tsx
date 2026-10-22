// Add or change a supplement (tillegg): what it pays, on which days, between which times.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { COLORS, DAY_LABEL, describeWhen } from '../lib/presets';
import { WEEKDAYS, type AmountType, type DayKey, type Supplement } from '../lib/types';
import { Button, Chip, Label, NumberInput, Sheet, Switch, cn, inputClass } from './ui';

const TYPES: { key: AmountType; label: string; suffix: string }[] = [
  { key: 'kr_per_hour', label: 'kr per time', suffix: 'kr/t' },
  { key: 'percent', label: '% av timelønn', suffix: '%' },
  { key: 'kr_per_shift', label: 'kr per vakt', suffix: 'kr' },
];

export function SupplementSheet({ supplement, onClose }: { supplement?: Supplement; onClose: () => void }) {
  const { supplements, saveSupplement, deleteSupplement, toast } = useStore();
  const [s, setS] = useState<Supplement>(() => supplement ?? {
    id: newId(), name: '', color: COLORS[supplements.length % COLORS.length], amount_type: 'kr_per_hour', amount: 0, min_per_hour: null,
    days: [...WEEKDAYS], start_time: '17:00', end_time: '21:00', active: true, sort: supplements.length,
  });
  const set = (patch: Partial<Supplement>) => setS((x) => ({ ...x, ...patch }));
  const allDay = s.start_time === s.end_time;
  const toggleDay = (d: DayKey) => set({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] });
  const setWeekdays = (days: DayKey[]) => set({ days: [...days, ...s.days.filter((d) => d === 'holiday' || d === 'holiday_eve')] });
  const valid = s.name.trim().length > 0 && s.days.length > 0 && s.amount > 0;
  const suffix = TYPES.find((t) => t.key === s.amount_type)!.suffix;

  const save = async () => {
    if (!valid) return;
    if (await saveSupplement({ ...s, name: s.name.trim(), min_per_hour: s.amount_type === 'percent' ? s.min_per_hour : null })) {
      toast(supplement ? 'Tillegget er oppdatert' : 'Tillegget er lagt til ✨');
      onClose();
    }
  };
  const remove = async () => {
    if (!supplement) return;
    const copy = supplement;
    if (await deleteSupplement(supplement.id)) {
      toast(`${supplement.name} er slettet`, { undo: () => void saveSupplement(copy) });
      onClose();
    }
  };

  return (
    <Sheet title={supplement ? 'Endre tillegg' : 'Nytt tillegg'} onClose={onClose} footer={
      <div className="flex gap-2">
        {supplement && <Button variant="danger" aria-label="Slett tillegg" className="px-4" onClick={remove}><Trash2 className="size-5" /></Button>}
        <Button variant="primary" className="flex-1" disabled={!valid} onClick={() => void save()}>Lagre</Button>
      </div>
    }>
      <div className="mb-4">
        <Label>Navn</Label>
        <input className={inputClass} aria-label="Navn" placeholder="F.eks. Kveldstillegg" maxLength={60} value={s.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="mb-4">
        <Label>Farge</Label>
        <div className="flex gap-2.5">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Farge ${c}`} aria-pressed={s.color === c} onClick={() => set({ color: c })}
              className={cn('size-8 rounded-full transition', s.color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas' : '')} style={{ background: c }} />
          ))}
        </div>
      </div>

      <div className="mb-4">
        <Label>Hvordan det betales</Label>
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-sunken p-1">
          {TYPES.map((t) => (
            <button key={t.key} type="button" aria-pressed={s.amount_type === t.key} onClick={() => set({ amount_type: t.key })}
              className={cn('min-h-10 rounded-xl text-[13px] font-semibold transition', s.amount_type === t.key ? 'bg-surface text-ink shadow-card' : 'text-ink-3')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={cn('mb-4 grid gap-3', s.amount_type === 'percent' && 'grid-cols-2')}>
        <div>
          <Label>{s.amount_type === 'percent' ? 'Prosent' : 'Beløp'}</Label>
          <NumberInput ariaLabel="Beløp" value={s.amount || null} onChange={(n) => set({ amount: n ?? 0 })} suffix={suffix} placeholder="0" />
        </div>
        {s.amount_type === 'percent' && (
          <div>
            <Label hint="valgfritt">Minst per time</Label>
            <NumberInput ariaLabel="Minst per time" value={s.min_per_hour} onChange={(n) => set({ min_per_hour: n })} suffix="kr/t" placeholder="–" />
          </div>
        )}
      </div>

      <div className="mb-4">
        <Label>Dager</Label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => <Chip key={d} active={s.days.includes(d)} onClick={() => toggleDay(d)} className="min-w-12 px-3">{DAY_LABEL[d]}</Chip>)}
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Chip active={s.days.includes('holiday')} onClick={() => toggleDay('holiday')}>🔴 Helligdager</Chip>
          <Chip active={s.days.includes('holiday_eve')} onClick={() => toggleDay('holiday_eve')}>Dag før helligdag</Chip>
        </div>
        <div className="flex gap-3 text-[13px] font-semibold text-accent-ink">
          <button type="button" onClick={() => setWeekdays([...WEEKDAYS])}>Alle dager</button>
          <button type="button" onClick={() => setWeekdays(['mon', 'tue', 'wed', 'thu', 'fri'])}>Hverdager</button>
          <button type="button" onClick={() => setWeekdays(['sat', 'sun'])}>Helg</button>
          <button type="button" onClick={() => setWeekdays([])}>Ingen</button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3 shadow-card">
        <span className="text-[15px] font-medium">Hele døgnet</span>
        <Switch label="Hele døgnet" on={allDay} onChange={(v) => set(v ? { start_time: '00:00', end_time: '00:00' } : { start_time: '17:00', end_time: '21:00' })} />
      </div>
      {!allDay && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div><Label>Fra kl.</Label><input type="time" aria-label="Fra kl." className={inputClass} value={s.start_time} onChange={(e) => e.target.value && set({ start_time: e.target.value })} /></div>
          <div><Label hint={s.end_time <= s.start_time ? 'neste dag' : undefined}>Til kl.</Label><input type="time" aria-label="Til kl." className={inputClass} value={s.end_time} onChange={(e) => e.target.value && set({ end_time: e.target.value })} /></div>
        </div>
      )}

      <p className="mb-4 rounded-2xl bg-accent-soft px-4 py-3 text-[13.5px] text-accent-ink">
        {s.days.length ? describeWhen(s) : 'Velg minst én dag'}. Et tidsrom over midnatt hører til dagen det starter.
      </p>

      <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 shadow-card">
        <span className="text-[15px] font-medium">I bruk</span>
        <Switch label="I bruk" on={s.active} onChange={(v) => set({ active: v })} />
      </div>
    </Sheet>
  );
}
