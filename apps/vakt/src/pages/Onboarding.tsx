// First time in: hourly wage, which supplements she gets (with amounts to check), and a monthly goal. Three short steps.
import { useState } from 'react';
import { Check } from 'lucide-react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { PRESETS, describeAmount } from '../lib/presets';
import type { Supplement } from '../lib/types';
import { Button, Label, NumberInput, cn, confetti, inputClass } from '../components/ui';

export function Onboarding() {
  const { settings, supplements, saveSettings, saveSupplement } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.name);
  const [wage, setWage] = useState<number | null>(settings.wages[0]?.hourly ?? null);
  const [picked, setPicked] = useState(() => PRESETS.map((p, i) => ({ ...p, on: i < 4 })));
  const [goal, setGoal] = useState<number | null>(settings.goal);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    let sort = supplements.length;
    for (const p of picked.filter((x) => x.on && x.amount > 0)) {
      const { hint: _hint, on: _on, ...rest } = p;
      const sup: Supplement = { ...rest, id: newId(), active: true, sort: sort++ };
      if (!(await saveSupplement(sup))) { setBusy(false); return; }
    }
    const ok = await saveSettings({ ...settings, name: name.trim(), wages: wage ? [{ from: '2000-01-01', hourly: wage }] : [], goal, onboarded: true });
    setBusy(false);
    if (ok) confetti();
  };

  const steps = [
    {
      title: 'Hei! 👋',
      text: 'Vakt regner ut hva du tjener på hver vakt – med alle tilleggene. Først: hva er timelønna di?',
      body: (
        <>
          <Label>Hva heter du?</Label>
          <input className={cn(inputClass, 'mb-4')} aria-label="Navn" value={name} maxLength={40} placeholder="Fornavn" onChange={(e) => setName(e.target.value)} />
          <Label hint="står på lønnsslippen">Timelønn</Label>
          <NumberInput ariaLabel="Timelønn" value={wage} onChange={setWage} suffix="kr/t" placeholder="F.eks. 285" />
          <p className="mt-2 text-[13px] text-ink-3">Får du lønnsøkning, legger du inn den nye under Innstillinger fra datoen den gjelder.</p>
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
          <p className="pt-1 text-[13px] text-ink-3">Du kan endre tider og dager, og legge til egne tillegg, når som helst under Innstillinger.</p>
        </div>
      ),
      next: true,
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
