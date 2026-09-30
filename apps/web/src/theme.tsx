import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isThemePref, resolveTheme, themeColor, type Resolved, type ThemePref } from './theme-core';
import { useI18n } from './i18n';

const STORE = 'hm.theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

function initialPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORE);
    if (isThemePref(v)) return v;
  } catch { /* storage unavailable */ }
  return 'system';
}

type Ctx = { pref: ThemePref; setPref: (p: ThemePref) => void; resolved: Resolved };
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(initialPref);
  const [systemDark, setSystemDark] = useState(() => mq().matches);
  const resolved = resolveTheme(pref, systemDark);

  useEffect(() => {
    const m = mq();
    const on = () => setSystemDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = pref;
    document.documentElement.dataset.resolved = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(resolved));
  }, [pref, resolved]);

  const value = useMemo<Ctx>(() => ({
    pref, resolved,
    setPref: (p) => { setPrefState(p); try { localStorage.setItem(STORE, p); } catch { /* ignore */ } },
  }), [pref, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}

/** System / Light / Dark. */
export function ThemeSwitch() {
  const { pref, setPref } = useTheme();
  const { t } = useI18n();
  return (
    <div className="row" role="group" aria-label={t('theme.label')}>
      {(['system', 'light', 'dark'] as const).map((p) => (
        <button key={p} type="button" className={`btn small${pref === p ? ' primary' : ''}`} aria-pressed={pref === p} onClick={() => setPref(p)}>
          {t(`theme.${p}` as const)}
        </button>
      ))}
    </div>
  );
}
