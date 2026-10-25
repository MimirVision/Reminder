// "Importer turnus": a photo, screenshot or PDF of the roster (GAT) is read by the vakt-import function, and the
// shifts are shown for her to check. Codes without times are explained once and remembered. Nothing is saved until
// she presses Lagre.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, FileText, Loader2 } from 'lucide-react';
import { useStore } from '../data/store';
import { supabase } from '../data/config';
import { newId } from '../data/repo';
import { parts, weekday, type MonthKey } from '../lib/dates';
import { MONTHS, WEEKDAY_SHORT, kr } from '../lib/format';
import { payOf, shiftKind } from '../lib/pay';
import { cleanEntries, learnCodes, planImport, unknownCodes, type RosterEntry } from '../lib/roster';
import { DAY_OFF_LABEL, type CodeRule } from '../lib/types';
import { KindIcon } from './ShiftSheet';
import { Button, Chip, Label, Sheet, cn, confetti, inputClass } from './ui';

type Step = { at: 'pick' } | { at: 'reading' } | { at: 'review'; entries: RosterEntry[]; found: boolean };

const ERRORS: Record<string, string> = {
  not_configured: 'Import er ikke slått på ennå: AI-nøkkelen mangler i Supabase.',
  limit: 'Dagens grense for import er nådd. Prøv igjen i morgen.',
  too_large: 'Filen er for stor. Prøv et skjermbilde i stedet.',
  bad_type: 'Bruk et bilde (JPG, PNG) eller en PDF.',
  unreadable: 'Fikk ikke lest turnusen. Prøv et skarpere bilde, tatt rett ovenfra.',
};

/** Photos are made smaller before they are sent: quicker, cheaper, and plenty sharp for text. */
async function prepare(file: File): Promise<{ data: string; mediaType: string }> {
  const toBase64 = (b: Blob) => new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });
  if (file.type === 'application/pdf') return { data: await toBase64(file), mediaType: 'application/pdf' };
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), 'image/jpeg', 0.88));
  return { data: await toBase64(blob), mediaType: 'image/jpeg' };
}

