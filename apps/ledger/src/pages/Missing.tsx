import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, Clock, FilePlus2, MoreHorizontal, RotateCcw, SearchCheck, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { FilterMenu } from '../components/FilterMenu';
import { Page } from '../components/Shell';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { formatDate } from '../lib/format';
import { occurrenceFromPeriod } from '../lib/generation';
import type { ExpectedItem, ExpectedState } from '../lib/missing';
import { useRoute } from '../router';
import { Pill } from '../ui/badges';
import { Button, IconButton } from '../ui/button';
import { cn } from '../ui/cn';
import { Field, Textarea } from '../ui/field';
import { Dialog, Menu, MenuItem, MenuSeparator } from '../ui/overlay';
import { EmptyState } from '../ui/states';

const STATE: Record<ExpectedState, { label: string; tone: 'warn' | 'danger' | 'neutral' | 'ok' | 'info'; icon: typeof Clock }> = {
  missing: { label: 'Missing', tone: 'warn', icon: ShieldQuestion },
  generation_failure: { label: 'Generation failed', tone: 'danger', icon: AlertOctagon },
  not_yet_due: { label: 'Not yet due', tone: 'info', icon: Clock },
  exception: { label: 'Exception', tone: 'neutral', icon: ShieldCheck },
  reviewed: { label: 'Reviewed', tone: 'ok', icon: CheckCircle2 },
};

type Tab = 'review' | 'upcoming' | 'resolved';

