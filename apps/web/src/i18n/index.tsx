import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dateLocale, detectLang, isLang, makeT, makeTN, type Lang, type T, type TN } from './core';

export { LANGS, type Lang, type T, type TN, type Key } from './core';

const STORE = 'hm.lang';

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORE);
    if (isLang(stored)) return stored;
  } catch { /* storage unavailable */ }
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: T; tn: TN; locale: string };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const value = useMemo<Ctx>(() => ({
    lang,
    setLang: (l) => { setLangState(l); try { localStorage.setItem(STORE, l); } catch { /* ignore */ } },
    t: makeT(lang),
    tn: makeTN(lang),
    locale: dateLocale(lang),
  }), [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}

/** Language switch: two buttons. Used in Settings and on the sign-in screen. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`row ${className ?? ''}`} role="group" aria-label="Language / Språk">
      {([['en', 'English'], ['nb', 'Norsk']] as const).map(([id, label]) => (
        <button key={id} type="button" className={`btn small${lang === id ? ' primary' : ''}`} aria-pressed={lang === id} onClick={() => setLang(id)}>{label}</button>
      ))}
    </div>
  );
}
