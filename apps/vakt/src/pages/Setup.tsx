// Oppsett: everything the calculations need, entered once. Each employer (or department) has its own hourly wage,
// supplements and shift types; a setup can be copied to another employer. Below: goal, tax and the account.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, LogOut, Monitor, Moon, Plus, Share, Sparkles, Sun, Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { supabase } from '../data/config';
import { newId } from '../data/repo';
import { addDays, today, weekday, type ISODate } from '../lib/dates';
import { kr } from '../lib/format';
import { isHoliday, isHolidayEve } from '../lib/holidays';
import { calcShift, copySetup, shiftKind, wageOn } from '../lib/pay';
import { EMPLOYER_COLORS, PRESETS, describeAmount, describeWhen, fromPreset } from '../lib/presets';
import { DEFAULT_TEMPLATES, type Employer, type Settings, type ShiftTemplate, type Supplement } from '../lib/types';
import { SupplementSheet } from '../components/SupplementSheet';
import { TOUR_EVENT } from '../components/Tour';
import { Notifications } from '../components/Notifications';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { saveFile, shiftsCsv } from '../lib/export';
import { KindIcon } from '../components/ShiftSheet';
import { Button, Card, Chip, Label, NumberInput, Sheet, Switch, cn, inputClass } from '../components/ui';

/** Changes are kept in a draft and saved a moment after she stops typing, so every keystroke isn't a request. */
function useDraft<T>(value: T, save: (v: T) => void): [T, (f: (v: T) => T) => void, () => void] {
  const [draft, setDraft] = useState(value);
  const pending = useRef<T | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (pending.current === null) return;
    const t = window.setTimeout(() => { if (pending.current !== null) { saveRef.current(pending.current); pending.current = null; } }, 600);
    return () => window.clearTimeout(t);
  }, [draft]);
  // Leaving the screen saves what is waiting.
  useEffect(() => () => { if (pending.current !== null) saveRef.current(pending.current); }, []);
  return [draft, (f) => setDraft((d) => { const n = f(d); pending.current = n; return n; }), () => { pending.current = null; }];
}

/** What is still missing before an employer's numbers can be right. */
function missing(e: Employer, supplements: Supplement[]): string[] {
  const out: string[] = [];
  if (!e.wages.some((w) => w.hourly > 0)) out.push('timelønn');
  if (!supplements.some((s) => s.employer_id === e.id)) out.push('tillegg');
  if (!e.templates.length) out.push('vakttyper');
  return out;
}

export function Setup() {
  const { employers, supplements, shifts } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const employer = employers.find((e) => e.id === open);

  if (employer) return <EmployerView employer={employer} onBack={() => { setOpen(null); window.scrollTo({ top: 0 }); }} />;

  return (
    <div className="space-y-6">
      <p className="px-1 text-[14.5px] leading-relaxed text-ink-2">
        Legg inn lønn og tillegg én gang, så regnes hver vakt ut automatisk etterpå.
      </p>

      <Section title={employers.length > 1 ? 'Arbeidsgivere' : 'Arbeidsgiver'} hint="Jobber du flere steder eller på flere avdelinger, legg inn hver for seg – med egen timelønn og egne tillegg.">
        <div className="space-y-2.5">
          {employers.map((e) => {
            const gaps = missing(e, supplements);
            const sups = supplements.filter((s) => s.employer_id === e.id && s.active).length;
            const count = shifts.filter((s) => s.employer_id === e.id).length;
            return (
              <button key={e.id} onClick={() => { setOpen(e.id); window.scrollTo({ top: 0 }); }} className="flex w-full items-center gap-3.5 overflow-hidden rounded-3xl bg-surface p-4 text-left shadow-card transition active:scale-[0.99]">
                <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ background: e.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16.5px] font-bold">{e.name}</span>
                  <span className="block truncate text-[13px] text-ink-3">
                    {kr(wageOn(e.wages, today()))}/t · {sups} tillegg · {e.templates.length} vakttyper{count ? ` · ${count} vakter` : ''}
                  </span>
                  {gaps.length
                    ? <span className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-danger"><AlertCircle className="size-3.5" />Mangler {gaps.join(' og ')}</span>
                    : <span className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-ok"><CheckCircle2 className="size-3.5" />Klar</span>}
                </span>
                <ChevronRight className="size-5 text-ink-3" />
              </button>
            );
          })}
          <Button variant="soft" className="w-full" onClick={() => setAdding(true)}><Plus className="size-5" /> Legg til arbeidsgiver / avdeling</Button>
        </div>
      </Section>

      <General />

      {adding && <AddEmployerSheet onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); setOpen(id); window.scrollTo({ top: 0 }); }} />}
    </div>
  );
}

