import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Home, List, Plus, SlidersHorizontal } from 'lucide-react';
import { isNotInstalled, isOutdated, friendlyError, supabase, wantsLocal } from './data/config';
import { localRepo, supabaseRepo, type Data, type Repo } from './data/repo';
import { StoreProvider, useStore } from './data/store';
import { addMonths, monthOf, today as todayFn, type MonthKey } from './lib/dates';
import { monthName } from './lib/format';
import type { Shift } from './lib/types';
import { LoadError, NotInstalled, SignIn } from './pages/Auth';
import { Onboarding } from './pages/Onboarding';
import { Overview } from './pages/Overview';
import { Shifts } from './pages/Shifts';
import { Setup } from './pages/Setup';
import { Year } from './pages/Year';
import { ShiftSheet } from './components/ShiftSheet';
import { ToastView, cn } from './components/ui';
import { TOUR_EVENT, Tour, appTour } from './components/Tour';
import { UPDATE_EVENT } from './lib/update';

type Boot =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'not-installed' }
  | { state: 'outdated' }
  | { state: 'error'; message: string }
  | { state: 'ready'; repo: Repo; data: Data; local: boolean; email: string | null };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });

  const load = useCallback(async () => {
    setBoot({ state: 'loading' });
    if (wantsLocal()) {
      const repo = localRepo();
      setBoot({ state: 'ready', repo, data: await repo.load(), local: true, email: null });
      return;
    }
    const { data: { session } } = await supabase().auth.getSession();
    if (!session) { setBoot({ state: 'signed-out' }); return; }
    const repo = supabaseRepo();
    try {
      setBoot({ state: 'ready', repo, data: await repo.load(), local: false, email: session.user.email ?? null });
    } catch (e) {
      setBoot(isOutdated(e) ? { state: 'outdated' } : isNotInstalled(e) ? { state: 'not-installed' } : { state: 'error', message: friendlyError(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    if (wantsLocal()) return;
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void load();
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  if (boot.state === 'loading') return <Splash />;
  if (boot.state === 'signed-out') return <SignIn />;
  if (boot.state === 'not-installed') return <NotInstalled />;
  if (boot.state === 'outdated') return <NotInstalled upgrade />;
  if (boot.state === 'error') return <LoadError message={boot.message} retry={() => void load()} />;
  return (
    <StoreProvider repo={boot.repo} initial={boot.data} local={boot.local} email={boot.email}>
      <Gate />
      <ToastView />
    </StoreProvider>
  );
}

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <div className="hero size-14 animate-pulse rounded-2xl" aria-label="Laster" />
    </div>
  );
}

function Gate() {
  const { settings } = useStore();
  return settings.onboarded ? <Main /> : <Onboarding />;
}

type Tab = 'oversikt' | 'vakter' | 'aar' | 'oppsett';
const TABS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: 'oversikt', label: 'Oversikt', icon: Home },
  { key: 'vakter', label: 'Vakter', icon: List },
  { key: 'aar', label: 'År', icon: BarChart3 },
  { key: 'oppsett', label: 'Oppsett', icon: SlidersHorizontal },
];
const FILTER = 'vakt-filter';
const tabFromHash = (): Tab => {
  const raw = location.hash.replace(/^#\/?/, '');
  const t = (raw === 'innstillinger' ? 'oppsett' : raw) as Tab;
  return TABS.some((x) => x.key === t) ? t : 'oversikt';
};

function Main() {
  const { settings, local, employers, saveSettings } = useStore();
  const today = todayFn();
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [month, setMonth] = useState<MonthKey>(monthOf(today));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [sheet, setSheet] = useState<{ shift?: Shift; date?: string } | null>(null);
  // Show one employer or all; remembered on this phone.
  const [filterState, setFilterState] = useState<string | null>(() => { try { return localStorage.getItem(FILTER); } catch { return null; } });
  const filter = employers.some((e) => e.id === filterState) ? filterState : null;
  const setFilter = (id: string | null) => {
    setFilterState(id);
    try { if (id) localStorage.setItem(FILTER, id); else localStorage.removeItem(FILTER); } catch { /* only a convenience */ }
  };

  // A new version has taken over in the background (see main.tsx): offer a reload rather than surprise her mid-edit.
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    const on = () => setUpdated(true);
    window.addEventListener(UPDATE_EVENT, on);
    return () => window.removeEventListener(UPDATE_EVENT, on);
  }, []);

  // A hairline under the header once the page scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // The walkthrough: once, the first time the overview opens, and again when asked for from Oppsett.
  const [touring, setTouring] = useState(false);
  useEffect(() => {
    if (settings.toured) return;
    const t = window.setTimeout(() => { setTabState('oversikt'); setTouring(true); }, 700);
    return () => window.clearTimeout(t);
    // Only on the first visit; finishing it sets toured.
  }, []);
  useEffect(() => {
    const start = () => { setTab('oversikt'); window.setTimeout(() => setTouring(true), 250); };
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  });
  const endTour = (finished: boolean) => {
    setTouring(false);
    if (!settings.toured) void saveSettings({ ...settings, toured: true });
    if (finished) setSheet({});
  };

  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, '', t === 'oversikt' ? location.pathname + location.search : `#/${t}`);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const defaultDate = month === monthOf(today) ? today : `${month}-01`;
  const showMonth = tab === 'oversikt' || tab === 'vakter';
  const greeting = (() => {
    const h = new Date().getHours();
    const part = h < 5 ? 'God natt' : h < 10 ? 'God morgen' : h < 17 ? 'Hei' : 'God kveld';
    return settings.name ? `${part}, ${settings.name}` : part;
  })();

  return (
    <div className="mx-auto min-h-full max-w-lg md:max-w-5xl md:pl-28 md:pr-6">
      <header className={cn('pt-safe sticky top-0 z-20 bg-canvas/85 px-5 pb-3 backdrop-blur-xl transition-shadow', scrolled && 'shadow-[0_1px_0_var(--c-line),0_8px_20px_-14px_rgb(40_20_50/0.3)]')}>
        <div className="flex items-center justify-between pt-3">
          {showMonth ? (
            <>
              <div>
                <p className="text-[13px] font-medium text-ink-3">{greeting} 👋</p>
                <h1 className="font-display text-[27px] leading-tight font-semibold">{monthName(month, month.slice(0, 4) !== today.slice(0, 4))}</h1>
              </div>
              <div className="flex items-center gap-1.5" data-tour="month">
                {month !== monthOf(today) && <button onClick={() => setMonth(monthOf(today))} className="mr-1 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent-ink">I dag</button>}
                <button aria-label="Forrige måned" onClick={() => setMonth(addMonths(month, -1))} className="grid size-9 place-items-center rounded-full bg-surface shadow-card transition active:scale-90"><ChevronLeft className="size-5" /></button>
                <button aria-label="Neste måned" onClick={() => setMonth(addMonths(month, 1))} className="grid size-9 place-items-center rounded-full bg-surface shadow-card transition active:scale-90"><ChevronRight className="size-5" /></button>
              </div>
            </>
          ) : (
            <h1 className="font-display text-[27px] leading-tight font-semibold">{tab === 'aar' ? 'Året' : 'Oppsett'}</h1>
          )}
        </div>
        {employers.length > 1 && tab !== 'oppsett' && (
          <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Vis arbeidsgiver" data-tour="filter">
            <FilterChip on={!filter} onClick={() => setFilter(null)}>Alle</FilterChip>
            {employers.map((e) => (
              <FilterChip key={e.id} on={filter === e.id} onClick={() => setFilter(e.id)}><span className="size-2.5 rounded-full" style={{ background: e.color }} />{e.name}</FilterChip>
            ))}
          </div>
        )}
        {local && <p className="mt-2 rounded-xl bg-accent-soft px-3 py-1.5 text-[12px] text-accent-ink">Prøvemodus – lagres bare i denne nettleseren</p>}
      </header>

      <main key={tab} className="animate-fade-in px-5 pt-1 pb-32 md:pb-12">
        {tab === 'oversikt' && <Overview month={month} today={today} filter={filter} onOpenShift={(s) => setSheet({ shift: s })} onAdd={() => setSheet({})} onSeeAll={() => setTab('vakter')} />}
        {tab === 'vakter' && <Shifts month={month} today={today} filter={filter} onOpenShift={(s) => setSheet({ shift: s })} onAdd={(date) => setSheet({ date })} />}
        {tab === 'aar' && <Year year={year} setYear={setYear} today={today} filter={filter} onPickMonth={(m) => { setMonth(m); setTab('oversikt'); }} />}
        {tab === 'oppsett' && <div className="md:mx-auto md:max-w-2xl"><Setup /></div>}
      </main>

      {/* A slim floating bar, with the add button inside it. */}
      {/* iPad: a rail down the left side instead of the bar at the bottom. */}
      <nav className="fixed top-1/2 left-4 z-30 hidden -translate-y-1/2 flex-col items-center gap-1.5 rounded-[24px] border border-line/70 bg-surface/95 p-2 shadow-[0_8px_30px_-8px_rgb(40_20_50/0.25)] backdrop-blur-xl md:flex" aria-label="Meny">
        <button aria-label="Ny vakt" data-tour="add" onClick={() => setSheet({})}
          className="hero mb-1.5 grid size-14 place-items-center rounded-2xl text-white shadow-float transition active:scale-90">
          <Plus className="size-7" strokeWidth={2.5} />
        </button>
        {TABS.map((t) => <NavButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} rail />)}
      </nav>

      <nav className="fixed inset-x-0 bottom-0 z-30 px-4 md:hidden" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
        <div className="mx-auto flex h-15 max-w-[380px] items-center justify-between rounded-[22px] border border-line/70 bg-surface/95 px-1.5 shadow-[0_8px_30px_-8px_rgb(40_20_50/0.25)] backdrop-blur-xl">
          {TABS.slice(0, 2).map((t) => <NavButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} />)}
          <button aria-label="Ny vakt" data-tour="add" onClick={() => setSheet({})}
            className="hero mx-1 grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-float transition active:scale-90">
            <Plus className="size-6" strokeWidth={2.5} />
          </button>
          {TABS.slice(2).map((t) => <NavButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} />)}
        </div>
      </nav>

      {updated && (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
          <button onClick={() => location.reload()} className="flex animate-pop-in items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[14px] font-semibold text-canvas shadow-card">
            ✨ Ny versjon av Vakt – trykk for å oppdatere
          </button>
        </div>
      )}
      {touring && <Tour steps={appTour(settings.name, employers.length)} onDone={endTour} finalLabel="Legg inn første vakt" />}
      {sheet && <ShiftSheet shift={sheet.shift} defaultDate={sheet.date ?? defaultDate} employerId={filter} onClose={() => setSheet(null)} />}
    </div>
  );
}

function NavButton({ t, active, onClick, rail }: { t: (typeof TABS)[number]; active: boolean; onClick: () => void; rail?: boolean }) {
  const Icon = t.icon;
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined} data-tour={`tab-${t.key}`}
      className={cn('flex flex-col items-center justify-center gap-0.5 rounded-2xl text-[10.5px] font-semibold transition active:scale-95',
        rail ? 'size-16 text-[11px]' : 'h-12 flex-1',
        active ? 'bg-accent-soft text-accent-ink' : 'text-ink-3')}>
      <Icon className="size-[19px]" strokeWidth={active ? 2.4 : 2} />
      {t.label}
    </button>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={cn('flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold transition',
        on ? 'bg-ink text-canvas' : 'bg-surface text-ink-2 shadow-card')}>
      {children}
    </button>
  );
}
