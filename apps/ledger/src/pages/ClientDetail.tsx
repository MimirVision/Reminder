import { useMemo, useState } from 'react';
import { Archive, CheckCircle2, ChevronRight, Edit3, ListChecks, Mail, MoreHorizontal, Phone, Pin, PinOff, Plus, Repeat, RotateCcw, Trash2, User } from 'lucide-react';
import { ClientDocuments, outstanding } from '../components/ClientDocuments';
import { ActivityList } from '../components/ActivityList';
import { Page } from '../components/Shell';
import { ClientDialog } from '../components/TaskForms';
import { TaskTable } from '../components/TaskTable';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { formatDue } from '../lib/format';
import { sortTasks } from '../lib/filters';
import { needsReview } from '../lib/missing';
import { isOpen } from '../lib/types';
import { Link, useRoute } from '../router';
import { Pill } from '../ui/badges';
import { Button, IconButton } from '../ui/button';
import { cn } from '../ui/cn';
import { Textarea } from '../ui/field';
import { Confirm, Menu, MenuItem, MenuSeparator } from '../ui/overlay';
import { EmptyState } from '../ui/states';
import { useClientStats } from './Clients';
import { ScheduleList } from './Recurring';

type Tab = 'open' | 'recurring' | 'completed' | 'documents' | 'notes' | 'activity';

