import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Building2, CalendarDays, Home, ListChecks, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Plus, Repeat, Search, SearchCheck, Settings, X } from 'lucide-react';
import { isOpen } from '../lib/types';
import { useStore } from '../data/store';
import { Link, useRoute } from '../router';
import { Button, IconButton, Kbd } from '../ui/button';
import { cn } from '../ui/cn';
import { useUI } from './ui-state';

const NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/tasks', label: 'My Tasks', icon: ListChecks },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/clients', label: 'Clients', icon: Building2 },
  { to: '/recurring', label: 'Recurring Work', icon: Repeat },
  { to: '/missing', label: 'Missing Tasks', icon: SearchCheck },
] as const;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const { path } = useRoute();
  const { reviewCount, repo, snap, today, clientById } = useStore();
  const active = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));
  const overdue = snap.occurrences.filter((o) => isOpen(o.status) && o.dueDate < today).length;
  const pinned = (snap.workspace.settings.pinnedClients ?? []).map((id) => clientById.get(id)).filter((c): c is NonNullable<typeof c> => !!c && c.status === 'active');
  const overdueBy = (id: string) => snap.occurrences.filter((o) => o.clientId === id && isOpen(o.status) && o.dueDate < today).length;
  const count = (n: number, tone: 'danger' | 'warn' | 'muted', label: string) => n > 0 && (
    <span aria-label={label} className={cn('tnum min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold',
      tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'text-ink-3',
      collapsed && 'absolute -top-1 -right-1 min-w-4 px-1 text-[10px] leading-4')}>{n}</span>
  );
  const item = (to: string, label: string, Icon: typeof Home | null, badge?: ReactNode, extra?: string) => (
    <Link
      key={to}
      to={to}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active(to) ? 'page' : undefined}
      className={cn(
        'group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] transition-colors',
        collapsed ? 'justify-center px-0' : 'px-2.5',
        active(to) ? 'bg-surface font-medium text-ink shadow-soft ring-1 ring-line' : 'text-ink-2 hover:bg-hover hover:text-ink', extra,
      )}
    >
      {Icon ? <Icon className={cn('size-4 shrink-0', active(to) ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')} strokeWidth={1.9} />
        : <span className="flex size-4 shrink-0 items-center justify-center rounded bg-sunken text-[10px] font-semibold text-ink-2" aria-hidden>{label.slice(0, 1)}</span>}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {badge}
    </Link>
  );
  return (
    <nav aria-label="Main" className={cn('flex h-full flex-col border-r border-line bg-canvas pt-4 pb-3 transition-[width] duration-200', collapsed ? 'w-[60px] px-2' : 'w-[232px] px-3')}>
      <div className={cn('mb-5 flex items-center gap-2.5', collapsed ? 'justify-center' : 'px-1.5')}>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold tracking-tight text-canvas" aria-hidden>L</div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[14px] leading-tight font-semibold tracking-[-0.01em]">Ledger</div>
            <div className="truncate text-[11.5px] leading-tight text-ink-3">{snap.workspace.name || 'Workspace'}</div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {NAV.map((n) => item(n.to, n.label, n.icon,
          n.to === '/tasks' ? count(overdue, 'danger', `${overdue} overdue`)
            : n.to === '/missing' ? count(reviewCount, 'warn', `${reviewCount} to review`) : undefined))}
      </div>
      {pinned.length > 0 && (
        <div className="mt-6 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {!collapsed && <div className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Pinned clients</div>}
          {pinned.map((c) => item(`/clients/${c.id}`, c.name, null, count(overdueBy(c.id), 'danger', `${overdueBy(c.id)} overdue`)))}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-3">
        {repo.mode === 'demo' && !collapsed && (
          <div className="rounded-md border border-dashed border-line-strong px-2.5 py-2 text-[11.5px] leading-snug text-ink-3">
            <span className="font-medium text-ink-2">Demo mode.</span> Fictional data, kept in this browser only.
          </div>
        )}
        {item('/settings', 'Settings', Settings)}
        {onToggle && (
          <button onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('flex h-8 items-center gap-2.5 rounded-md text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink', collapsed ? 'justify-center' : 'px-2.5')}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
          </button>
        )}
      </div>
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('ledger-sidebar') === 'collapsed'; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('ledger-sidebar', c ? 'open' : 'collapsed'); } catch { /* ignore */ } return !c; });
  const { path } = useRoute();
  useEffect(() => setDrawer(false), [path]);
  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block"><Sidebar collapsed={collapsed} onToggle={toggle} /></div>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-[rgb(20_20_28/0.25)]" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 animate-slide-in shadow-pop">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <IconButton label="Close menu" className="absolute top-3 right-2" onClick={() => setDrawer(false)}><X /></IconButton>
          </div>
        </div>
      )}
      <DrawerContext.Provider value={() => setDrawer(true)}>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </DrawerContext.Provider>
    </div>
  );
}

const DrawerContext = createContext<() => void>(() => {});

/** A screen: the compact top bar with its title, search and quick add, then the content. */
export function Page({ title, docTitle, subtitle, actions, children, wide }: { title: ReactNode; docTitle?: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  const openDrawer = useContext(DrawerContext);
  const ui = useUI();
  useEffect(() => {
    const t = docTitle ?? (typeof title === 'string' ? title : null);
    if (t) document.title = `${t} · Ledger`;
  }, [title, docTitle]);
  return (
    <>
      <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur-md md:px-6">
        <IconButton label="Open menu" className="-ml-1 lg:hidden" onClick={openDrawer}><MenuIcon /></IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em]">{title}</h1>
        </div>
        {actions}
        <button
          onClick={() => ui.setPalette(true)}
          className="hidden h-8 w-56 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-ink-3 shadow-soft transition-colors hover:border-line-strong hover:text-ink-2 md:flex"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>{`${MOD} K`}</Kbd>
        </button>
        <IconButton label="Search" className="md:hidden" onClick={() => ui.setPalette(true)}><Search /></IconButton>
        <Button variant="primary" onClick={() => ui.openNewTask()} aria-keyshortcuts="n">
          <Plus /> <span className="hidden sm:inline">New task</span>
        </Button>
      </header>
      <main id="main" className={cn('mx-auto w-full flex-1 px-4 py-6 md:px-8', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>
        {subtitle && <div className="mb-5">{subtitle}</div>}
        {children}
      </main>
    </>
  );
}
