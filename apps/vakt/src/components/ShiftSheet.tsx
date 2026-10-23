// Add or change a shift: pick a shift type (or type the times), the date, and see what it pays before saving.
import { useMemo, useState } from 'react';
import { Moon, Sun, Sunset, Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { addDays, monthOf, toMinutes, today, type ISODate } from '../lib/dates';
import { employerOf, payOf, shiftKind, summarize } from '../lib/pay';
import { hrs, kr, longDate } from '../lib/format';
import { eveName, holidayName } from '../lib/holidays';
import type { Shift } from '../lib/types';
import { Button, Chip, Label, Sheet, cn, confetti, inputClass } from './ui';
import { CalendarGrid, MonthNav } from './Calendar';

const BREAKS = [0, 15, 30, 45, 60];
const OVERTIME = [0, 50, 100];

export const KindIcon = ({ kind, className }: { kind: string; className?: string }) =>
  kind === 'Natt' ? <Moon className={className} /> : kind === 'Kveld' ? <Sunset className={className} /> : <Sun className={className} />;

const LAST_EMPLOYER = 'vakt-last-employer';
const lastEmployer = () => { try { return localStorage.getItem(LAST_EMPLOYER); } catch { return null; } };

/** `employerId` is the employer to start with for a new shift (the one she is looking at); else the last one used. */
export function ShiftSheet({ shift, defaultDate, employerId, onClose }: { shift?: Shift; defaultDate: string; employerId?: string | null; onClose: () => void }) {
  const { setup, employers, shifts, saveShift, deleteShift, toast } = useStore();
  const [s, setS] = useState<Shift>(() => {
    if (shift) return { ...shift, employer_id: employerOf(shift, employers)?.id ?? null };
    const emp = employers.find((e) => e.id === employerId) ?? employers.find((e) => e.id === lastEmployer()) ?? employers[0];
    const t = emp?.templates[0];
    return {
      id: newId(), employer_id: emp?.id ?? null, date: defaultDate, start_time: t?.start_time ?? '07:30', end_time: t?.end_time ?? '15:30',
      break_minutes: t?.break_minutes ?? 0, overtime_percent: 0, note: '',
    };
  });
  // A new shift can go on several days at once (her roster): the same times on every date she taps.
  const [dates, setDates] = useState<ISODate[]>([s.date]);
  const [calMonth, setCalMonth] = useState(monthOf(s.date));
  const employer = employerOf(s, employers);
  const templates = employer?.templates ?? [];
  const [more, setMore] = useState(Boolean(shift && (shift.overtime_percent || shift.note)));
  const set = (patch: Partial<Shift>) => setS((x) => ({ ...x, ...patch }));

  const all = useMemo(() => (shift ? [s] : [...dates].sort().map((date, i) => ({ ...s, id: i === 0 ? s.id : `${s.id}-${i}`, date }))), [s, dates, shift]);
  const valid = toMinutes(s.start_time) !== null && toMinutes(s.end_time) !== null && s.start_time !== s.end_time && all.length > 0;
  const pay = useMemo(() => valid ? payOf(all[0], setup) : null, [all, setup, valid]);
  const sum = useMemo(() => valid && all.length > 1 ? summarize(all, setup) : null, [all, setup, valid]);
  const noWage = !employer || employer.wages.length === 0;
  const special = holidayName(s.date) ?? eveName(s.date);
  const activeTemplate = templates.find((t) => t.start_time === s.start_time && t.end_time === s.end_time);

  const save = async (andNext: boolean) => {
    if (!valid || !pay) return;
    const list = all.map((x, i) => (i === 0 ? x : { ...x, id: newId() }));
    for (const x of list) if (!(await saveShift(x))) return;
    try { if (s.employer_id) localStorage.setItem(LAST_EMPLOYER, s.employer_id); } catch { /* only a convenience */ }
    if (!shift) confetti();
    navigator.vibrate?.(12); // a small tap on Android; iPhones ignore it
    const total = sum ? sum.total : pay.total;
    toast(shift ? 'Vakta er oppdatert' : list.length > 1 ? `${list.length} vakter lagt til · +${kr(total)} 🎉` : `+${kr(total)} lagt til 🎉`);
    if (andNext) {
      const next = addDays(list[list.length - 1].date, 1);
      setS({ ...s, id: newId(), date: next, note: '' });
      setDates([next]);
      setCalMonth(monthOf(next));
    } else onClose();
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
            {shift ? 'Lagre' : dates.length > 1 ? `Lagre ${dates.length} vakter` : 'Lagre vakt'}
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
        <Label hint={shift
          ? (special ? <span className="font-semibold text-rose">{special}</span> : longDate(s.date))
          : dates.length > 1 ? <span className="font-semibold text-accent-ink">{dates.length} dager valgt</span> : 'trykk flere dager for å legge inn flere'}>
          {shift ? 'Dato' : 'Dato(er)'}
        </Label>
        <div className="rounded-2xl bg-surface p-3 shadow-card" data-testid="date-picker">
          <MonthNav month={calMonth} setMonth={setCalMonth} withYear={calMonth.slice(0, 4) !== today().slice(0, 4)} />
          <CalendarGrid month={calMonth} renderDay={(d) => {
            const on = shift ? s.date === d : dates.includes(d);
            const has = shifts.some((x) => x.date === d && x.id !== shift?.id);
            const red = holidayName(d) !== null;
            return (
              <button type="button" aria-pressed={on} aria-label={longDate(d)}
                onClick={() => {
                  if (shift) set({ date: d });
                  else setDates(on ? dates.filter((x) => x !== d) : [...dates, d]);
                  if (!shift && !on) set({ date: d });
                }}
                className={cn('relative grid aspect-square w-full place-items-center rounded-xl text-[14.5px] font-semibold transition active:scale-90',
                  on ? 'hero text-white shadow-float' : d === today() ? 'text-accent-ink ring-2 ring-accent/40' : red ? 'text-rose' : 'text-ink')}>
                {Number(d.slice(8))}
                {has && <span className={cn('absolute bottom-1 size-1 rounded-full', on ? 'bg-white' : 'bg-ink-3')} />}
              </button>
            );
          }} />
        </div>
        {!shift && special && dates.length === 1 && <p className="mt-1.5 text-[13px] font-semibold text-rose">{special}</p>}
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
            <span className="text-[13px] font-medium text-white/80">{sum ? `${all.length} vakter gir til sammen` : 'Denne vakta gir'}</span>
            <span className="tabular text-[13px] text-white/80">{hrs(sum ? sum.hours : pay.paidHours)}</span>
          </div>
          <div className="tabular font-display text-[40px] leading-tight font-semibold" data-testid="shift-total">{kr(sum ? sum.total : pay.total)}</div>
          <div className="mt-3 space-y-1.5 text-[13.5px]">
            {sum ? (
              <>
                <Row label={`Timelønn (${kr(pay.wage)}/t)`} value={sum.base} />
                {sum.overtime > 0 && <Row label={`Overtid ${s.overtime_percent} %`} value={sum.overtime} />}
                {sum.bySupplement.map((x) => <Row key={x.id} label={`${x.name} · ${hrs(Math.round(x.hours * 100) / 100)}`} value={x.amount} dot={x.color} />)}
              </>
            ) : (
              <>
                <Row label={`Timelønn (${kr(pay.wage)}/t)`} value={pay.base} />
                {pay.overtime > 0 && <Row label={`Overtid ${s.overtime_percent} %`} value={pay.overtime} />}
                {pay.supplements.map((x) => <Row key={x.id} label={`${x.name} · ${hrs(Math.round(x.hours * 100) / 100)}`} value={x.amount} dot={x.color} />)}
              </>
            )}
          </div>
          {noWage && <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-[13px]">Legg inn timelønna for denne jobben under Oppsett, så blir tallet riktig.</p>}
        </div>
      )}
      {!valid && <p className="text-[14px] text-danger">{all.length === 0 ? 'Velg minst én dag i kalenderen.' : 'Fra og til kan ikke være samme klokkeslett.'}</p>}
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