export function ClientDetail({ id }: { id: string }) {
  const { snap, clientById, run, expected, today, repo } = useStore();
  const ui = useUI();
  const { navigate } = useRoute();
  const client = clientById.get(id);
  const stats = useClientStats().get(id);
  const [tab, setTab] = useState<Tab>('open');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const tasks = useMemo(() => snap.occurrences.filter((o) => o.clientId === id), [snap.occurrences, id]);
  const open = useMemo(() => sortTasks(tasks.filter((o) => isOpen(o.status)), 'due', clientById), [tasks, clientById]);
  const done = useMemo(() => sortTasks(tasks.filter((o) => !isOpen(o.status)), 'completed', clientById), [tasks, clientById]);
  const schedules = snap.schedules.filter((s) => s.clientId === id);
  const missing = needsReview(expected).filter((i) => i.clientId === id);
  const activity = snap.activity.filter((a) => a.clientId === id);

  if (!client) {
    return <Page title="Client"><EmptyState icon={ListChecks} title="Client not found" body="It may have been deleted." action={<Button onClick={() => navigate('/clients')}>Back to clients</Button>} /></Page>;
  }
  const archived = client.status === 'archived';
  const isPinned = (snap.workspace.settings.pinnedClients ?? []).includes(id);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'open', label: 'Open tasks', count: open.length }, { id: 'recurring', label: 'Recurring', count: schedules.length },
    { id: 'completed', label: 'Completed', count: done.length },
    ...(repo.current ? [{ id: 'documents' as const, label: 'Documents', count: outstanding(client).length || undefined }] : []),
    { id: 'notes', label: 'Notes' }, { id: 'activity', label: 'Activity' },
  ];

  return (
    <Page title={client.name} hideTitle crumb={
      <span className="flex min-w-0 items-center gap-1.5">
        <Link to="/clients" className="text-ink-3 hover:text-ink">Clients</Link>
        <ChevronRight className="size-3.5 shrink-0 text-ink-3" />
        <span className="truncate font-medium text-ink-2">{client.name}</span>
      </span>
    }>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em]">{client.name}</h1>
            {client.reference && <span className="num text-[13px] text-ink-3">{client.reference}</span>}
            {archived && <Pill>Archived</Pill>}
          </div>
          <p className="tnum mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
            <span><span className="font-medium text-ink">{stats?.open ?? 0}</span> open</span>
            <span aria-hidden>·</span>
            <span className={stats?.overdue ? 'font-medium text-danger' : ''}>{stats?.overdue ?? 0} overdue</span>
            <span aria-hidden>·</span>
            <span>Next deadline <span className={stats?.next === today ? 'font-medium text-accent-ink' : 'text-ink-2'}>{stats?.next ? formatDue(stats.next, today).toLowerCase() : 'none'}</span></span>
            {missing.length > 0 && <><span aria-hidden>·</span><Link to={`/missing?client=${id}`} className="font-medium text-warn hover:underline">{missing.length} missing to review</Link></>}
            {outstanding(client).length > 0 && <><span aria-hidden>·</span><button onClick={() => setTab('documents')} className="font-medium text-warn hover:underline">{outstanding(client).length} document{outstanding(client).length === 1 ? '' : 's'} outstanding</button></>}
          </p>
          {(client.contactName || client.contactEmail || client.contactPhone) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
              {client.contactName && <span className="inline-flex items-center gap-1.5"><User className="size-3.5 text-ink-3" />{client.contactName}</span>}
              {client.contactEmail && <a href={`mailto:${client.contactEmail}`} className="inline-flex items-center gap-1.5 text-accent hover:underline"><Mail className="size-3.5" />{client.contactEmail}</a>}
              {client.contactPhone && <a href={`tel:${client.contactPhone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 text-accent hover:underline"><Phone className="size-3.5" /><span className="num">{client.contactPhone}</span></a>}
            </p>
          )}
          {client.notes && <p className="mt-1.5 line-clamp-2 max-w-2xl text-[13px] text-ink-2">{client.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          {archived ? (
            <Button size="sm" onClick={() => run((r) => r.updateClient(id, { status: 'active' }), { generate: true, success: 'Client reactivated' })}><RotateCcw /> Reactivate</Button>
          ) : <>
            <Button size="sm" onClick={() => ui.openSchedule({ mode: 'new', clientId: id })}><Repeat /> Add schedule</Button>
            <Button size="sm" variant="primary" onClick={() => ui.openNewTask({ clientId: id })}><Plus /> Add task</Button>
          </>}
          <Menu align="end" label="More client actions" trigger={<IconButton label="More client actions"><MoreHorizontal /></IconButton>}>
            <MenuItem onSelect={() => setEditing(true)}><Edit3 /> Edit details</MenuItem>
            {!archived && (
              <MenuItem onSelect={() => {
                const cur = snap.workspace.settings.pinnedClients ?? [];
                const next = isPinned ? cur.filter((x) => x !== id) : [...cur, id];
                void run((r) => r.updateWorkspace({ settings: { ...snap.workspace.settings, pinnedClients: next } }), { success: isPinned ? 'Removed from the sidebar' : 'Pinned to the sidebar' });
              }}>{isPinned ? <><PinOff /> Unpin from sidebar</> : <><Pin /> Pin to sidebar</>}</MenuItem>
            )}
            {!archived && <MenuItem onSelect={() => setConfirm('archive')}><Archive /> Archive client</MenuItem>}
            {tasks.length === 0 && schedules.length === 0 && <><MenuSeparator /><MenuItem danger onSelect={() => setConfirm('delete')}><Trash2 /> Delete client</MenuItem></>}
          </Menu>
        </div>
      </div>
      {archived && (
        <div className="mb-5 rounded-lg border border-line bg-sunken px-4 py-3 text-[12.5px] text-ink-2">
          This client is archived. Its history is kept, but its schedules no longer create or expect tasks. Reactivate it to resume.
        </div>
      )}


      <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn('-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-[13px] transition-colors', tab === t.id ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
            {t.label}{t.count !== undefined && <span className="tnum text-[11.5px] text-ink-3">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <div className="overflow-clip rounded-xl border border-line bg-surface">
          {open.length || !archived
            ? <TaskTable tasks={open} showClient={false} addRow={archived ? undefined : { clientId: id }} groupBy="day" />
            : <EmptyState compact icon={CheckCircle2} title="No open tasks" />}
        </div>
      )}
      {tab === 'recurring' && <ScheduleList schedules={schedules} showClient={false} emptyAction={!archived ? () => ui.openSchedule({ mode: 'new', clientId: id }) : undefined} />}
      {tab === 'completed' && (
        <div className="overflow-clip rounded-xl border border-line bg-surface">
          {done.length ? <TaskTable tasks={done} showClient={false} /> : <EmptyState compact icon={ListChecks} title="Nothing completed yet" />}
        </div>
      )}
      {tab === 'documents' && <ClientDocuments client={client} disabled={archived} />}
      {tab === 'notes' && (
        <div className="max-w-2xl">
          <Textarea aria-label="Client notes" rows={10} maxLength={10000} value={notes ?? client.notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Working notes: how the client sends documents, deadlines to watch, contacts by role. Avoid sensitive personal or financial details."
            onBlur={() => { if (notes !== null && notes !== client.notes) void run((r) => r.updateClient(id, { notes }), { success: 'Notes saved' }); }} />
          <p className="mt-1.5 text-[12px] text-ink-3">Saved when you click outside the field.</p>
        </div>
      )}
      {tab === 'activity' && <div className="max-w-3xl rounded-lg border border-line bg-surface px-4 py-2"><ActivityList items={activity} empty="No activity recorded yet." limit={100} /></div>}

      <ClientDialog open={editing} onOpenChange={setEditing} client={client} />
      <Confirm open={confirm === 'archive'} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title={`Archive ${client.name}?`} confirmLabel="Archive client"
        body="All tasks and history are kept. Its schedules stop creating tasks and are no longer checked for missing work. Open tasks stay open; you can reactivate the client at any time."
        onConfirm={() => run((r) => r.updateClient(id, { status: 'archived' }), { success: 'Client archived' })} />
      <Confirm open={confirm === 'delete'} onOpenChange={(o) => !o && setConfirm(null)} title={`Delete ${client.name}?`} confirmLabel="Delete client"
        body="This client has no tasks or schedules, so nothing else is affected. This can’t be undone."
        onConfirm={async () => { const ok = await run(async (r) => { await r.deleteClient(id); return true; }, { success: 'Client deleted' }); if (ok) navigate('/clients'); }} />
    </Page>
  );
}