function General() {
  const store = useStore();
  const { email, local } = store;
  // Only this form's fields go on top of the newest settings, so a flag saved elsewhere (the walkthrough) isn't undone.
  const [draft, set] = useDraft<Settings>(store.settings, (s) => void store.saveSettings({
    ...store.settings, name: s.name, goal: s.goal, tax_percent: s.tax_percent, holiday_pay_percent: s.holiday_pay_percent, sick_percent: s.sick_percent,
  }));
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches;
  return (
    <>
      <Section title="Mål, skatt og feriepenger" hint={store.employers.length > 1 ? 'Gjelder alle jobbene samlet.' : undefined}>
        <Card className="space-y-4">
          <div>
            <Label hint="før skatt">Månedsmål</Label>
            <NumberInput ariaLabel="Månedsmål" value={draft.goal} onChange={(n) => set((d) => ({ ...d, goal: n && n > 0 ? n : null }))} suffix="kr" placeholder="F.eks. 35 000" />
          </div>
          <div>
            <Label hint="står på skattekortet">Skattetrekk</Label>
            <NumberInput ariaLabel="Skattetrekk" value={draft.tax_percent} onChange={(n) => set((d) => ({ ...d, tax_percent: n && n > 0 && n < 100 ? n : null }))} suffix="%" placeholder="F.eks. 30" />
          </div>
          <div>
            <Label hint="av fjorårets lønn, utbetales i juni">Feriepenger</Label>
            <div className="flex gap-2">
              {[10.2, 12, 14.3].map((p) => (
                <Chip key={p} active={draft.holiday_pay_percent === p} onClick={() => set((d) => ({ ...d, holiday_pay_percent: p }))}>{p.toLocaleString('nb-NO')} %</Chip>
              ))}
            </div>
          </div>
          <div>
            <Label hint="av vanlig lønn når du er syk">Sykelønn</Label>
            <NumberInput ariaLabel="Sykelønn" value={draft.sick_percent} onChange={(n) => set((d) => ({ ...d, sick_percent: n !== null && n >= 0 && n <= 100 ? n : d.sick_percent }))} suffix="%" />
          </div>
          <div>
            <Label>Navnet ditt</Label>
            <input className={inputClass} aria-label="Navnet ditt" value={draft.name} maxLength={40} onChange={(e) => { const v = e.target.value; set((d) => ({ ...d, name: v })); }} />
          </div>
        </Card>
      </Section>

      {!standalone && (
        <Section title="Legg appen på Hjem-skjermen">
          <Card className="text-[14.5px] leading-relaxed text-ink-2">
            {isIos
              ? <>Trykk på <Share className="inline size-4 align-[-2px]" /> <strong>Del</strong> nederst i Safari, og velg <strong>Legg til på Hjem-skjerm</strong>. Da åpner Vakt seg som en egen app.</>
              : <>Åpne nettlesermenyen og velg <strong>Installer app</strong> eller <strong>Legg til på startskjermen</strong>.</>}
          </Card>
        </Section>
      )}

      <Section title="Utseende">
        <Card><ThemePicker /></Card>
      </Section>

      <Notifications />

      <Section title="Dine data" hint="Alle vaktene som regneark (åpnes i Excel og Numbers) – til å sjekke lønnsslippen eller sende videre.">
        <Button variant="soft" className="w-full" disabled={!store.shifts.length} onClick={() => void saveFile(`vakter-${today()}.csv`, shiftsCsv(store.shifts, store.setup))}>
          <Download className="size-5" /> Last ned vaktene ({store.shifts.length})
        </Button>
      </Section>

      <Section title="Hjelp">
        <Button variant="soft" className="w-full" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}><Sparkles className="size-5" /> Vis gjennomgangen igjen</Button>
      </Section>

      <Section title="Konto">
        <Card className="space-y-3">
          {local
            ? <p className="text-[14px] text-ink-2">Prøvemodus: dataene ligger bare i denne nettleseren.</p>
            : <p className="text-[14px] text-ink-2">Logget inn som <strong>{email}</strong>. Alt lagres trygt i skyen.</p>}
          {!local && <Button variant="soft" className="w-full" onClick={() => void supabase().auth.signOut().then(() => location.reload())}><LogOut className="size-5" /> Logg ut</Button>}
        </Card>
      </Section>
      <p className="pb-4 text-center text-[12px] text-ink-3">Vakt regner ut brutto lønn fra det du legger inn. Sjekk gjerne mot lønnsslippen.<br />Versjon {__BUILD__}</p>
    </>
  );
}

