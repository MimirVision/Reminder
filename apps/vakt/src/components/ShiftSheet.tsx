// Add or change a shift: pick a shift type (or type the times), the date, and see what it pays before saving.
import { useMemo, useState } from 'react';
import { Moon, Sun, Sunset, Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { addDays, monthOf, toMinutes, today, weekday, type ISODate } from '../lib/dates';
import { employerOf, payOf, shiftKind, summarize } from '../lib/pay';
import { hrs, kr, longDate } from '../lib/format';
import { eveName, holidayName } from '../lib/holidays';
import { DAY_OFF_LABEL, type DayOffKind, type Shift, type ShiftTemplate } from '../lib/types';
import { Button, Chip, Label, Sheet, Switch, cn, confetti, inputClass } from './ui';
import { CalendarGrid, MonthNav } from './Calendar';
import { templateOf, timesFor } from '../lib/templates';

const BREAKS = [0, 15, 30, 45, 60];
const OVERTIME = [0, 50, 100];

export const KindIcon = ({ kind, className }: { kind: string; className?: string }) =>
  kind === 'Natt' ? <Moon className={className} /> : kind === 'Kveld' ? <Sunset className={className} /> : <Sun className={className} />;

const LAST_EMPLOYER = 'vakt-last-employer';

/** The shift type she usually has on that weekday (most often in her shifts), else the first one. */
export function usualTemplate(templates: ShiftTemplate[], shifts: Shift[], date: ISODate): ShiftTemplate | undefined {
  const wd = weekday(date);
  let best: ShiftTemplate | undefined, most = 0;
  for (const t of templates) {
    const n = shifts.filter((s) => weekday(s.date) === wd && templateOf([t], s)).length;
    if (n > most) { most = n; best = t; }
  }
  return best ?? templates[0];
}
const lastEmployer = () => { try { return localStorage.getItem(LAST_EMPLOYER); } catch { return null; } };

/** `employerId` is the employer to start with for a new shift (the one she is looking at); else the last one used. */
export function ShiftSheet({ shift, defaultDate, employerId, onClose }: { shift?: Shift; defaultDate: string; employerId?: string | null; onClose: () => void }) {
  const { setup, employers, shifts, daysOff, saveShift, saveShifts, deleteShift, saveDayOff, toast } = useStore();
  // A new entry can be a shift or a day off (holiday, a day off, time off in lieu).
  const [mode, setMode] = useState<'shift' | 'off'>('shift');
  const [offKind, setOffKind] = useState<DayOffKind>('ferie');
  const [s, setS] = useState<Shift>(() => {
    if (shift) return { ...shift, employer_id: employerOf(shift, employers)?.id ?? null };
    const emp = employers.find((e) => e.id === employerId) ?? employers.find((e) => e.id === lastEmployer()) ?? employers[0];
    const t = usualTemplate(emp?.templates ?? [], shifts.filter((x) => employerOf(x, employers)?.id === emp?.id), defaultDate);
    const times = t ? timesFor(t, defaultDate) : { start_time: '07:30', end_time: '15:30', break_minutes: 0 };
    return { id: newId(), employer_id: emp?.id ?? null, date: defaultDate, ...times, overtime_percent: 0, note: '', status: 'worked' };
  });
  // A new shift can go on several days at once (her roster): the same times on every date she taps.
  const [dates, setDates] = useState<ISODate[]>([s.date]);
  const [calMonth, setCalMonth] = useState(monthOf(s.date));
  const employer = employerOf(s, employers);
  const templates = employer?.templates ?? [];
  // The chosen shift type. Each date then gets that type's times for its own day (a Friday night has Friday's times);
  // typing times by hand leaves the type and uses those times on every date.
  const [tplId, setTplId] = useState<string | null>(() => templateOf(templates, s)?.id ?? null);
  const tpl = templates.find((t) => t.id === tplId);
  const useTemplate = (t: ShiftTemplate | undefined, date = s.date) => { setTplId(t?.id ?? null); if (t) set(timesFor(t, date)); };
  const [more, setMore] = useState(Boolean(shift && (shift.overtime_percent || shift.note)));
  const set = (patch: Partial<Shift>) => setS((x) => ({ ...x, ...patch }));

  const all = useMemo(() => (shift ? [s] : [...dates].sort().map((date, i) => ({ ...s, ...(tpl ? timesFor(tpl, date) : {}), id: i === 0 ? s.id : `${s.id}-${i}`, date }))), [s, dates, shift, tpl]);
  const valid = toMinutes(s.start_time) !== null && toMinutes(s.end_time) !== null && s.start_time !== s.end_time && all.length > 0;
  const pay = useMemo(() => valid ? payOf(all[0], setup) : null, [all, setup, valid]);
  const sum = useMemo(() => valid && all.length > 1 ? summarize(all, setup) : null, [all, setup, valid]);
  const noWage = !employer || employer.wages.length === 0;
  const special = holidayName(s.date) ?? eveName(s.date);
  const activeTemplate = tpl;
  // When the dates chosen give the shift type different times (a Friday among weekdays), say so.
  const mixed = !shift && tpl && new Set(all.map((x) => `${x.start_time}-${x.end_time}`)).size > 1;

  const save = async (andNext: boolean) => {
    if (!valid || !pay) return;
    // A new shift on a day that already has the same one (same start, same employer) would be counted twice: skip it.
    const twin = (x: Shift) => shifts.some((y) => y.id !== x.id && y.date === x.date && y.start_time === x.start_time && employerOf(y, employers)?.id === x.employer_id);
    const fresh = all.map((x, i) => (i === 0 ? x : { ...x, id: newId() }));
    const list = shift ? fresh : fresh.filter((x) => !twin(x));
    const skipped = fresh.length - list.length;
    if (list.length === 0) { toast('Du har allerede denne vakta på den dagen.', { error: true }); return; }
    if (!(await saveShifts(list))) return;
    try { if (s.employer_id) localStorage.setItem(LAST_EMPLOYER, s.employer_id); } catch { /* only a convenience */ }
    if (!shift) confetti();
    navigator.vibrate?.(12); // a small tap on Android; iPhones ignore it
    const total = sum ? sum.total : pay.total;
    const extra = skipped ? ` (${skipped} fantes fra før)` : '';
    toast(shift ? 'Vakta er oppdatert' : list.length > 1 ? `${list.length} vakter lagt til${extra} 🎉` : `+${kr(skipped ? payOf(list[0], setup).total : total)} lagt til${extra} 🎉`);
    if (andNext) {
      const next = addDays(list[list.length - 1].date, 1);
      setS({ ...s, ...(tpl ? timesFor(tpl, next) : {}), id: newId(), date: next, note: '' });
      setDates([next]);
      setCalMonth(monthOf(next));
    } else onClose();
  };

  const saveOff = async () => {
    const list = [...dates].sort();
    for (const date of list) {
      const id = daysOff.find((x) => x.date === date)?.id ?? newId();
      if (!(await saveDayOff({ id, date, kind: offKind, note: s.note }))) return;
    }
    toast(`${list.length} ${list.length === 1 ? 'dag' : 'dager'} ${DAY_OFF_LABEL[offKind].toLowerCase()} lagt inn 🌴`);
    onClose();
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
      title={shift ? 'Endre vakt' : mode === 'off' ? 'Fri eller ferie' : 'Ny vakt'}
      onClose={onClose}
      footer={mode === 'off' ? (
        <Button variant="primary" disabled={dates.length === 0} onClick={() => void saveOff()} className="w-full">
          Lagre {dates.length > 1 ? `${dates.length} dager` : 'dagen'}
        </Button>
      ) : (
        <div className="flex gap-2">
          {shift
            ? <Button variant="danger" onClick={remove} aria-label="Slett vakt" className="px-4"><Trash2 className="size-5" /></Button>
            : <Button variant="soft" disabled={!valid} onClick={() => void save(true)} className="flex-1">Lagre + ny</Button>}
          <Button variant="primary" disabled={!valid} onClick={() => void save(false)} className="flex-[1.4]">
            {shift ? 'Lagre' : dates.length > 1 ? `Lagre ${dates.length} vakter` : 'Lagre vakt'}
          </Button>
        </div>
      )}
    >
      {!shift && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-sunken p-1" role="group" aria-label="Hva vil du legge inn">
          {(['shift', 'off'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={cn('min-h-10 rounded-xl text-[14px] font-semibold transition', mode === m ? 'bg-surface text-ink shadow-card' : 'text-ink-3')}>
              {m === 'shift' ? 'Vakt' : 'Fri / ferie'}
            </button>
          ))}
        </div>
      )}

      {mode === 'off' && (
        <div className="mb-5">
          <Label>Hva slags dag</Label>
          <div className="flex gap-2">
            {(Object.keys(DAY_OFF_LABEL) as DayOffKind[]).map((k) => <Chip key={k} active={offKind === k} onClick={() => setOffKind(k)}>{DAY_OFF_LABEL[k]}</Chip>)}
          </div>
        </div>
      )}

      {mode === 'shift' && employers.length > 1 && (
        <div className="mb-5">
          <Label>Hvor jobber du?</Label>
          <div className="flex flex-wrap gap-2">
            {employers.map((e) => (
              <button key={e.id} type="button" aria-pressed={employer?.id === e.id} onClick={() => { set({ employer_id: e.id }); useTemplate(usualTemplate(e.templates, shifts.filter((x) => employerOf(x, employers)?.id === e.id), s.date)); }}
                className={cn('flex min-h-11 items-center gap-2 rounded-2xl border-2 px-4 text-[14.5px] font-semibold transition active:scale-[0.97]',
                  employer?.id === e.id ? 'border-accent bg-accent-soft text-ink' : 'border-transparent bg-surface text-ink-2 shadow-card')}>
                <span className="size-3 rounded-full" style={{ background: e.color }} />{e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'shift' && templates.length > 0 && (
        <div className="mb-5">
          <Label>Vakttype</Label>
          <div className="grid grid-cols-3 gap-2">
            {templates.map((t) => {
              const on = activeTemplate?.id === t.id;
              return (
                <button key={t.id} type="button" aria-pressed={on}
                  onClick={() => useTemplate(t)}
                  className={cn('flex flex-col items-start rounded-2xl border-2 p-3 text-left transition active:scale-[0.97]',
                    on ? 'border-accent bg-accent-soft' : 'border-transparent bg-surface shadow-card')}>
                  <KindIcon kind={shiftKind(t)} className={cn('mb-1.5 size-5', on ? 'text-accent' : 'text-ink-3')} />
                  <span className="text-[15px] font-semibold">{t.name}</span>
                  <span className="tabular text-[12.5px] text-ink-3">{timesFor(t, s.date).start_time}–{timesFor(t, s.date).end_time}</span>
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
            const off = daysOff.some((x) => x.date === d);
            const red = holidayName(d) !== null;
            return (
              <button type="button" aria-pressed={on} aria-label={longDate(d)}
                onClick={() => {
                  if (shift) { set({ date: d }); if (tpl) set(timesFor(tpl, d)); }
                  else setDates(on ? dates.filter((x) => x !== d) : [...dates, d]);
                  if (!shift && !on) { set({ date: d }); if (tpl) set(timesFor(tpl, d)); }
                }}
                className={cn('relative grid aspect-square w-full place-items-center rounded-xl text-[14.5px] font-semibold transition active:scale-90',
                  on ? 'hero text-white shadow-float' : d === today() ? 'text-accent-ink ring-2 ring-accent/40' : red ? 'text-rose' : 'text-ink')}>
                {Number(d.slice(8))}
                {(has || off) && <span className={cn('absolute bottom-1 size-1 rounded-full', on ? 'bg-white' : off ? 'bg-teal-500' : 'bg-ink-3')} />}
              </button>
            );
          }} />
        </div>
        {!shift && special && dates.length === 1 && <p className="mt-1.5 text-[13px] font-semibold text-rose">{special}</p>}
      </div>

      {mode === 'off' ? (
        <div className="mb-4">
          <Label hint="valgfritt">Notat</Label>
          <input className={inputClass} aria-label="Notat" maxLength={200} value={s.note} onChange={(e) => set({ note: e.target.value })} placeholder="F.eks. sommerferie" />
        </div>
      ) : (
      <>
      {shift && (
        <div className="mb-4 flex items-center justify-between rounded-2xl bg-surface px-4 py-3 shadow-card">
          <span>
            <span className="block text-[15px] font-medium">Jeg var syk 🤒</span>
            <span className="block text-[12.5px] text-ink-3">Betales med sykelønn fra Oppsett ({setup.sickPercent ?? 100} %)</span>
          </span>
          <Switch label="Jeg var syk" on={s.status === 'sick'} onChange={(v) => set({ status: v ? 'sick' : 'worked' })} />
        </div>
      )}

      {mixed && tpl && (
        <p className="mb-3 rounded-2xl bg-accent-soft px-4 py-2.5 text-[13px] text-accent-ink">
          {tpl.name} har egne tider på noen av dagene du har valgt – hver dag får sine tider. Tidene under gjelder {longDate(s.date)}.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <Label>Fra</Label>
          <input type="time" aria-label="Fra" className={inputClass} value={s.start_time} onChange={(e) => { if (e.target.value) { setTplId(null); set({ start_time: e.target.value }); } }} />
        </div>
        <div>
          <Label hint={pay && toMinutes(s.end_time)! <= toMinutes(s.start_time)! ? 'neste dag' : undefined}>Til</Label>
          <input type="time" aria-label="Til" className={inputClass} value={s.end_time} onChange={(e) => { if (e.target.value) { setTplId(null); set({ end_time: e.target.value }); } }} />
        </div>
      </div>

      <div className="mb-4">
        <Label hint={pay ? `${hrs(pay.paidHours)} betalt` : undefined}>Ubetalt pause (min)</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {BREAKS.map((b) => <Chip key={b} className="px-0" active={s.break_minutes === b} onClick={() => { setTplId(null); set({ break_minutes: b }); }}>{b === 0 ? 'Ingen' : b}</Chip>)}
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
      </>
      )}
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
