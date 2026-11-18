// Import tasks from a deadline list exported from another system (Excel or CSV): choose or drop the file, check what
// will happen (columns, clients, options, a preview), import, and undo if it wasn't right. The file is read in the
// browser; only the tasks you import are saved, to your own workspace. The rules live in lib/importTasks.ts.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react';
import { useStore } from '../data/store';
import type { NewOccurrence } from '../data/repo';
import { formatDate } from '../lib/format';
import {
  FIELDS, buildPlan, cellText, defaultActions, findHeaderRow, guessMapping, ignoredReason, readRows,
  type ClientAction, type Mapping, type Options, type Plan,
} from '../lib/importTasks';
import { STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { periodText } from '../lib/recurrence';
import { readSheet, type Sheet } from '../lib/sheet';
import type { Occurrence } from '../lib/types';
import { useRoute } from '../router';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Checkbox, Select } from '../ui/field';
import { Dialog } from '../ui/overlay';
import { useToast } from '../ui/toast';
import { fromLines } from './Checklist';
import { useUI } from './ui-state';

const ACCEPT = '.xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
const isSheetFile = (f: File) => /\.(xlsx|xlsm|csv|txt|xls)$/i.test(f.name);

/** Always mounted: the dialog, and dropping a spreadsheet anywhere on Ledger opens it with that file. */
export function ImportTasks() {
  const ui = useUI();
  useEffect(() => {
    const files = (e: globalThis.DragEvent) => e.dataTransfer?.types.includes('Files');
    const over = (e: globalThis.DragEvent) => { if (files(e) && !ui.importing) e.preventDefault(); };
    const drop = (e: globalThis.DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!files(e) || ui.importing || !f || !isSheetFile(f)) return;
      e.preventDefault();
      ui.openImport(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [ui]);
  return ui.importing ? <ImportDialog key={ui.importing instanceof File ? ui.importing.name : 'pick'} initial={ui.importing instanceof File ? ui.importing : null} /> : null;
}

type Done = { created: string[]; clients: string[]; updated: { id: string; before: Pick<Occurrence, 'dueDate' | 'status' | 'description' | 'completedAt'> }[] };

function ImportDialog({ initial }: { initial: File | null }) {
  const ui = useUI();
  const { snap, repo, run } = useStore();
  const toast = useToast();
  const { navigate } = useRoute();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const open = async (f: File) => {
    setReading(true); setError(null);
    try {
      const s = await readSheet(f);
      if (s.rows.filter((r) => r.some((c) => cellText(c))).length < 2) throw new Error('The file has no rows to import.');
      setSheet(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally { setReading(false); }
  };
  useEffect(() => { if (initial) void open(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => ui.closeImport();
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && close()} width="max-w-3xl"
      title={done ? 'Import finished' : 'Import tasks'}
      description={done ? undefined : sheet ? <span className="inline-flex items-center gap-1.5"><FileSpreadsheet className="size-3.5" />{sheet.name}</span>
        : 'From a deadline list in Excel (.xlsx) or CSV, e.g. exported from your practice system.'}
      footer={done ? undefined : sheet ? null : <Button onClick={close}>Cancel</Button>}>
      {done ? <Finished done={done} close={close} onUndo={async () => {
        const ok = await run(async (r) => {
          await r.deleteOccurrences(done.created);
          for (const u of done.updated) await r.updateOccurrence(u.id, u.before);
          for (const id of done.clients) await r.deleteClient(id).catch(() => { /* has other work by now: keep it */ });
          return true;
        }, { success: 'Import undone' });
        if (ok) close();
      }} openTasks={() => { close(); navigate('/tasks'); }} />
        : sheet ? <Review key={sheet.name} sheet={sheet} busy={busy} onBack={() => setSheet(null)} onCancel={close} onImport={async (plan, actions) => {
          setBusy(true);
          const result = await run(async (r) => {
            const made = new Map<string, string>();
            try {
              for (const c of plan.clients) {
                if (actions[c.key]?.kind !== 'create' || !plan.creates.some((p) => p.clientKey === c.key)) continue;
                made.set(c.key, (await r.createClient({ name: c.name.slice(0, 200), reference: c.reference || null, notes: '' })).id);
              }
              const templates = repo.current ? snap.workspace.settings.checklistTemplates : undefined;
              const list: NewOccurrence[] = plan.creates.map((p) => ({
                clientId: p.clientId ?? made.get(p.clientKey)!, scheduleId: null, title: p.title, description: p.description, taskType: p.taskType,
                periodKey: null, periodStart: p.period?.start ?? null, periodEnd: p.period?.end ?? null, dueDate: p.dueDate, scheduledDueDate: null,
                status: p.status, priority: p.priority, tags: p.tags, ...(templates?.[p.taskType]?.length ? { checklist: fromLines(templates[p.taskType]) } : {}),
              }));
              const created = await r.createOccurrences(list);
              const updated: Done['updated'] = [];
              for (const u of plan.updates) {
                await r.updateOccurrence(u.task.id, u.patch);
                updated.push({ id: u.task.id, before: { dueDate: u.task.dueDate, status: u.task.status, description: u.task.description, completedAt: u.task.completedAt } });
              }
              return { created, clients: [...made.values()], updated };
            } catch (e) {
              for (const id of made.values()) await r.deleteClient(id).catch(() => {});
              throw e;
            }
          });
          setBusy(false);
          if (result) { setDone(result); toast.show(`Imported ${result.created.length} task${result.created.length === 1 ? '' : 's'}`); }
        }} />
        : <Pick reading={reading} error={error} onFile={(f) => void open(f)} />}
    </Dialog>
  );
}

function Pick({ reading, error, onFile }: { reading: boolean; error: string | null; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
          over ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-accent/50 hover:bg-hover')}>
        <Upload className="size-6 text-ink-3" />
        <span className="text-[14px] font-medium">{reading ? 'Reading…' : 'Drop the file here, or choose it'}</span>
        <span className="text-[12.5px] text-ink-3">Excel (.xlsx) or CSV. The first sheet is used.</span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} hidden aria-label="Choose a file to import" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      {error && <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
      <ul className="list-disc pl-5 text-[12.5px] text-ink-3">
        <li>Columns such as Gjøremål, Kunde, Frist, Periode, Status and Beskrivelse are recognised by their names (Norwegian or English).</li>
        <li>Each row becomes a task for the right client. You see everything before anything is saved, and can undo the import afterwards.</li>
        <li>The file is read here in your browser. Nothing is sent anywhere except the tasks you import, to your own workspace.</li>
      </ul>
    </div>
  );
}

function Review({ sheet, busy, onBack, onCancel, onImport }: {
  sheet: Sheet; busy: boolean; onBack: () => void; onCancel: () => void; onImport: (plan: Plan, actions: Record<string, ClientAction>) => void;
}) {
  const { snap, today } = useStore();
  const headerRow = useMemo(() => findHeaderRow(sheet.rows), [sheet]);
  const header = sheet.rows[headerRow] ?? [];
  const [mapping, setMapping] = useState<Mapping>(() => guessMapping(header));
  const read = useMemo(() => readRows(sheet.rows, headerRow, mapping, snap.clients), [sheet, headerRow, mapping, snap.clients]);
  const [actions, setActions] = useState<Record<string, ClientAction>>(() => defaultActions(read.clients));
  const allActions = useMemo(() => ({ ...defaultActions(read.clients), ...actions }), [read.clients, actions]);
  const [opts, setOpts] = useState<Options>({ skipBefore: null, skipClosed: true, assignmentTag: mapping.type !== null });
  const plan = useMemo(() => buildPlan(read, allActions, snap.occurrences, opts), [read, allActions, snap.occurrences, opts]);
  const before = useMemo(() => buildPlan(read, allActions, snap.occurrences, { ...opts, skipBefore: today }).before, [read, allActions, snap.occurrences, opts, today]);
  const closedInFile = read.rows.filter((r) => r.status === 'done' || r.status === 'cancelled').length;
  const missing = FIELDS.filter((f) => f.required && mapping[f.id] === null);
  const [columnsOpen, setColumnsOpen] = useState(missing.length > 0);
  const newClients = plan.clients.filter((c) => allActions[c.key]?.kind === 'create' && plan.creates.some((p) => p.clientKey === c.key));
  const clientName = (p: Plan['creates'][number]) => (p.clientId ? snap.clients.find((c) => c.id === p.clientId)?.name : read.clients.find((c) => c.key === p.clientKey)?.name) ?? '';
  const preview = [...plan.creates].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title)).slice(0, 40);
  const activeClients = snap.clients.filter((c) => c.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const sample = (col: number) => {
    for (let i = headerRow + 1; i < sheet.rows.length; i++) { const t = cellText(sheet.rows[i]?.[col]); if (t) return t.length > 28 ? `${t.slice(0, 27)}…` : t; }
    return '';
  };
  const used = new Set(Object.values(mapping).filter((v): v is number => v !== null));
  const unused = header.map((h, i) => ({ h: cellText(h), i })).filter((x) => x.h && !used.has(x.i));
  const count = plan.creates.length;

  return (
    <div className="flex flex-col gap-5 pb-1">
      {/* What will happen */}
      <div className="rounded-xl border border-line bg-canvas/50 p-4">
        <p className="text-[15px] font-semibold tracking-[-0.01em]">
          {missing.length ? 'Choose the columns below to continue'
            : count ? <>{count} task{count === 1 ? '' : 's'} for {new Set(plan.creates.map((p) => p.clientKey)).size} client{new Set(plan.creates.map((p) => p.clientKey)).size === 1 ? '' : 's'}</>
              : 'Nothing new to import'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
          {newClients.length > 0 && <Chip tone="accent">{newClients.length} new client{newClients.length === 1 ? '' : 's'}</Chip>}
          {plan.updates.length > 0 && <Chip tone="accent">{plan.updates.length} already in Ledger get{plan.updates.length === 1 ? 's' : ''} the file’s new date or status</Chip>}
          {plan.unchanged > 0 && <Chip>{plan.unchanged} already in Ledger, unchanged</Chip>}
          {plan.before > 0 && <Chip>{plan.before} due before today left out</Chip>}
          {plan.skipped.length > 0 && <Chip tone="warn">{plan.skipped.length} row{plan.skipped.length === 1 ? '' : 's'} not imported</Chip>}
          {!newClients.length && !plan.updates.length && !plan.unchanged && !plan.before && !plan.skipped.length && <Chip tone="ok">Every row can be imported</Chip>}
        </div>
      </div>

      {/* Columns */}
      <section>
        <button type="button" onClick={() => setColumnsOpen((o) => !o)} aria-expanded={columnsOpen} className="flex w-full items-center gap-2 text-left">
          <h3 className="text-[13px] font-semibold">Columns</h3>
          <span className="text-[12px] text-ink-3">{FIELDS.filter((f) => mapping[f.id] !== null).length} recognised{unused.length ? `, ${unused.length} not imported` : ''}</span>
          <ChevronDown className={cn('ml-auto size-4 text-ink-3 transition-transform', columnsOpen && 'rotate-180')} />
        </button>
        {columnsOpen && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.id} className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-ink-2">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
                  <Select aria-label={`Column for ${f.label}`} value={mapping[f.id] ?? ''} aria-invalid={f.required && mapping[f.id] === null ? true : undefined}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.id]: e.target.value === '' ? null : Number(e.target.value) }))}>
                    <option value="">{f.required ? 'Choose a column…' : 'Not imported'}</option>
                    {header.map((h, i) => cellText(h) && <option key={i} value={i}>{cellText(h)}{sample(i) ? ` (${sample(i)})` : ''}</option>)}
                  </Select>
                </label>
              ))}
            </div>
            {unused.length > 0 && (
              <div className="rounded-lg bg-sunken px-3 py-2 text-[12px] text-ink-2">
                <p className="font-medium">Not imported</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {unused.map((u) => <li key={u.i}><span className="text-ink">{u.h}</span>{ignoredReason(u.h) ? <span className="text-ink-3"> · {ignoredReason(u.h)}</span> : null}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {!missing.length && <>
        {/* Clients */}
        <section className="border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold">Clients</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">Matched to your clients by client number, then by name (case, punctuation and “AS” don’t matter). Change any that are wrong.</p>
          <ul className="mt-2.5 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {read.clients.map((c) => {
              const a = allActions[c.key];
              const value = a.kind === 'existing' ? a.clientId : a.kind;
              return (
                <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-[13px] font-medium">{c.name}{c.reference && <span className="font-normal text-ink-3"> · {c.reference}</span>}</p>
                    <p className="text-[11.5px] text-ink-3">{c.rows} task{c.rows === 1 ? '' : 's'}{c.match && a.kind === 'existing' && a.clientId === c.match.clientId
                      ? <> · <span className="text-ok">found{c.match.how === 'reference' ? ' by client number' : c.match.how === 'similar' ? ' (similar name)' : ''}</span></> : null}</p>
                  </div>
                  <Select className="w-full sm:w-64" aria-label={`Client for ${c.name}`} value={value}
                    onChange={(e) => { const v = e.target.value; setActions((x) => ({ ...x, [c.key]: v === 'create' || v === 'skip' ? { kind: v } : { kind: 'existing', clientId: v } })); }}>
                    <option value="create">New client: {c.name}</option>
                    <option value="skip">Leave out these rows</option>
                    <optgroup label="Your clients">{activeClients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                  </Select>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Options */}
        <section className="flex flex-col gap-2.5 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold">Options</h3>
          <Checkbox checked={opts.skipBefore !== null} onChange={(v) => setOpts((o) => ({ ...o, skipBefore: v ? today : null }))}
            label={`Leave out tasks due before today${before ? ` (${before})` : ''}`} description="Otherwise they come in as overdue." />
          {closedInFile > 0 && <Checkbox checked={opts.skipClosed} onChange={(v) => setOpts((o) => ({ ...o, skipClosed: v }))}
            label={`Leave out tasks that are done or cancelled in the file (${closedInFile})`} description="Tasks already in Ledger are still closed when the file says they are done." />}
          {mapping.type !== null && <Checkbox checked={opts.assignmentTag} onChange={(v) => setOpts((o) => ({ ...o, assignmentTag: v }))}
            label={`Tag each task with its ${cellText(header[mapping.type]).toLowerCase() || 'assignment'}`} description={`e.g. ${[...new Set(read.rows.map((r) => r.tags.find((t) => t.startsWith('oppdrag:'))?.slice(8)).filter(Boolean))].slice(0, 3).join(', ')}, so you can filter by it.`} />}
        </section>

        {(plan.skipped.length > 0 || plan.unknownStatuses.length > 0) && (
          <section className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-[12.5px]">
            {plan.unknownStatuses.length > 0 && <p className="text-ink-2">Status {plan.unknownStatuses.map((s) => `“${s}”`).join(', ')} isn’t one Ledger knows; those tasks come in as To do.</p>}
            {plan.skipped.length > 0 && <>
              <p className="font-medium text-warn">{plan.skipped.length} row{plan.skipped.length === 1 ? '' : 's'} not imported</p>
              <ul className="mt-1 max-h-28 overflow-y-auto text-ink-2">
                {plan.skipped.slice(0, 100).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}
              </ul>
            </>}
          </section>
        )}

        {/* Preview */}
        {count > 0 && (
          <section className="border-t border-line pt-4">
            <h3 className="text-[13px] font-semibold">Preview <span className="font-normal text-ink-3">· earliest first</span></h3>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[620px] text-left text-[12.5px]">
                <thead className="bg-canvas/60 text-[11.5px] text-ink-3">
                  <tr><th className="px-3 py-1.5 font-medium">Due</th><th className="px-3 py-1.5 font-medium">Task</th><th className="px-3 py-1.5 font-medium">Client</th>
                    <th className="px-3 py-1.5 font-medium">Period</th><th className="px-3 py-1.5 font-medium">Type</th><th className="px-3 py-1.5 font-medium">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.map((p) => (
                    <tr key={p.row}>
                      <td className="num px-3 py-1.5 whitespace-nowrap">{formatDate(p.dueDate)}</td>
                      <td className="max-w-56 truncate px-3 py-1.5" title={p.title}>{p.title}</td>
                      <td className="max-w-44 truncate px-3 py-1.5 text-ink-2" title={clientName(p)}>{clientName(p)}{!p.clientId && <span className="ml-1 text-[11px] text-accent-ink">new</span>}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{p.period ? periodText(p.period.start, p.period.end) : '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{TYPE_LABEL[p.taskType]}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{STATUS_LABEL[p.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {count > preview.length && <p className="mt-1.5 text-[12px] text-ink-3">and {count - preview.length} more.</p>}
          </section>
        )}
      </>}

      <div className="sticky -bottom-4 z-10 -mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
        <Button variant="ghost" className="mr-auto" onClick={onBack} disabled={busy}>Choose another file</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={missing.length > 0 || (count === 0 && plan.updates.length === 0)} onClick={() => onImport(plan, allActions)}>
          {count ? `Import ${count} task${count === 1 ? '' : 's'}` : plan.updates.length ? `Update ${plan.updates.length} task${plan.updates.length === 1 ? '' : 's'}` : 'Import'}
        </Button>
      </div>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'accent' | 'warn' | 'ok' }) {
  return <span className={cn('rounded-full px-2 py-0.5', tone === 'accent' ? 'bg-accent-soft text-accent-ink' : tone === 'warn' ? 'bg-warn-soft text-warn' : tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-sunken text-ink-2')}>{children}</span>;
}

function Finished({ done, close, onUndo, openTasks }: { done: Done; close: () => void; onUndo: () => Promise<void>; openTasks: () => void }) {
  const [undoing, setUndoing] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <CheckCircle2 className="size-9 text-ok" />
      <p className="text-[15px] font-semibold">{done.created.length} task{done.created.length === 1 ? '' : 's'} imported</p>
      <p className="max-w-md text-[13px] text-ink-2">
        {[done.clients.length ? `${done.clients.length} new client${done.clients.length === 1 ? ' was' : 's were'} added` : '',
          done.updated.length ? `${done.updated.length} task${done.updated.length === 1 ? '' : 's'} already in Ledger ${done.updated.length === 1 ? 'was' : 'were'} updated` : ''].filter(Boolean).join('. ')}
        {done.clients.length || done.updated.length ? '. ' : ''}Importing the same file again later only adds what is new and moves changed due dates.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button loading={undoing} onClick={() => { setUndoing(true); void onUndo().finally(() => setUndoing(false)); }}><RotateCcw /> Undo import</Button>
        <Button onClick={close}>Close</Button>
        <Button variant="primary" onClick={openTasks}>Open My Tasks</Button>
      </div>
    </div>
  );
}
