// "Lønn på konto": what lands in the account in a month and on which day (wage for the month, supplements for the
// month before, holiday pay in June), and the pay slip to check it against.
import { useState } from 'react';
import { CheckCircle2, Landmark, ReceiptText } from 'lucide-react';
import { useStore } from '../data/store';
import { newId } from '../data/repo';
import { addMonths, parts, type ISODate, type MonthKey } from '../lib/dates';
import { MONTHS, kr, monthName } from '../lib/format';
import { employerOf, payoutsIn } from '../lib/pay';
import type { Payslip } from '../lib/types';
import { Button, Card, Label, NumberInput, Sheet, cn, inputClass } from './ui';

const dayMonth = (d: ISODate) => { const [, m, day] = parts(d); return `${day}. ${MONTHS[m - 1]}`; };

export function PayoutCard({ month, today, filter }: { month: MonthKey; today: ISODate; filter: string | null }) {
  const { shifts, setup, employers, settings, payslips } = useStore();
  const [slip, setSlip] = useState(false);
  const mine = filter ? shifts.filter((s) => employerOf(s, employers)?.id === filter) : shifts;
  const payouts = payoutsIn(month, mine, setup, settings.holiday_pay_percent);
  const total = payouts.reduce((n, p) => n + p.total, 0);
  const payslip = filter ? undefined : payslips.find((p) => p.month === month);
  const tax = settings.tax_percent;
  if (payouts.length === 0 && !payslip) return null;
  const paid = payouts.every((p) => p.date <= today);
  const prev = monthName(addMonths(month, -1)).toLowerCase();
  const cur = monthName(month).toLowerCase();
  const delays = new Set(payouts.map((p) => employers.find((e) => e.id === p.employerId)?.pay_delay ?? 'supplements'));
  const what = delays.size !== 1 ? '' : ({ supplements: ` – timelønn for ${cur}, tillegg for ${prev}`, none: ` – alt for ${cur}`, all: ` – alt for ${prev}` } as const)[[...delays][0]];

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[16px] font-bold"><Landmark className="size-4.5 text-accent-ink" /> Lønn på konto i {monthName(month).toLowerCase()}</h3>
          <p className="text-[13px] text-ink-3">{paid ? 'Utbetalt' : 'Kommer'}{what}.</p>
        </div>
      </div>
      <ul className="space-y-3">
        {payouts.map((p) => {
          const e = employers.find((x) => x.id === p.employerId);
          return (
            <li key={p.employerId} className="rounded-2xl bg-sunken p-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[14.5px] font-semibold">{dayMonth(p.date)}{employers.length > 1 && e ? <span className="font-medium text-ink-3"> · {e.name}</span> : null}</span>
                <span className="tabular text-[16px] font-bold" data-testid="payout-total">{kr(p.total)}</span>
              </div>
              <div className="mt-1.5 space-y-0.5 text-[13px] text-ink-3">
                {p.wage > 0 && <Row label="Timelønn" value={p.wage} />}
                {p.variable > 0 && <Row label="Tillegg og overtid" value={p.variable} />}
                {p.holiday > 0 && <Row label="Feriepenger" value={p.holiday} />}
              </div>
            </li>
          );
        })}
      </ul>
      {payouts.length > 1 && <div className="mt-3 flex justify-between px-1 text-[14.5px] font-bold"><span>Totalt</span><span className="tabular">{kr(total)}</span></div>}
      {tax ? <p className="mt-1 px-1 text-[13px] text-ink-3">Ca. {kr(total * (1 - tax / 100))} etter skatt.</p> : null}

      {!filter && (payslip ? (
        <SlipResult payslip={payslip} expected={total} onEdit={() => setSlip(true)} />
      ) : (
        <Button variant="soft" className="mt-4 w-full" onClick={() => setSlip(true)}><ReceiptText className="size-5" /> Sjekk mot lønnsslippen</Button>
      ))}
      {slip && <PayslipSheet month={month} expected={total} existing={payslip} onClose={() => setSlip(false)} />}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between"><span>{label}</span><span className="tabular">{kr(value)}</span></div>;
}