function EmployerView({ employer, onBack }: { employer: Employer; onBack: () => void }) {
  const store = useStore();
  const { employers, supplements, saveSupplement, deleteEmployer } = store;
  const [e, set, discard] = useDraft<Employer>(employer, (x) => void store.saveEmployer(x));
  const [name, setName] = useState(employer.name);
  const [editing, setEditing] = useState<Supplement | 'new' | null>(null);
  const [template, setTemplate] = useState<ShiftTemplate | 'new' | null>(null);
  const [copying, setCopying] = useState(false);
  const mine = supplements.filter((s) => s.employer_id === e.id);
  const presets = PRESETS.filter((p) => !mine.some((s) => s.name.toLowerCase() === p.name.toLowerCase()));
  const wages = [...e.wages].sort((a, b) => b.from.localeCompare(a.from));
  const gaps = missing(e, supplements);

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="-ml-1 flex items-center gap-1 text-[15px] font-semibold text-accent-ink"><ChevronLeft className="size-5" /> Alle arbeidsgivere</button>

      <Card className="space-y-4">
        <div>
          <Label>Navn på arbeidsgiver / avdeling</Label>
          <input className={inputClass} aria-label="Navn på arbeidsgiver" maxLength={60} value={name}
            onChange={(ev) => { const v = ev.target.value; setName(v); if (v.trim()) set((x) => ({ ...x, name: v.trim() })); }}
            onBlur={() => setName(e.name)} />
        </div>
        <div>
          <Label>Farge</Label>
          <div className="flex gap-2.5">
            {EMPLOYER_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Farge ${c}`} aria-pressed={e.color === c} onClick={() => set((x) => ({ ...x, color: c }))}
                className={cn('size-8 rounded-full', e.color === c && 'ring-2 ring-ink ring-offset-2 ring-offset-surface')} style={{ background: c }} />
            ))}
          </div>
        </div>
      </Card>

      {gaps.length > 0 && (
        <div className="flex items-start gap-3 rounded-3xl bg-accent-soft p-4 text-[14.5px] text-accent-ink">
          <span className="text-[22px] leading-none">👇</span>
          <span>Fyll inn {gaps.join(', ')} under, så er {e.name} klar.</span>
        </div>
      )}

      <Section step={1} title="Timelønn" hint="Ved lønnsøkning legger du til en ny fra datoen den gjelder – tidligere vakter beholder den gamle.">
        <Card className="space-y-3">
          {wages.length === 0 && <p className="text-[14px] text-ink-3">Ingen timelønn lagt inn ennå.</p>}
          {wages.map((w) => {
            const i = e.wages.indexOf(w);
            const update = (patch: Partial<typeof w>) => set((x) => ({ ...x, wages: x.wages.map((y, j) => j === i ? { ...y, ...patch } : y) }));
            return (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label>Kroner per time</Label>
                  <NumberInput ariaLabel="Timelønn" value={w.hourly || null} onChange={(n) => update({ hourly: n ?? 0 })} suffix="kr/t" />
                </div>
                <div className="flex-1">
                  <Label>Gjelder fra</Label>
                  {/* The oldest wage covers every shift before the next one, so its date doesn't matter. */}
                  {w === wages[wages.length - 1]
                    ? <div className={cn(inputClass, 'text-ink-3')}>Start</div>
                    : <input type="date" aria-label="Gjelder fra" className={inputClass} value={w.from} onChange={(ev) => ev.target.value && update({ from: ev.target.value })} />}
                </div>
                {e.wages.length > 1 && (
                  <button aria-label="Fjern timelønn" className="mb-1 grid size-11 place-items-center rounded-full text-ink-3" onClick={() => set((x) => ({ ...x, wages: x.wages.filter((_, j) => j !== i) }))}><Trash2 className="size-4.5" /></button>
                )}
              </div>
            );
          })}
          <button className="flex items-center gap-1.5 text-[14px] font-semibold text-accent-ink"
            onClick={() => set((x) => ({ ...x, wages: [...x.wages, { from: x.wages.length ? today() : '2000-01-01', hourly: wages[0]?.hourly ?? 0 }] }))}>
            <Plus className="size-4" /> {e.wages.length ? 'Ny timelønn (lønnsøkning)' : 'Legg inn timelønn'}
          </button>
        </Card>
      </Section>

      <Section step={2} title="Tillegg" hint="Regnes automatisk på hver vakt ut fra dag og klokkeslett.">
        <div className="space-y-2">
          {mine.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-card">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setEditing(s)}>
                <span className="size-3.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{s.name} <span className="font-medium text-ink-3">· {describeAmount(s)}</span></span>
                  <span className="block truncate text-[13px] text-ink-3">{describeWhen(s)}</span>
                </span>
              </button>
              <Switch label={`${s.name} i bruk`} on={s.active} onChange={(v) => void saveSupplement({ ...s, active: v })} />
            </div>
          ))}
          <Button variant="soft" className="w-full" onClick={() => setEditing('new')}><Plus className="size-5" /> Legg til tillegg</Button>
          {presets.length > 0 && (
            <div className="pt-1">
              <p className="mb-2 text-[13px] text-ink-3">Vanlige tillegg (sjekk beløpet mot lønnsslippen):</p>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => <Chip key={p.name} onClick={() => setEditing(fromPreset(p, e.id, newId(), mine.length))}>+ {p.name}</Chip>)}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section step={3} title="Vakttyper" hint="Snarveier når du legger inn en vakt.">
        <div className="space-y-2">
          {e.templates.map((t) => (
            <button key={t.id} onClick={() => setTemplate(t)} className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left shadow-card">
              <KindIcon kind={shiftKind(t)} className="size-5 text-ink-3" />
              <span className="flex-1 text-[15px] font-semibold">{t.name}</span>
              <span className="tabular text-[14px] text-ink-3">{t.start_time}–{t.end_time}{t.break_minutes ? ` · ${t.break_minutes} min pause` : ''}</span>
              <ChevronRight className="size-4 text-ink-3" />
            </button>
          ))}
          {e.templates.length < 6 && <Button variant="soft" className="w-full" onClick={() => setTemplate('new')}><Plus className="size-5" /> Ny vakttype</Button>}
        </div>
      </Section>

      <Section step={4} title="Utbetaling" hint="Når lønna kommer på konto. Brukes i «Lønn på konto» på Oversikt.">
        <Card className="space-y-4">
          <div>
            <Label>Lønningsdag</Label>
            <NumberInput ariaLabel="Lønningsdag" value={e.pay_day} onChange={(n) => n && n >= 1 && n <= 31 && set((x) => ({ ...x, pay_day: Math.round(n) }))} suffix=". i måneden" />
          </div>
          <div className="space-y-2">
            <Label>Hva utbetales når</Label>
            {([
              ['supplements', 'Tillegg måneden etter', 'Timelønn for måneden du jobber, tillegg og overtid måneden etter. Vanligst i helse.'],
              ['none', 'Alt samme måned', 'Alt for måneden du jobber utbetales samme måned.'],
              ['all', 'Alt måneden etter', 'Alt du jobber i en måned utbetales måneden etter.'],
            ] as const).map(([k, title, text]) => (
              <Option key={k} on={e.pay_delay === k} onClick={() => set((x) => ({ ...x, pay_delay: k }))} title={title} text={text} />
            ))}
          </div>
        </Card>
      </Section>

      <Preview employer={e} supplements={mine} />

      <div className="space-y-2">
        {employers.length > 1 && <Button variant="soft" className="w-full" onClick={() => setCopying(true)}><Copy className="size-5" /> Kopier oppsettet til …</Button>}
        {employers.length > 1 && (
          <Button variant="ghost" className="w-full text-danger" onClick={() => {
            if (!confirm(`Slette ${e.name} med tilleggene sine?`)) return;
            discard();
            void deleteEmployer(e.id).then((ok) => ok && onBack());
          }}><Trash2 className="size-5" /> Slett {e.name}</Button>
        )}
      </div>

      {editing && <SupplementSheet supplement={editing === 'new' ? undefined : editing} employerId={e.id} onClose={() => setEditing(null)} />}
      {template && (
        <TemplateSheet
          template={template === 'new' ? undefined : template}
          onSave={(t) => set((x) => ({ ...x, templates: x.templates.some((y) => y.id === t.id) ? x.templates.map((y) => y.id === t.id ? t : y) : [...x.templates, t] }))}
          onDelete={(id) => set((x) => ({ ...x, templates: x.templates.filter((y) => y.id !== id) }))}
          onClose={() => setTemplate(null)}
        />
      )}
      {copying && <CopySheet source={e} onClose={() => setCopying(false)} />}
    </div>
  );
}

/** What each shift type pays on a normal weekday, a Saturday and a Sunday: a quick check that the setup is right. */
function Preview({ employer, supplements }: { employer: Employer; supplements: Supplement[] }) {
  const days = useMemo(() => {
    const plain = (d: ISODate) => !isHoliday(d) && !isHolidayEve(d);
    const find = (wd: number) => { let d = addDays(today(), 1); while (weekday(d) !== wd || !plain(d)) d = addDays(d, 1); return d; };
    return [{ label: 'Hverdag', date: find(3) }, { label: 'Lørdag', date: find(6) }, { label: 'Søndag', date: find(7) }];
  }, []);
  if (!employer.templates.length || !employer.wages.length) return null;
  return (
    <Section title="Slik blir det regnet ut" hint="Hva hver vakttype gir, med tilleggene over. Ser det riktig ut?">
      <Card className="p-4">
        <div className="grid grid-cols-[1fr_repeat(3,minmax(0,1fr))] gap-y-2.5 text-[14px]">
          <span />
          {days.map((d) => <span key={d.label} className="text-right text-[12px] font-semibold text-ink-3">{d.label}</span>)}
          {employer.templates.map((t) => (
            <div key={t.id} className="contents">
              <span className="truncate font-semibold">{t.name}</span>
              {days.map((d) => {
                const pay = calcShift({ id: '', employer_id: employer.id, date: d.date, start_time: t.start_time, end_time: t.end_time, break_minutes: t.break_minutes, overtime_percent: 0, note: '', status: 'worked' }, supplements, employer.wages);
                return <span key={d.label} className="tabular text-right font-semibold">{kr(pay.total)}</span>;
              })}
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

function AddEmployerSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { employers, supplements, replaceSetup, toast } = useStore();
  const [name, setName] = useState('');
  const [start, setStart] = useState<string>(employers[0]?.id ?? 'presets');
  const color = EMPLOYER_COLORS.find((c) => !employers.some((e) => e.color === c)) ?? EMPLOYER_COLORS[employers.length % EMPLOYER_COLORS.length];

  const create = async () => {
    const blank: Employer = { id: newId(), name: name.trim(), color, wages: [], templates: DEFAULT_TEMPLATES.map((t) => ({ ...t, id: newId() })), sort: employers.length, pay_day: employers[0]?.pay_day ?? 12, pay_delay: employers[0]?.pay_delay ?? 'supplements' };
    const source = employers.find((e) => e.id === start);
    const { employer, supplements: sups } = source
      ? copySetup(source, supplements, blank, newId)
      : { employer: blank, supplements: start === 'presets' ? PRESETS.slice(0, 4).map((p, i) => fromPreset(p, blank.id, newId(), i)) : [] };
    if (await replaceSetup(employer, sups)) {
      toast(source ? `${employer.name} er lagt til med samme oppsett som ${source.name}` : `${employer.name} er lagt til`);
      onCreated(employer.id);
    }
  };

  return (
    <Sheet title="Ny arbeidsgiver / avdeling" onClose={onClose} footer={
      <Button variant="primary" className="w-full" disabled={!name.trim()} onClick={() => void create()}>Legg til</Button>
    }>
      <div className="mb-5">
        <Label>Navn</Label>
        <input className={inputClass} aria-label="Navn" autoFocus maxLength={60} placeholder="F.eks. Avdeling 3, Sykehjemmet" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Label>Start med</Label>
      <div className="space-y-2">
        {employers.map((e) => (
          <Option key={e.id} on={start === e.id} onClick={() => setStart(e.id)} title={`Samme oppsett som ${e.name}`} text="Kopierer timelønn, tillegg og vakttyper. Du kan endre det etterpå." />
        ))}
        <Option on={start === 'presets'} onClick={() => setStart('presets')} title="Vanlige tillegg" text="Kveld, natt, helg og helligdag med eksempelbeløp." />
        <Option on={start === 'empty'} onClick={() => setStart('empty')} title="Tomt" text="Legg inn alt selv." />
      </div>
    </Sheet>
  );
}

function CopySheet({ source, onClose }: { source: Employer; onClose: () => void }) {
  const { employers, supplements, replaceSetup, toast } = useStore();
  const others = employers.filter((e) => e.id !== source.id);
  const [picked, setPicked] = useState<string[]>(others.length === 1 ? [others[0].id] : []);
  const copy = async () => {
    for (const id of picked) {
      const target = employers.find((e) => e.id === id)!;
      const out = copySetup(source, supplements, target, newId);
      if (!(await replaceSetup(out.employer, out.supplements))) return;
    }
    toast(`Oppsettet er kopiert til ${picked.length === 1 ? employers.find((e) => e.id === picked[0])!.name : `${picked.length} arbeidsgivere`}`);
    onClose();
  };
  return (
    <Sheet title="Kopier oppsett" onClose={onClose} footer={
      <Button variant="primary" className="w-full" disabled={!picked.length} onClick={() => void copy()}>Kopier</Button>
    }>
      <p className="mb-4 text-[14.5px] text-ink-2">Timelønn, tillegg og vakttyper fra <strong>{source.name}</strong> kopieres til:</p>
      <div className="space-y-2">
        {others.map((e) => (
          <Option key={e.id} on={picked.includes(e.id)} onClick={() => setPicked(picked.includes(e.id) ? picked.filter((x) => x !== e.id) : [...picked, e.id])}
            title={e.name} text="Erstatter det som er lagt inn der nå. Vaktene beholdes." />
        ))}
      </div>
    </Sheet>
  );
}

function Option({ on, onClick, title, text }: { on: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('flex w-full items-start gap-3 rounded-2xl border-2 bg-surface p-3.5 text-left transition', on ? 'border-accent' : 'border-transparent shadow-card')}>
      <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', on ? 'bg-accent' : 'border-2 border-line')}>{on && <span className="size-2 rounded-full bg-white" />}</span>
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] text-ink-3">{text}</span>
      </span>
    </button>
  );
}

function Section({ title, hint, step, children }: { title: string; hint?: string; step?: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="flex items-center gap-2 px-1 text-[18px] font-bold">
        {step && <span className="hero grid size-6 place-items-center rounded-full text-[13px] text-white">{step}</span>}
        {title}
      </h2>
      {hint ? <p className="mb-3 px-1 text-[13px] text-ink-3">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

function TemplateSheet({ template, onSave, onDelete, onClose }: { template?: ShiftTemplate; onSave: (t: ShiftTemplate) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [t, setT] = useState<ShiftTemplate>(template ?? { id: newId(), name: '', start_time: '07:30', end_time: '15:30', break_minutes: 0 });
  const valid = t.name.trim() && t.start_time !== t.end_time;
  return (
    <Sheet title={template ? 'Endre vakttype' : 'Ny vakttype'} onClose={onClose} footer={
      <div className="flex gap-2">
        {template && <Button variant="danger" aria-label="Slett vakttype" className="px-4" onClick={() => { onDelete(t.id); onClose(); }}><Trash2 className="size-5" /></Button>}
        <Button variant="primary" className="flex-1" disabled={!valid} onClick={() => { onSave({ ...t, name: t.name.trim() }); onClose(); }}>Lagre</Button>
      </div>
    }>
      <div className="mb-4"><Label>Navn</Label><input className={inputClass} aria-label="Navn" placeholder="F.eks. Langvakt" maxLength={20} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div><Label>Fra</Label><input type="time" aria-label="Fra" className={inputClass} value={t.start_time} onChange={(e) => e.target.value && setT({ ...t, start_time: e.target.value })} /></div>
        <div><Label>Til</Label><input type="time" aria-label="Til" className={inputClass} value={t.end_time} onChange={(e) => e.target.value && setT({ ...t, end_time: e.target.value })} /></div>
      </div>
      <Label>Ubetalt pause (min)</Label>
      <div className="grid grid-cols-5 gap-1.5">
        {[0, 15, 30, 45, 60].map((b) => <Chip key={b} className="px-0" active={t.break_minutes === b} onClick={() => setT({ ...t, break_minutes: b })}>{b === 0 ? 'Ingen' : b}</Chip>)}
      </div>
    </Sheet>
  );
}

function ThemePicker() {
  const [theme, set] = useState<Theme>(getTheme);
  const options: [Theme, string, typeof Sun][] = [['auto', 'Auto', Monitor], ['light', 'Lys', Sun], ['dark', 'Mørk', Moon]];
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Lys eller mørk">
      {options.map(([t, label, Icon]) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => { setTheme(t); set(t); }}
          className={cn('flex flex-col items-center gap-1.5 rounded-2xl border-2 py-3 text-[14px] font-semibold transition active:scale-95',
            theme === t ? 'border-accent bg-accent-soft text-accent-ink' : 'border-transparent bg-sunken text-ink-2')}>
          <Icon className="size-5" />{label}
        </button>
      ))}
      <p className="col-span-3 text-[12.5px] text-ink-3">Auto følger telefonen. Valget gjelder denne enheten.</p>
    </div>
  );
}