export function Missing() {
  const { expected, clientById, run, scheduleById } = useStore();
  const ui = useUI();
  const { query } = useRoute();
  const [tab, setTab] = useState<Tab>('review');
  const [clients, setClients] = useState<string[]>(query.get('client') ? [query.get('client')!] : []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exceptionFor, setExceptionFor] = useState<ExpectedItem[] | null>(null);
  const [note, setNote] = useState('');
  const focus = query.get('focus');

  const byTab = useMemo(() => ({
    review: expected.filter((i) => i.state === 'missing' || i.state === 'generation_failure'),
    upcoming: expected.filter((i) => i.state === 'not_yet_due'),
    resolved: expected.filter((i) => i.state === 'exception' || i.state === 'reviewed'),
  }), [expected]);
  const items = byTab[tab].filter((i) => !clients.length || clients.includes(i.clientId));
  useEffect(() => setSelected(new Set()), [tab]);
  useEffect(() => {
    if (focus) document.getElementById(`exp-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  // One batch at a time: a quick second click would otherwise land on the next row as it moves up.
  const [busy, setBusy] = useState(false);
  const generate = async (list: ExpectedItem[]) => {
    if (busy) return;
    setBusy(true);
    try { return await createFor(list); } finally { setBusy(false); }
  };
  const createFor = (list: ExpectedItem[]) => run(async (r) => {
    let n = 0;
    for (const i of list) {
      const s = scheduleById.get(i.scheduleId);
      if (!s) continue;
      await r.createOccurrence(occurrenceFromPeriod(s, i.period));
      n++;
    }
    return n;
  }, { success: (n) => `${n} task${n === 1 ? '' : 's'} created` });
  const review = (list: ExpectedItem[], status: 'reviewed' | 'exception', text = '') => run(async (r) => {
    for (const i of list) await r.saveReview({ scheduleId: i.scheduleId, periodKey: i.period.key, status, note: text });
    return list.length;
  }, { success: (n) => (status === 'reviewed' ? `${n} marked as reviewed` : `Exception recorded for ${n}`) });
  const reopen = (i: ExpectedItem) => i.review && run((r) => r.deleteReview(i.review!.id), { success: 'Back in the review list' });

  const picked = items.filter((i) => selected.has(i.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: 'review', label: 'Needs review', hint: 'Expected by now, but no task exists' },
    { id: 'upcoming', label: 'Not yet due', hint: 'The next expected task of each schedule' },
    { id: 'resolved', label: 'Reviewed & exceptions', hint: 'Decisions you recorded' },
  ];

  return (
    <Page title="Missing Tasks">
      <p className="mb-4 text-[12.5px] text-ink-3">
        Periods that an active schedule expects by today but that have no task. Nothing here is created or dismissed for you.
      </p>
      <div role="tablist" className="-mx-4 mb-3 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} title={t.hint} onClick={() => setTab(t.id)}
            className={cn('-mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium whitespace-nowrap', tab === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
            {t.label}
            <span className={cn('tnum text-[11.5px]', t.id === 'review' && byTab.review.length ? 'font-semibold text-warn' : 'text-ink-3')}>{byTab[t.id].length}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterMenu label="Client" searchable options={[...new Set(byTab[tab].map((i) => i.clientId))].map((id) => ({ value: id, label: clientById.get(id)?.name ?? id })).sort((a, b) => a.label.localeCompare(b.label))}
          selected={clients} onChange={setClients} />
        {tab === 'review' && picked.length > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-accent-soft py-0.5 pr-0.5 pl-2.5 text-[12.5px] text-accent-ink">
            {picked.length} selected
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void generate(picked).then(() => setSelected(new Set()))}><FilePlus2 /> Create tasks</Button>
            <Button size="sm" variant="secondary" onClick={() => void review(picked, 'reviewed').then(() => setSelected(new Set()))}><CheckCircle2 /> Mark reviewed</Button>
            <Button size="sm" variant="secondary" onClick={() => { setNote(''); setExceptionFor(picked); }}><ShieldCheck /> Exception…</Button>
          </div>
        )}
        <span className="tnum ml-auto text-[12.5px] text-ink-3">{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>

      <div className="overflow-clip rounded-xl border border-line bg-surface">
        {items.length === 0 ? (
          <EmptyState icon={tab === 'review' ? CheckCircle2 : SearchCheck}
            title={tab === 'review' ? 'Nothing missing' : tab === 'upcoming' ? 'No upcoming expectations' : 'No decisions recorded'}
            body={tab === 'review' ? 'Every period that should have a task by now has one, or you have reviewed it.' : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((i) => {
              const st = STATE[i.state];
              const client = clientById.get(i.clientId);
              return (
                <li key={i.id} id={`exp-${i.id}`} className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3', focus === i.id && 'bg-accent-soft/50')}>
                  {tab === 'review' && (
                    <input type="checkbox" aria-label={`Select ${i.title}, ${i.periodName}`} className="mt-[3px] size-4 shrink-0 accent-[var(--c-accent)]" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  )}
                  {/* On a phone the actions drop below the text instead of squeezing it. */}
                  <div className="min-w-0 flex-[1_1_15rem]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-medium">{i.title}</span>
                      <span className="text-[13px] text-ink-2" title={`Period ${formatDate(i.period.start)} – ${formatDate(i.period.end)}`}>{i.periodName}</span>
                      {(tab !== 'review' || i.state === 'generation_failure') && <Pill tone={st.tone}><st.icon />{st.label}</Pill>}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">{i.reason}</p>
                    <p className="mt-0.5 text-[12px] text-ink-2 md:hidden">{client?.name} · <span className="tnum">Due {formatDate(i.period.due)}</span></p>
                  </div>
                  <div className="hidden w-48 shrink-0 text-right md:block">
                    <div className="truncate text-[12.5px] text-ink-2">{client?.name}</div>
                    <div className="tnum text-[12px] text-ink-3">Due {formatDate(i.period.due)}</div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {tab === 'review' && <>
                      <Button size="sm" disabled={busy} onClick={() => void generate([i])}><FilePlus2 /> Create task</Button>
                      <Button size="sm" variant="ghost" onClick={() => void review([i], 'reviewed')}><CheckCircle2 /> Reviewed</Button>
                    </>}
                    <Menu align="end" label="More actions" trigger={<IconButton label="More actions" size="sm"><MoreHorizontal /></IconButton>}>
                      {tab === 'review' && <><MenuItem onSelect={() => { setNote(''); setExceptionFor([i]); }}><ShieldCheck /> Record an exception…</MenuItem><MenuSeparator /></>}
                      {tab === 'upcoming' && <><MenuItem onSelect={() => void generate([i])}><FilePlus2 /> Create it now</MenuItem><MenuSeparator /></>}
                      {tab === 'resolved' && <><MenuItem onSelect={() => void reopen(i)}><RotateCcw /> Review again</MenuItem><MenuSeparator /></>}
                      <MenuItem onSelect={() => ui.openSchedule({ mode: 'edit', id: i.scheduleId })}>Open schedule</MenuItem>
                    </Menu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={!!exceptionFor} onOpenChange={(o) => !o && setExceptionFor(null)} title="Record an exception" width="max-w-md"
        description={exceptionFor?.length === 1 ? `${exceptionFor[0].title}, ${exceptionFor[0].periodName}` : `${exceptionFor?.length} periods`}
        footer={<>
          <Button onClick={() => setExceptionFor(null)}>Cancel</Button>
          <Button variant="primary" disabled={!note.trim()} onClick={() => { const l = exceptionFor!; setExceptionFor(null); void review(l, 'exception', note.trim()).then(() => setSelected(new Set())); }}>Record exception</Button>
        </>}>
        <Field label="Why is no task needed?" hint="Kept with the period so you can check it later.">
          {(p) => <Textarea {...p} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Filed by the previous accountant" />}
        </Field>
      </Dialog>
    </Page>
  );
}
