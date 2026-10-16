import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, CalendarX2, Lock, Pause, Play, Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { addDays, type ISODate } from '../lib/dates';
import { formatDate, formatDayShort } from '../lib/format';
import { PRIORITY_LABEL, SCHEDULE_STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { createOn, describeDueRule, frequencyToUnit, isPausedOn, periodLabel, recurrenceOf, upcomingPeriods, validateRecurrence } from '../lib/recurrence';
import { PRIORITIES, TASK_TYPES, isOpen, type Adjust, type DueRule, type Frequency, type IntervalUnit, type Priority, type Schedule, type TaskType } from '../lib/types';
import { Pill } from '../ui/badges';
import { Button } from '../ui/button';
import { DatePicker } from '../ui/datepicker';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/field';
import { Confirm, Dialog } from '../ui/overlay';
import { ActivityList } from './ActivityList';
import { useUI } from './ui-state';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type RuleKind = 'after_end' | 'from_start' | 'days_after_end' | 'weekday';

interface Draft {
  clientId: string; title: string; description: string; taskType: TaskType; frequency: Frequency;
  customUnit: IntervalUnit; customInterval: number; anchorMonth: number; startDate: ISODate; endDate: ISODate | null;
  ruleKind: RuleKind; months: number; day: number | 'last'; days: number; weekday: number; adjust: Adjust;
  leadDays: number; reminderDays: number | null; defaultPriority: Priority; autoGenerate: boolean; backfill: boolean;
}

function draftFrom(s: Schedule | undefined, today: ISODate, clientId = '', leadDays = 21): Draft {
  const r = s?.dueRule;
  return {
    clientId: s?.clientId ?? clientId, title: s?.title ?? '', description: s?.description ?? '', taskType: s?.taskType ?? 'bookkeeping',
    frequency: s?.frequency ?? 'monthly', customUnit: s?.unit ?? 'month', customInterval: s?.interval ?? 2, anchorMonth: s?.anchorMonth ?? 1,
    startDate: s?.startDate ?? today.slice(0, 8) + '01', endDate: s?.endDate ?? null,
    ruleKind: !r ? 'after_end' : r.kind === 'month_offset' ? (r.from === 'end' ? 'after_end' : 'from_start') : r.kind === 'days_after_end' ? 'days_after_end' : 'weekday',
    months: r?.kind === 'month_offset' ? r.months : 1, day: r?.kind === 'month_offset' ? r.day : 10,
    days: r?.kind === 'days_after_end' ? r.days : 14, weekday: r?.kind === 'weekday' ? r.weekday : 5,
    adjust: r?.adjust ?? 'next_business_day', leadDays: s?.leadDays ?? leadDays, reminderDays: s?.reminderDays ?? 3,
    defaultPriority: s?.defaultPriority ?? 'normal', autoGenerate: s?.autoGenerate ?? true, backfill: false,
  };
}

function ruleOf(d: Draft): DueRule {
  switch (d.ruleKind) {
    case 'after_end': return { kind: 'month_offset', from: 'end', months: d.months, day: d.day, adjust: d.adjust };
    case 'from_start': return { kind: 'month_offset', from: 'start', months: d.months, day: d.day, adjust: d.adjust };
    case 'days_after_end': return { kind: 'days_after_end', days: d.days, adjust: d.adjust };
    case 'weekday': return { kind: 'weekday', weekday: d.weekday, adjust: d.adjust };
  }
}

function scheduleOf(d: Draft, today: ISODate): Omit<Schedule, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'status'> {
  const { unit, interval } = frequencyToUnit(d.frequency, { unit: d.customUnit, interval: d.customInterval });
  return {
    clientId: d.clientId, title: d.title.trim(), description: d.description, taskType: d.taskType, frequency: d.frequency, unit, interval,
    anchorMonth: unit === 'week' ? 1 : d.anchorMonth, dueRule: ruleOf(d), startDate: d.startDate, endDate: d.endDate,
    generateFrom: d.backfill ? d.startDate : today, leadDays: d.leadDays, reminderDays: d.reminderDays, autoGenerate: d.autoGenerate,
    defaultPriority: d.defaultPriority,
  };
}

const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

export function ScheduleEditor() {
  const ui = useUI();
  const open = ui.schedule !== null;
  const key = ui.schedule ? (ui.schedule.mode === 'edit' ? ui.schedule.id : `new-${ui.schedule.from?.id ?? ''}`) : 'closed';
  return open ? <Editor key={key} /> : null;
}

function Editor() {
  const ui = useUI();
  const { snap, today, scheduleById, run } = useStore();
  const ed = ui.schedule!;
  const existing = ed.mode === 'edit' ? scheduleById.get(ed.id) : undefined;
  const template = ed.mode === 'new' ? ed.from : undefined;
  const [d, setD] = useState<Draft>(() => {
    const base = draftFrom(existing ?? template, today, ed.mode === 'new' ? ed.clientId : undefined, snap.workspace.settings.defaultLeadDays ?? 21);
    if (template) { base.startDate = today; base.endDate = null; }
    return base;
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyAsk, setApplyAsk] = useState<null | { count: number }>(null);
  const [applyMode, setApplyMode] = useState<'future' | 'new'>('future');
  const [confirm, setConfirm] = useState<null | 'end' | 'delete' | 'pause'>(null);
  const [endOn, setEndOn] = useState(today);
  const [cancelLater, setCancelLater] = useState(true);

  const tasks = existing ? snap.occurrences.filter((o) => o.scheduleId === existing.id) : [];
  const locked = tasks.length > 0;
  const openFuture = tasks.filter((o) => isOpen(o.status) && o.dueDate >= today);
  const s = scheduleOf(d, today);
  const recErrors = validateRecurrence(s);
  const errors = {
    title: !s.title ? 'Give the schedule a title.' : null,
    client: !s.clientId ? 'Choose a client.' : null,
    rule: recErrors[0] ?? null,
  };
  const valid = !errors.title && !errors.client && !errors.rule;
  const pauses = existing ? snap.pauses.filter((p) => p.scheduleId === existing.id) : [];
  const preview = useMemo(() => (validateRecurrence(s).length ? [] : upcomingPeriods(recurrenceOf(s), addDays(today, -1), 6)),
    [JSON.stringify(s), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const backfillCount = useMemo(() => {
    if (existing || validateRecurrence(s).length) return 0;
    return upcomingPeriods(recurrenceOf(s), s.startDate, 500).filter((p) => p.due < today).length;
  }, [JSON.stringify(s), today, existing]); // eslint-disable-line react-hooks/exhaustive-deps
  const clients = snap.clients.filter((c) => c.status === 'active' || c.id === d.clientId).sort((a, b) => a.name.localeCompare(b.name));
  const close = () => ui.openSchedule(null);

  useEffect(() => {
    if (d.frequency !== 'weekly' && !(d.frequency === 'custom' && d.customUnit === 'week') && d.ruleKind === 'weekday') set('ruleKind', 'after_end');
  }, [d.frequency, d.customUnit]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (mode?: 'future' | 'new') => {
    setTried(true);
    if (!valid) return;
    if (!existing) {
      setBusy(true);
      const created = await run((r) => r.createSchedule(s), { generate: true, success: s.autoGenerate ? 'Schedule created. Tasks that are due soon were added.' : 'Schedule created' });
      setBusy(false);
      if (created) close();
      return;
    }
    const changesTasks = JSON.stringify(s.dueRule) !== JSON.stringify(existing.dueRule) || s.title !== existing.title || s.description !== existing.description || s.taskType !== existing.taskType;
    if (changesTasks && openFuture.length && !mode) { setApplyAsk({ count: openFuture.length }); return; }
    setBusy(true);
    const { generateFrom: _g, ...patch } = s;
    const ok = await run(async (r) => {
      await r.updateSchedule(existing.id, patch);
      if (mode === 'future') return r.applySchedule(existing.id, today, existing.title, existing.description);
      return 0;
    }, { generate: true, success: (n) => (n ? `Schedule saved. ${n} open task${n === 1 ? '' : 's'} updated.` : 'Schedule saved') });
    setBusy(false);
    if (ok !== undefined) close();
  };

  const status = existing?.status;
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && close()} width="max-w-[880px]"
        title={existing ? 'Recurring schedule' : 'New recurring schedule'}
        description={<>A schedule is a <strong className="font-medium text-ink-2">rule</strong>. It creates one task (an occurrence) for each period, and Ledger checks that none are missing.</>}
        footer={<>
          {existing && (
            <div className="mr-auto flex items-center gap-1">
              {status !== 'ended' && (
                <Button variant="ghost" size="sm" onClick={() => setConfirm('pause')}>
                  {status === 'paused' ? <><Play /> Resume</> : <><Pause /> Pause</>}
                </Button>
              )}
              {status !== 'ended' && <Button variant="ghost" size="sm" onClick={() => setConfirm('end')}><CalendarX2 /> End schedule</Button>}
              {!locked && <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirm('delete')}><Trash2 /> Delete</Button>}
            </div>
          )}
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{existing ? 'Save changes' : 'Create schedule'}</Button>
        </>}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_272px]">
          <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {existing && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                <Pill tone={status === 'active' ? 'ok' : status === 'paused' ? 'warn' : 'neutral'}>{SCHEDULE_STATUS_LABEL[status!]}</Pill>
                <span>{tasks.length} task{tasks.length === 1 ? '' : 's'} created so far · {openFuture.length} open from today</span>
                {existing.endDate && <span>· ends {formatDate(existing.endDate)}</span>}
              </div>
            )}

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Client" error={tried ? errors.client : null}>
                {(p) => (
                  <Select {...p} value={d.clientId} disabled={locked} onChange={(e) => set('clientId', e.target.value)}>
                    <option value="" disabled>Choose a client…</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Type">
                {(p) => <Select {...p} value={d.taskType} onChange={(e) => set('taskType', e.target.value as TaskType)}>{TASK_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>}
              </Field>
              <Field label="Task title" className="sm:col-span-2" error={tried ? errors.title : null} hint="Each task gets this title, plus its period (e.g. “March 2026”).">
                {(p) => <Input {...p} value={d.title} maxLength={200} placeholder="e.g. VAT return" onChange={(e) => set('title', e.target.value)} />}
              </Field>
              <Field label="Description" className="sm:col-span-2">
                {(p) => <Textarea {...p} rows={2} value={d.description} maxLength={10000} placeholder="What the work involves; copied to each task." onChange={(e) => set('description', e.target.value)} />}
              </Field>
            </section>

            <section className="rounded-lg border border-line p-4">
              <h3 className="mb-3 text-[12.5px] font-semibold text-ink">Repeats</h3>
              {locked && <LockedHint />}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Frequency">
                  {(p) => (
                    <Select {...p} value={d.frequency} disabled={locked} onChange={(e) => set('frequency', e.target.value as Frequency)}>
                      <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option><option value="custom">Custom interval…</option>
                    </Select>
                  )}
                </Field>
                {d.frequency === 'custom' ? (
                  <Field label="Every">
                    {(p) => (
                      <div className="flex gap-2">
                        <Input {...p} type="number" min={1} max={d.customUnit === 'week' ? 52 : 24} disabled={locked} className="w-20" value={d.customInterval} onChange={(e) => set('customInterval', num(e.target.value, 1, 52))} />
                        <Select aria-label="Unit" disabled={locked} className="flex-1" value={d.customUnit} onChange={(e) => set('customUnit', e.target.value as IntervalUnit)}>
                          <option value="month">months</option><option value="week">weeks</option>
                        </Select>
                      </div>
                    )}
                  </Field>
                ) : <div className="hidden sm:block" />}
                {s.unit === 'month' && s.interval > 1 && (
                  <Field label={s.interval === 12 ? 'Year starts in' : 'Periods aligned to'} hint={s.interval === 12 ? 'For a fiscal year, choose its first month.' : 'Periods start in this month and every interval after it.'}>
                    {(p) => <Select {...p} value={d.anchorMonth} disabled={locked} onChange={(e) => set('anchorMonth', Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}
                  </Field>
                )}
                <Field label="Starts">
                  {(p) => <DateButton {...p} value={d.startDate} disabled={locked} onChange={(v) => set('startDate', v)} />}
                </Field>
                <Field label="Ends" hint="Optional.">
                  {(p) => (
                    <div className="flex items-center gap-2">
                      <DateButton {...p} value={d.endDate} placeholder="No end date" onChange={(v) => set('endDate', v)} />
                      {d.endDate && <Button size="sm" variant="ghost" onClick={() => set('endDate', null)}>Clear</Button>}
                    </div>
                  )}
                </Field>
              </div>
            </section>

            <section className="rounded-lg border border-line p-4">
              <h3 className="mb-3 text-[12.5px] font-semibold text-ink">Due date</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Rule" className="sm:col-span-2">
                  {(p) => (
                    <Select {...p} value={d.ruleKind} onChange={(e) => set('ruleKind', e.target.value as RuleKind)}>
                      <option value="after_end">A day of the month, counted from the period’s last month</option>
                      <option value="from_start">A day of the month, counted from the period’s first month</option>
                      <option value="days_after_end">A number of days after the period ends</option>
                      {s.unit === 'week' && <option value="weekday">A weekday in the period</option>}
                    </Select>
                  )}
                </Field>
                {(d.ruleKind === 'after_end' || d.ruleKind === 'from_start') && <>
                  <Field label="Months later" hint={d.ruleKind === 'after_end' ? '0 = in the last month of the period, 1 = the month after.' : '0 = in the first month of the period.'}>
                    {(p) => <Input {...p} type="number" min={0} max={24} value={d.months} onChange={(e) => set('months', num(e.target.value, 0, 24))} />}
                  </Field>
                  <Field label="Day">
                    {(p) => (
                      <Select {...p} value={String(d.day)} onChange={(e) => set('day', e.target.value === 'last' ? 'last' : Number(e.target.value))}>
                        {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                        <option value="last">Last day of the month</option>
                      </Select>
                    )}
                  </Field>
                </>}
                {d.ruleKind === 'days_after_end' && (
                  <Field label="Days after the period ends">{(p) => <Input {...p} type="number" min={0} max={366} value={d.days} onChange={(e) => set('days', num(e.target.value, 0, 366))} />}</Field>
                )}
                {d.ruleKind === 'weekday' && (
                  <Field label="Weekday">{(p) => <Select {...p} value={d.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</Select>}</Field>
                )}
                <Field label="If it falls on a weekend">
                  {(p) => (
                    <Select {...p} value={d.adjust} onChange={(e) => set('adjust', e.target.value as Adjust)}>
                      <option value="none">Keep the date</option><option value="next_business_day">Move to the next weekday</option><option value="previous_business_day">Move to the previous weekday</option>
                    </Select>
                  )}
                </Field>
              </div>
              {errors.rule && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-danger"><AlertCircle className="size-3.5" />{errors.rule}</p>}
              {!errors.rule && <p className="mt-3 text-[12px] text-ink-3">{describeDueRule(s.dueRule)}. Public holidays are not taken into account yet.</p>}
            </section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Create the task" hint="days before it is due">
                {(p) => <Input {...p} type="number" min={0} max={366} value={d.leadDays} onChange={(e) => set('leadDays', num(e.target.value, 0, 366))} />}
              </Field>
              <Field label="Flag as due soon" hint="days before (optional)">
                {(p) => <Input {...p} type="number" min={0} max={366} value={d.reminderDays ?? ''} onChange={(e) => set('reminderDays', e.target.value === '' ? null : num(e.target.value, 0, 366))} />}
              </Field>
              <Field label="Priority">
                {(p) => <Select {...p} value={d.defaultPriority} onChange={(e) => set('defaultPriority', e.target.value as Priority)}>{PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}</Select>}
              </Field>
            </section>

            <section className="flex flex-col gap-3 rounded-lg bg-sunken p-4">
              <Checkbox checked={d.autoGenerate} onChange={(v) => set('autoGenerate', v)} label="Create tasks automatically"
                description={d.autoGenerate ? 'Each period’s task is created on its own, in the database, even when Ledger is closed.' : 'Ledger only checks. Periods without a task you added appear under Missing Tasks.'} />
              {!existing && d.autoGenerate && backfillCount > 0 && (
                <Checkbox checked={d.backfill} onChange={(v) => set('backfill', v)}
                  label={`Also create tasks for the ${backfillCount} earlier period${backfillCount === 1 ? '' : 's'} since the start date`}
                  description="Leave this off if that work is already done elsewhere; those periods are then listed under Missing Tasks for you to review." />
              )}
            </section>
            <button type="submit" hidden />
          </form>

          <aside className="flex flex-col gap-4">
            <div>
              <h3 className="mb-2 text-[12.5px] font-semibold">Next occurrences</h3>
              {preview.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">{errors.rule ? 'Fix the rule to see a preview.' : 'No more periods: the schedule has ended.'}</p>
              ) : (
                <ol className="divide-y divide-line rounded-lg border border-line">
                  {preview.map((p) => {
                    const exists = tasks.find((o) => o.periodKey === p.key);
                    const paused = isPausedOn(p.due, pauses);
                    return (
                      <li key={p.key} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium">{periodLabel(p.key)}</span>
                          <span className="tnum text-[12.5px] text-ink-2">{formatDayShort(p.due)}{p.due.slice(0, 4) !== today.slice(0, 4) ? ` ${p.due.slice(0, 4)}` : ''}</span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-ink-3">
                          {exists ? 'Task exists' : paused ? 'Paused: will not be created' : !s.autoGenerate ? 'Check only' : createOn(p.due, s.leadDays) <= today ? 'Created on save' : `Created ${formatDate(createOn(p.due, s.leadDays))}`}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            {existing && (
              <div>
                <h3 className="mb-1 text-[12.5px] font-semibold">History</h3>
                <ActivityList items={snap.activity.filter((a) => a.entityId === existing.id)} empty="No changes yet." limit={10} />
              </div>
            )}
          </aside>
        </div>
      </Dialog>

      <Dialog open={!!applyAsk} onOpenChange={(o) => !o && setApplyAsk(null)} title="Apply to existing tasks?" width="max-w-md" footer={<>
        <Button onClick={() => setApplyAsk(null)}>Back</Button>
        <Button variant="primary" loading={busy} onClick={() => { setApplyAsk(null); void save(applyMode); }}>Save</Button>
      </>}>
        <div className="flex flex-col gap-3 text-[13px]">
          <label className="flex cursor-pointer gap-2.5 rounded-lg border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50">
            <input type="radio" name="apply" className="mt-0.5 accent-[var(--c-accent)]" checked={applyMode === 'future'} onChange={() => setApplyMode('future')} />
            <span><span className="font-medium">Also update {applyAsk?.count} open task{applyAsk?.count === 1 ? '' : 's'} due from today</span>
              <span className="block text-[12px] text-ink-3">New due dates and title. Dates you moved by hand and titles or notes you edited on a task are kept.</span></span>
          </label>
          <label className="flex cursor-pointer gap-2.5 rounded-lg border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50">
            <input type="radio" name="apply" className="mt-0.5 accent-[var(--c-accent)]" checked={applyMode === 'new'} onChange={() => setApplyMode('new')} />
            <span><span className="font-medium">Only tasks created from now on</span>
              <span className="block text-[12px] text-ink-3">Existing tasks stay exactly as they are.</span></span>
          </label>
          <p className="text-[12px] text-ink-3">Completed, cancelled and earlier tasks are never changed.</p>
        </div>
      </Dialog>

      {existing && <>
        <Confirm open={confirm === 'pause'} onOpenChange={(o) => !o && setConfirm(null)} tone="primary"
          title={status === 'paused' ? 'Resume this schedule?' : 'Pause this schedule?'}
          confirmLabel={status === 'paused' ? 'Resume' : 'Pause'}
          body={status === 'paused'
            ? 'Tasks start being created again from today. Periods due while it was paused are not created and are not reported missing.'
            : 'No new tasks are created while it is paused, and periods due in the pause are not reported missing. Existing tasks, including open ones, are kept.'}
          onConfirm={() => run((r) => r.setPaused(existing.id, status !== 'paused', today), { generate: true, success: status === 'paused' ? 'Schedule resumed' : 'Schedule paused' })} />
        <Confirm open={confirm === 'end'} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title="End this schedule?" confirmLabel="End schedule"
          body="No periods after the end date are created or expected. All tasks so far, and their history, are kept."
          onConfirm={async () => { const ok = await run((r) => r.endSchedule(existing.id, endOn, cancelLater), { success: (n) => `Schedule ended${n ? `; ${n} later task${n === 1 ? '' : 's'} cancelled` : ''}` }); if (ok !== undefined) close(); }}>
          <div className="mt-4 flex flex-col gap-3">
            <Field label="Last day">{(p) => <DateButton {...p} value={endOn} onChange={setEndOn} />}</Field>
            <Checkbox checked={cancelLater} onChange={setCancelLater} label={`Cancel open tasks for periods after ${formatDate(endOn)}`}
              description={`${tasks.filter((o) => isOpen(o.status) && o.periodStart && o.periodStart > endOn).length} task(s). Completed ones are never touched.`} />
          </div>
        </Confirm>
        <Confirm open={confirm === 'delete'} onOpenChange={(o) => !o && setConfirm(null)} title="Delete this schedule?" confirmLabel="Delete schedule"
          body="It has no tasks yet, so nothing else is affected. This can’t be undone."
          onConfirm={async () => { const ok = await run(async (r) => { await r.deleteSchedule(existing.id); return true; }, { success: 'Schedule deleted' }); if (ok) close(); }} />
      </>}
    </>
  );

  function LockedHint() {
    return (
      <p className="-mt-1 mb-3 flex items-start gap-1.5 text-[12px] text-ink-3">
        <Lock className="mt-0.5 size-3 shrink-0" />
        <span>
          The client, frequency and start date are fixed once tasks exist, so past periods keep their meaning. To change them,{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => setConfirm('end')}>end this schedule</button>, then{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => ui.openSchedule({ mode: 'new', from: existing })}>create a new one from it</button>.
        </span>
      </p>
    );
  }
}

function DateButton({ value, onChange, placeholder, disabled, ...rest }: { value: ISODate | null; onChange: (d: ISODate) => void; placeholder?: string; disabled?: boolean; id?: string }) {
  const { today } = useStore();
  const btn = (
    <button type="button" disabled={disabled} {...rest} className="flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-[13px] hover:bg-hover disabled:opacity-50">
      <CalendarDays className="size-4 text-ink-3" />
      <span className={value ? 'tnum' : 'text-ink-3'}>{value ? formatDate(value) : placeholder}</span>
    </button>
  );
  return disabled ? btn : <DatePicker value={value} today={today} onChange={onChange} trigger={btn} />;
}
