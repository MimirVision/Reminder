import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Home, List, Plus, Settings as Cog } from 'lucide-react';
import { isNotInstalled, friendlyError, supabase, wantsLocal } from './data/config';
import { localRepo, supabaseRepo, type Data, type Repo } from './data/repo';
import { StoreProvider, useStore } from './data/store';
import { addMonths, monthOf, today as todayFn, type MonthKey } from './lib/dates';
import { monthName } from './lib/format';
import type { Shift } from './lib/types';
import { LoadError, NotInstalled, SignIn } from './pages/Auth';
import { Onboarding } from './pages/Onboarding';
import { Overview } from './pages/Overview';
import { Shifts } from './pages/Shifts';
import { Settings } from './pages/Settings';
import { Year } from './pages/Year';
import { ShiftSheet } from './components/ShiftSheet';
import { ToastView, cn } from './components/ui';

type Boot =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'not-installed' }
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
      setBoot(isNotInstalled(e) ? { state: 'not-installed' } : { state: 'error', message: friendlyError(e) });
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

type Tab = 'oversikt' | 'vakter' | 'aar' | 'innstillinger';
const TABS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: 'oversikt', label: 'Oversikt', icon: Home },
  { key: 'vakter', label: 'Vakter', icon: List },
  { key: 'aar', label: 'År', icon: BarChart3 },
  { key: 'innstillinger', label: 'Innstillinger', icon: Cog },
];
const tabFromHash = (): Tab => {
  const t = location.hash.replace(/^#\/?/, '') as Tab;
  return TABS.some((x) => x.key === t) ? t : 'oversikt';
};

function Main() {
  const { settings, local } = useStore();
  const today = todayFn();
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [month, setMonth] = useState<MonthKey>(monthOf(today));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [sheet, setSheet] = useState<{ shift?: Shift } | null>(null);

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
    <div className="mx-auto min-h-full max-w-lg">
      <header className="pt-safe sticky top-0 z-20 bg-canvas/85 px-5 pb-3 backdrop-blur-xl">
        <div className="flex items-center justify-between pt-3">
          {showMonth ? (
            <>
              <div>
                <p className="text-[13px] font-medium text-ink-3">{greeting} 👋</p>
                <h1 className="font-display text-[28px] leading-tight font-semibold">{monthName(month, month.slice(0, 4) !== today.slice(0, 4))}</h1>
              </div>
              <div className="flex items-center gap-1.5">
                {month !== monthOf(today) && <button onClick={() => setMonth(monthOf(today))} className="mr-1 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent-ink">I dag</button>}
                <button aria-label="Forrige måned" onClick={() => setMonth(addMonths(month, -1))} className="grid size-10 place-items-center rounded-full bg-surface shadow-card"><ChevronLeft className="size-5" /></button>
                <button aria-label="Neste måned" onClick={() => setMonth(addMonths(month, 1))} className="grid size-10 place-items-center rounded-full bg-surface shadow-card"><ChevronRight className="size-5" /></button>
              </div>
            </>
          ) : (
            <h1 className="font-display text-[28px] leading-tight font-semibold">{tab === 'aar' ? 'Året' : 'Innstillinger'}</h1>
          )}
        </div>
        {local && <p className="mt-2 rounded-xl bg-accent-soft px-3 py-1.5 text-[12px] text-accent-ink">Prøvemodus – lagres bare i denne nettleseren</p>}
      </header>

      <main className="px-5 pt-1 pb-36">
        {tab === 'oversikt' && <Overview month={month} today={today} onOpenShift={(s) => setSheet({ shift: s })} onAdd={() => setSheet({})} onSeeAll={() => setTab('vakter')} />}
        {tab === 'vakter' && <Shifts month={month} today={today} onOpenShift={(s) => setSheet({ shift: s })} onAdd={() => setSheet({})} />}
        {tab === 'aar' && <Year year={year} setYear={setYear} today={today} onPickMonth={(m) => { setMonth(m); setTab('oversikt'); }} />}
        {tab === 'innstillinger' && <Settings />}
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-xl">
        <div className="relative mx-auto grid max-w-lg grid-cols-5 px-2 pt-1.5">
          {TABS.slice(0, 2).map((t) => <NavButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} />)}
          <div className="flex justify-center">
            <button aria-label="Ny vakt" onClick={() => setSheet({})}
              className="hero -mt-6 grid size-15 place-items-center rounded-full text-white shadow-float ring-4 ring-canvas transition active:scale-95">
              <Plus className="size-7" strokeWidth={2.5} />
            </button>
          </div>
          {TABS.slice(2).map((t) => <NavButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} />)}
        </div>
      </nav>

      {sheet && <ShiftSheet shift={sheet.shift} defaultDate={defaultDate} onClose={() => setSheet(null)} />}
    </div>
  );
}

function NavButton({ t, active, onClick }: { t: (typeof TABS)[number]; active: boolean; onClick: () => void }) {
  const Icon = t.icon;
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cn('flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-semibold transition', active ? 'text-accent-ink' : 'text-ink-3')}>
      <Icon className="size-6" strokeWidth={active ? 2.4 : 2} />
      {t.label}
    </button>
  );
}