export function ImportSheet({ month, onClose }: { month: MonthKey; onClose: () => void }) {
  const store = useStore();
  const { settings, employers, shifts, daysOff, setup, local } = store;
  const [step, setStep] = useState<Step>({ at: 'pick' });
  const [ready, setReady] = useState<boolean | null>(null);
  const [name, setName] = useState(settings.roster_name);
  const [empId, setEmpId] = useState(employers[0]?.id ?? '');
  const [rules, setRules] = useState<Record<string, CodeRule>>(settings.roster_codes);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const emp = employers.find((e) => e.id === empId) ?? employers[0];

  useEffect(() => {
    if (local) { setReady(false); return; }
    void supabase().functions.invoke('vakt-import', { body: { op: 'status' } }).then(({ data, error }) => setReady(!error && Boolean(data?.ready)));
  }, [local]);

  const read = async (file: File) => {
    setError(null);
    setStep({ at: 'reading' });
    try {
      const body = { ...(await prepare(file)), name: name.trim(), month };
      const { data, error } = await supabase().functions.invoke('vakt-import', { body });
      if (error) {
        const code = await (error as { context?: Response }).context?.json?.().then((j: { error?: string }) => j.error).catch(() => undefined);
        throw new Error(ERRORS[code ?? ''] ?? 'Noe gikk galt. Prøv igjen.');
      }
      const entries = cleanEntries(data?.entries);
      setRules((r) => learnCodes(entries, r));
      setOff(new Set());
      setStep({ at: 'review', entries, found: Boolean(data?.found) });
    } catch (e) {
      setError((e as Error).message);
      setStep({ at: 'pick' });
    }
  };

  const entries = step.at === 'review' ? step.entries : [];
  const unknown = unknownCodes(entries, rules);
  const plan = useMemo(() => planImport(entries, rules, emp?.id ?? '', shifts, daysOff, newId, emp?.templates ?? []), [entries, rules, emp, shifts, daysOff]);
  const chosen = plan.map((p, i) => ({ p, i })).filter(({ p, i }) => p.type !== 'skip' && !p.duplicate && !off.has(i));
  const total = chosen.reduce((n, { p }) => n + (p.type === 'shift' ? payOf(p.shift, setup).total : 0), 0);

  const save = async () => {
    const newShifts = chosen.flatMap(({ p }) => (p.type === 'shift' ? [p.shift] : []));
    const newOff = chosen.flatMap(({ p }) => (p.type === 'off' ? [p.day] : []));
    if (newShifts.length && !(await store.saveShifts(newShifts))) return;
    for (const d of newOff) if (!(await store.saveDayOff(d))) return;
    await store.saveSettings({ ...store.settings, roster_name: name.trim(), roster_codes: rules });
    confetti();
    store.toast(`${newShifts.length} vakter${newOff.length ? ` og ${newOff.length} fridager` : ''} importert · +${kr(total)} 🎉`);
    onClose();
  };

  const day = (d: string) => { const [, m, dd] = parts(d); return `${WEEKDAY_SHORT[weekday(d) - 1]} ${dd}. ${MONTHS[m - 1].slice(0, 3)}`; };

  return (
    <Sheet title="Importer turnus" onClose={onClose} footer={step.at === 'review' ? (
      <div className="flex gap-2">
        <Button variant="soft" onClick={() => setStep({ at: 'pick' })}>Nytt bilde</Button>
        <Button variant="primary" className="flex-1" disabled={!chosen.length || unknown.length > 0} onClick={() => void save()}>
          {unknown.length ? 'Forklar kodene over' : `Lagre ${chosen.length}`}
        </Button>
      </div>
    ) : undefined}>
      {step.at === 'pick' && (
        <>
          <p className="mb-4 text-[14.5px] leading-relaxed text-ink-2">
            Ta et bilde eller skjermbilde av turnusen i GAT (eller velg en PDF). Vaktene leses automatisk, og du ser over dem før noe lagres.
          </p>
          <div className="mb-4">
            <Label hint="slik det står i turnusen">Navnet ditt</Label>
            <input className={inputClass} aria-label="Navnet ditt i turnusen" value={name} maxLength={80} placeholder="F.eks. Nordmann, Nikita" onChange={(e) => setName(e.target.value)} />
          </div>
          {employers.length > 1 && (
            <div className="mb-4">
              <Label>Turnusen gjelder</Label>
              <div className="flex flex-wrap gap-2">
                {employers.map((e) => <Chip key={e.id} active={emp?.id === e.id} onClick={() => setEmpId(e.id)}>{e.name}</Chip>)}
              </div>
            </div>
          )}
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" aria-label="Velg bilde eller PDF"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
          <Button variant="primary" className="w-full" disabled={ready === false} onClick={() => input.current?.click()}>
            <Camera className="size-5" /> Ta bilde eller velg fil
          </Button>
          {ready === false && (
            <p className="mt-3 rounded-2xl bg-accent-soft px-4 py-3 text-[13.5px] text-accent-ink">
              {local ? 'Import krever at du er logget inn.' : 'Import er ikke slått på ennå. Den blir tilgjengelig når AI-nøkkelen er lagt inn (se apps/vakt/IMPORT.md).'}
            </p>
          )}
          {error && <p role="alert" className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</p>}
          <p className="mt-4 flex gap-2 text-[12.5px] text-ink-3"><FileText className="size-4 shrink-0" />Bildet leses av en AI-tjeneste og lagres ikke. Klipp gjerne bort andres navn først.</p>
        </>
      )}

      {step.at === 'reading' && (
        <div className="flex flex-col items-center py-14 text-center">
          <Loader2 className="mb-4 size-9 animate-spin text-accent" />
          <p className="text-[16px] font-semibold">Leser turnusen …</p>
          <p className="text-[13.5px] text-ink-3">Det tar vanligvis 10–30 sekunder.</p>
        </div>
      )}

      {step.at === 'review' && (
        <>
          {!entries.length ? (
            <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink">
              {step.found ? 'Fant ingen vakter i bildet.' : `Fant ikke ${name.trim() ? `«${name.trim()}»` : 'deg'} i turnusen. Sjekk navnet, eller prøv et bilde av bare din rad.`}
            </p>
          ) : (
            <>
              {unknown.length > 0 && (
                <div className="mb-4 space-y-3 rounded-2xl bg-accent-soft p-4">
                  <p className="text-[14px] font-semibold text-accent-ink">Hva betyr disse kodene? Du blir bare spurt én gang.</p>
                  {unknown.map((code) => (
                    <div key={code}>
                      <p className="mb-1.5 text-[14px] font-bold">{code} <span className="font-normal text-ink-3">· {entries.filter((e) => e.code === code).length} dager</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {(emp?.templates ?? []).map((t) => (
                          <Chip key={t.id} onClick={() => setRules({ ...rules, [code]: { template_id: t.id } })}>{t.name}</Chip>
                        ))}
                        <Chip onClick={() => setRules({ ...rules, [code]: { off: 'fri' } })}>Fri</Chip>
                        <Chip onClick={() => setRules({ ...rules, [code]: { off: 'ferie' } })}>Ferie</Chip>
                        <Chip onClick={() => setRules({ ...rules, [code]: { skip: true } })}>Hopp over</Chip>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <ul className="space-y-1.5" data-testid="import-plan">
                {plan.map((p, i) => {
                  const on = p.type !== 'skip' && !p.duplicate && !off.has(i);
                  return (
                    <li key={i}>
                      <button type="button" disabled={p.type === 'skip' || p.duplicate} aria-pressed={on}
                        onClick={() => { const n = new Set(off); if (n.has(i)) n.delete(i); else n.add(i); setOff(n); }}
                        className={cn('flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition', on ? 'bg-surface shadow-card' : 'bg-sunken opacity-60')}>
                        <span className={cn('grid size-5 shrink-0 place-items-center rounded-full', on ? 'bg-accent text-white' : 'border-2 border-line')}>{on && <CheckCircle2 className="size-4" />}</span>
                        <span className="w-20 shrink-0 text-[13.5px] font-semibold capitalize">{day(p.entry.date)}</span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px]">
                          {p.type === 'shift' && <><KindIcon kind={shiftKind(p.shift)} className="size-4 text-ink-3" /><span className="tabular">{p.shift.start_time}–{p.shift.end_time}</span></>}
                          {p.type === 'off' && <span className="font-medium text-teal-700 dark:text-teal-300">{DAY_OFF_LABEL[p.day.kind]}</span>}
                          {p.type === 'skip' && <span className="text-ink-3">{p.reason}</span>}
                          {p.entry.code && <span className="text-[12px] text-ink-3">· {p.entry.code}</span>}
                          {p.type !== 'skip' && p.duplicate && <span className="text-[12px] text-ink-3">· finnes fra før</span>}
                        </span>
                        {p.type === 'shift' && <span className="tabular text-[13.5px] font-semibold">{kr(payOf(p.shift, setup).total)}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {chosen.length > 0 && !unknown.length && (
                <p className="mt-4 text-center text-[14px] text-ink-2">{chosen.length} valgt · <span className="tabular font-bold text-ink">{kr(total)}</span></p>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