/** Within this much of each other the pay slip counts as matching: rounding, and small items Vakt doesn't know about. */
const CLOSE = 50;

function SlipResult({ payslip, expected, onEdit }: { payslip: Payslip; expected: number; onEdit: () => void }) {
  const diff = payslip.gross - expected;
  const ok = Math.abs(diff) <= CLOSE;
  return (
    <button onClick={onEdit} className={cn('mt-4 flex w-full items-start gap-3 rounded-2xl p-3.5 text-left', ok ? 'bg-ok-soft' : diff > 0 ? 'bg-accent-soft' : 'bg-danger-soft')}>
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : <ReceiptText className={cn('mt-0.5 size-5 shrink-0', diff > 0 ? 'text-accent-ink' : 'text-danger')} />}
      <span className="text-[14px]">
        <span className="block font-semibold">Lønnsslippen: {kr(payslip.gross)} brutto</span>
        <span className="block text-ink-2" data-testid="slip-result">
          {ok ? 'Stemmer med det Vakt har regnet ut 👍'
            : diff > 0 ? `${kr(diff)} mer enn Vakt regnet ut. Kanskje en vakt eller et tillegg mangler her?`
            : `${kr(-diff)} mindre enn Vakt regnet ut. Sjekk tilleggene i Oppsett – eller spør lønningskontoret.`}
        </span>
      </span>
    </button>
  );
}

function PayslipSheet({ month, expected, existing, onClose }: { month: MonthKey; expected: number; existing?: Payslip; onClose: () => void }) {
  const { savePayslip, deletePayslip, toast } = useStore();
  const [gross, setGross] = useState<number | null>(existing?.gross ?? null);
  const [net, setNet] = useState<number | null>(existing?.net ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const save = async () => {
    if (gross === null) return;
    if (await savePayslip({ id: existing?.id ?? newId(), month, gross, net, note })) { toast('Lønnsslippen er lagret'); onClose(); }
  };
  return (
    <Sheet title={`Lønnsslipp for ${monthName(month).toLowerCase()}`} onClose={onClose} footer={
      <div className="flex gap-2">
        {existing && <Button variant="danger" onClick={() => void deletePayslip(existing.id).then((ok) => ok && onClose())}>Fjern</Button>}
        <Button variant="primary" className="flex-1" disabled={gross === null} onClick={() => void save()}>Lagre</Button>
      </div>
    }>
      <p className="mb-4 text-[14.5px] text-ink-2">Skriv inn bruttobeløpet fra lønnsslippen som ble utbetalt i {monthName(month).toLowerCase()}. Vakt har regnet ut <strong className="tabular">{kr(expected)}</strong>.</p>
      <div className="mb-4">
        <Label hint="før skatt">Brutto på lønnsslippen</Label>
        <NumberInput ariaLabel="Brutto på lønnsslippen" value={gross} onChange={setGross} suffix="kr" placeholder="F.eks. 31 250" />
      </div>
      <div className="mb-4">
        <Label hint="valgfritt">Utbetalt (netto)</Label>
        <NumberInput ariaLabel="Netto" value={net} onChange={setNet} suffix="kr" />
      </div>
      <div className="mb-2">
        <Label hint="valgfritt">Notat</Label>
        <input className={inputClass} aria-label="Notat" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. trekk for fagforening" />
      </div>
      {gross !== null && (
        <p className={cn('mt-4 rounded-2xl px-4 py-3 text-[14px] font-medium', Math.abs(gross - expected) <= CLOSE ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent-ink')}>
          {Math.abs(gross - expected) <= CLOSE ? 'Det stemmer 👍' : `Avvik: ${gross - expected > 0 ? '+' : '−'}${kr(Math.abs(gross - expected))}`}
        </p>
      )}
    </Sheet>
  );
}
