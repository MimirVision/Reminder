// Add or change a shift: pick a shift type (or type the times), the date, and see what it pays before saving.
import { useMemo, useState } from 'react';
import { Moon, Sun, Sunset, Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { addDays, toMinutes } from '../lib/dates';
import { employerOf, payOf, shiftKind } from '../lib/pay';
import { hrs, kr, longDate } from '../lib/format';
import { eveName, holidayName } from '../lib/holidays';
import type { Shift } from '../lib/types';
import { Button, Chip, Label, Sheet, cn, confetti, inputClass } from './ui';

const BREAKS = [0, 15, 30, 45, 60];
const OVERTIME = [0, 50, 100];

export const KindIcon = ({ kind, className }: { kind: string; className?: string }) =>
  kind === 'Natt' ? <Moon className={className} /> : kind === 'Kveld' ? <Sunset className={className} /> : <Sun className={className} />;

const LAST_EMPLOYER = 'vakt-last-employer';
const lastEmployer = () => { try { return localStorage.getItem(LAST_EMPLOYER); } catch { return null; } };

/** `employerId` is the employer to start with for a new shift (the one she is looking at); else the last one used. */
export function ShiftSheet({ shift, defaultDate, employerId, onClose }: { shift?: Shift; defaultDate: string; employerId?: string | null; onClose: () => void }) {
  const { setup, employers, saveShift, deleteShift, toast } = useStore();
  const [s, setS] = useState<Shift>(() => {
    if (shift) return { ...shift, employer_id: employerOf(shift, employers)?.id ?? null };
    const emp = employers.find((e) => e.id === employerId) ?? employers.find((e) => e.id === lastEmployer()) ?? employers[0];
    const t = emp?.templates[0];
    return {
      id: newId(), employer_id: emp?.id ?? null, date: defaultDate, start_time: t?.start_time ?? '07:30', end_time: t?.end_time ?? '15:30',
      break_minutes: t?.break_minutes ?? 0, overtime_percent: 0, note: '',
    };
  });
  const employer = employerOf(s, employers);
  const templates = employer?.templates ?? [];
  const [more, setMore] = useState(Boolean(shift && (shift.overtime_percent || shift.note)));
  const set = (patch: Partial<Shift>) => setS((x) => ({ ...x, ...patch }));

  const valid = toMinutes(s.start_time) !== null && toMinutes(s.end_time) !== null && s.start_time !== s.end_time && /^\d{4}-\d{2}-\d{2}$/.test(s.date);
  const pay = useMemo(() => valid ? payOf(s, setup) : null, [s, setup, valid]);
  const noWage = !employer || employer.wages.length === 0;
  const special = holidayName(s.date) ?? eveName(s.date);
  const activeTemplate = templates.find((t) => t.start_time === s.start_time && t.end_time === s.end_time);

  const save = async (andNext: boolean) => {
    if (!valid || !pay) return;
    const ok = await saveShift(s);
    if (!ok) return;
    try { if (s.employer_id) localStorage.setItem(LAST_EMPLOYER, s.employer_id); } catch { /* only a convenience */ }
    if (!shift) confetti();
    toast(shift ? 'Vakta er oppdatert' : `+${kr(pay.total)} lagt til 🎉`);
    if (andNext) setS({ ...s, id: newId(), date: addDays(s.date, 1), note: '' });
    else onClose();
  };

  const remove = async () => {
    if (!shift) return;
    const copy = shift;
    if (await deleteShift(shift.id)) {
      toast('Vakta er slettet', { undo: () => void saveShift(copy).then(() => toast('Vakta er tilbake')) });
      onClose();
    }
  };

  return (
    <Sheet
      title={shift ? 'Endre vakt' : 'Ny vakt'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {shift
            ? <Button variant="danger" onClick={remove} aria-label="Slett vakt" className="px-4"><Trash2 className="size-5" /></Button>
            : <Button variant="soft" disabled={!valid} onClick={() => void save(true)} className="flex-1">Lagre + ny</Button>}
          <Button variant="primary" disabled={!valid} onClick={() => void save(false)} className="flex-[1.4]">
            {shift ? 'Lagre' : 'Lagre vakt'}
          </Button>
        </div>
      }
    >
      {employers.length > 1 && (
        <div className="mb-5">
          <Label>Hvor jobber du?</Label>
          <div className="flex flex-wrap gap-2">
            {employers.map((e) => (
              <button key={e.id} type="button" aria-pressed={employer?.id === e.id} onClick={() => set({ employer_id: e.id })}
                className={cn('flex min-h-11 items-center gap-2 rounded-2xl border-2 px-4 text-[14.5px] font-semibold transition active:scale-[0.97]',
                  employer?.id === e.id ? 'border-accent bg-accent-soft text-ink' : 'border-transparent bg-surface text-ink-2 shadow-card')}>
                <span className="size-3 rounded-full" style={{ background: e.color }} />{e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {templates.length > 0 && (
        <div className="mb-5">
          <Label>Vakttype</Label>
          <div className="grid grid-cols-3 gap-2">
            {templates.map((t) => {
              const on = activeTemplate?.id === t.id;
              return (
                <button key={t.id} type="button" aria-pressed={on}
                  onClick={() => set({ start_time: t.start_time, end_time: t.end_time, break_minutes: t.break_minutes })}
                  className={cn('flex flex-col items-start rounded-2xl border-2 p-3 text-left transition active:scale-[0.97]',
                    on ? 'border-accent bg-accent-soft' : 'border-transparent bg-surface shadow-card')}>
                  <KindIcon kind={shiftKind(t)} className={cn('mb-1.5 size-5', on ? 'text-accent' : 'text-ink-3')} />
                  <span className="text-[15px] font-semibold">{t.name}</span>
                  <span className="tabular text-[12.5px] text-ink-3">{t.start_time}–{t.end_time}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-4">
        <Label hint={special ? <span className="font-semibold text-rose">{special}</span> : longDate(s.date)}>Dato</Label>
        <input type="date" aria-label="Dato" className={inputClass} value={s.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <Label>Fra</Label>
          <input type="time" aria-label="Fra" className={inputClass} value={s.start_time} onChange={(e) => e.target.value && set({ start_time: e.target.value })} />
        </div>
        <div>
          <Label hint={pay && toMinutes(s.end_time)! <= toMinutes(s.start_time)! ? 'neste dag' : undefined}>Til</Label>
          <input type="time" aria-label="Til" className={inputClass} value={s.end_time} onChange={(e) => e.target.value && set({ end_time: e.target.value })} />
        </div>
      </div>

      <div className="mb-4">
        <Label hint={pay ? `${hrs(pay.paidHours)} betalt` : undefined}>Ubetalt pause (min)</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {BREAKS.map((b) => <Chip key={b} className="px-0" active={s.break_minutes === b} onClick={() => set({ break_minutes: b })}>{b === 0 ? 'Ingen' : b}</Chip>)}
        </div>
      </div>

      {more ? (
        <>
          <div className="mb-4">
            <Label>Overtid</Label>
            <div className="flex gap-2">
              {OVERTIME.map((o) => <Chip key={o} active={s.overtime_percent === o} onClick={() => set({ overtime_percent: o })}>{o === 0 ? 'Nei' : `${o} %`}</Chip>)}
            </div>
          </div>
          <div className="mb-4">
            <Label>Notat</Label>
            <input className={inputClass} placeholder="F.eks. ekstravakt, avdeling …" maxLength={500} value={s.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
        </>
      ) : (
        <button type="button" className="mb-4 text-[14px] font-semibold text-accent-ink" onClick={() => setMore(true)}>+ Overtid eller notat</button>
      )}

      {pay && (
        <div className="hero rounded-3xl p-5 text-white" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-white/80">Denne vakta gir</span>
            <span className="tabular text-[13px] text-white/80">{hrs(pay.paidHours)}</span>
          </div>
          <div className="tabular font-display text-[40px] leading-tight font-semibold" data-testid="shift-total">{kr(pay.total)}</div>
          <div className="mt-3 space-y-1.5 text-[13.5px]">
            <Row label={`Timelønn (${kr(pay.wage)}/t)`} value={pay.base} />
            {pay.overtime > 0 && <Row label={`Overtid ${s.overtime_percent} %`} value={pay.overtime} />}
            {pay.supplements.map((x) => <Row key={x.id} label={`${x.name} · ${hrs(Math.round(x.hours * 100) / 100)}`} value={x.amount} dot={x.color} />)}
          </div>
          {noWage && <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-[13px]">Legg inn timelønna for denne jobben under Oppsett, så blir tallet riktig.</p>}
        </div>
      )}
      {!valid && <p className="text-[14px] text-danger">Fra og til kan ikke være samme klokkeslett.</p>}
    </Sheet>
  );
}

function Row({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-white/90">{dot && <span className="size-2 rounded-full ring-2 ring-white/70" style={{ background: dot }} />}{label}</span>
      <span className="tabular font-semibold">{kr(value)}</span>
    </div>
  );
}
