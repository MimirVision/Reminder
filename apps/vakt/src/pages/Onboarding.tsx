// First time in: where she works and the hourly wage, which supplements she gets (with amounts to check), other
// employers or departments (same setup copied), and a monthly goal. Everything can be changed later under Oppsett.
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { copySetup } from '../lib/pay';
import { EMPLOYER_COLORS, PRESETS, describeAmount, fromPreset } from '../lib/presets';
import { DEFAULT_TEMPLATES, type Employer } from '../lib/types';
import { Button, Label, NumberInput, cn, confetti, inputClass } from '../components/ui';

export function Onboarding() {
  const { settings, employers, saveSettings, replaceSetup } = useStore();
  const existing = employers[0];
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.name);
  const [job, setJob] = useState(existing?.name === 'Jobben min' ? '' : existing?.name ?? '');
  const [wage, setWage] = useState<number | null>(existing?.wages[0]?.hourly ?? null);
  const [picked, setPicked] = useState(() => PRESETS.map((p, i) => ({ ...p, on: i < 4 })));
  const [more, setMore] = useState<boolean | null>(null);
  const [others, setOthers] = useState<string[]>(['']);
  const [goal, setGoal] = useState<number | null>(settings.goal);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    const first: Employer = {
      id: existing?.id ?? newId(), name: job.trim() || 'Jobben min', color: existing?.color ?? EMPLOYER_COLORS[0],
      wages: wage ? [{ from: '2000-01-01', hourly: wage }] : [],
      templates: existing?.templates.length ? existing.templates : DEFAULT_TEMPLATES.map((t) => ({ ...t, id: newId() })), sort: 0,
    };
    const sups = picked.filter((x) => x.on && x.amount > 0).map((p, i) => fromPreset(p, first.id, newId(), i));
    if (!(await replaceSetup(first, sups))) { setBusy(false); return; }
    if (more) {
      const names = others.map((o) => o.trim()).filter(Boolean);
      for (const [i, n] of names.entries()) {
        const target: Employer = { id: newId(), name: n, color: EMPLOYER_COLORS[(i + 1) % EMPLOYER_COLORS.length], wages: [], templates: [], sort: i + 1 };
        const out = copySetup(first, sups, target, newId);
        if (!(await replaceSetup(out.employer, out.supplements))) { setBusy(false); return; }
      }
    }
    const ok = await saveSettings({ ...settings, name: name.trim(), goal, onboarded: true });
    setBusy(false);
    if (ok) confetti();
  };

  const steps = [
    {
      title: 'Hei! 👋',
      text: 'Vakt regner ut hva du tjener på hver vakt – med alle tilleggene. Du setter det opp én gang, så går resten av seg selv.',
      body: (
        <>
          <Label>Hva heter du?</Label>
          <input className={cn(inputClass, 'mb-4')} aria-label="Navn" value={name} maxLength={40} placeholder="Fornavn" onChange={(e) => setName(e.target.value)} />
          <Label hint="arbeidsgiver eller avdeling">Hvor jobber du?</Label>
          <input className={cn(inputClass, 'mb-4')} aria-label="Hvor jobber du" value={job} maxLength={60} placeholder="F.eks. Avdeling 2, Sykehjemmet" onChange={(e) => setJob(e.target.value)} />
          <Label hint="står på lønnsslippen">Timelønn</Label>
          <NumberInput ariaLabel="Timelønn" value={wage} onChange={setWage} suffix="kr/t" placeholder="F.eks. 285" />
        </>
      ),
      next: Boolean(wage && wage > 0),
    },
    {
      title: 'Tilleggene dine ✨',
      text: 'Velg de du får. Beløpene er vanlige eksempler – sjekk dem mot lønnsslippen og endre om de er annerledes.',
      body: (
        <div className="space-y-2">
          {picked.map((p, i) => {
            const update = (patch: Partial<typeof p>) => setPicked(picked.map((x, j) => j === i ? { ...x, ...patch } : x));
            return (
              <div key={p.name} className={cn('rounded-2xl border-2 bg-surface p-3.5 transition', p.on ? 'border-accent' : 'border-transparent shadow-card')}>
                <button type="button" aria-pressed={p.on} className="flex w-full items-center gap-3 text-left" onClick={() => update({ on: !p.on })}>
                  <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', p.on ? 'bg-accent text-white' : 'border-2 border-line')}>{p.on && <Check className="size-4" />}</span>
                  <span className="flex-1">
                    <span className="block text-[15px] font-semibold">{p.name}</span>
                    <span className="block text-[13px] text-ink-3">{p.hint} · {describeAmount(p)}</span>
                  </span>
                </button>
                {p.on && (
                  <div className="mt-3 grid grid-cols-2 gap-2 pl-9">
                    <NumberInput ariaLabel={`${p.name} beløp`} value={p.amount} onChange={(n) => update({ amount: n ?? 0 })} suffix={p.amount_type === 'percent' ? '%' : 'kr/t'} />
                    {p.amount_type === 'percent' && <NumberInput ariaLabel={`${p.name} minst`} value={p.min_per_hour} onChange={(n) => update({ min_per_hour: n })} suffix="min kr/t" placeholder="min." />}
                  </div>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-[13px] text-ink-3">Tider, dager og egne tillegg kan du endre når som helst under Oppsett.</p>
        </div>
      ),
      next: true,
    },
    {
      title: 'Flere jobber? 🏥',
      text: 'Jobber du på flere avdelinger eller for flere arbeidsgivere? Da holder Vakt dem fra hverandre, og du velger hvor når du legger inn en vakt.',
      body: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={more === false ? 'primary' : 'soft'} onClick={() => setMore(false)}>Nei, bare én</Button>
            <Button variant={more ? 'primary' : 'soft'} onClick={() => setMore(true)}>Ja</Button>
          </div>
          {more && (
            <>
              <p className="pt-1 text-[14px] text-ink-2">Hva heter de andre? De får samme timelønn og tillegg som {job.trim() || 'den første'} – endre det i Oppsett om noe er annerledes.</p>
              {others.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <input className={inputClass} aria-label={`Arbeidsgiver ${i + 2}`} value={o} maxLength={60} placeholder="F.eks. Avdeling 4"
                    onChange={(e) => setOthers(others.map((x, j) => j === i ? e.target.value : x))} />
                  {others.length > 1 && <button aria-label="Fjern" className="grid size-12 shrink-0 place-items-center rounded-full text-ink-3" onClick={() => setOthers(others.filter((_, j) => j !== i))}><X className="size-5" /></button>}
                </div>
              ))}
              {others.length < 5 && <button className="flex items-center gap-1.5 text-[14px] font-semibold text-accent-ink" onClick={() => setOthers([...others, ''])}><Plus className="size-4" /> En til</button>}
            </>
          )}
        </div>
      ),
      next: more === false || (more === true && others.some((o) => o.trim())),
    },
    {
      title: 'Et mål å jobbe mot 🎯',
      text: 'Hvor mye vil du tjene i måneden før skatt? Da ser du hvor nærme du er – og får en feiring når du når det.',
      body: (
        <>
          <Label hint="valgfritt">Månedsmål</Label>
          <NumberInput ariaLabel="Månedsmål" value={goal} onChange={(n) => setGoal(n && n > 0 ? n : null)} suffix="kr" placeholder="F.eks. 35 000" />
        </>
      ),
      next: true,
    },
  ];
  const s = steps[step];

  return (
    <div className="pt-safe mx-auto flex min-h-full max-w-lg flex-col px-5 pb-6">
      <div className="mt-6 mb-8 flex gap-1.5" aria-label={`Steg ${step + 1} av ${steps.length}`}>
        {steps.map((_, i) => <div key={i} className={cn('h-1.5 flex-1 rounded-full transition', i <= step ? 'hero' : 'bg-line')} />)}
      </div>
      <div key={step} className="flex-1 animate-rise">
        <h1 className="mb-2 font-display text-[32px] leading-tight font-semibold">{s.title}</h1>
        <p className="mb-6 text-[15.5px] leading-relaxed text-ink-2">{s.text}</p>
        {s.body}
      </div>
      <div className="pb-safe mt-8 flex gap-2">
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Tilbake</Button>}
        <Button variant="primary" className="flex-1" disabled={!s.next || busy}
          onClick={() => step < steps.length - 1 ? setStep(step + 1) : void finish()}>
          {step < steps.length - 1 ? 'Neste' : 'Kom i gang'}
        </Button>
      </div>
    </div>
  );
}
