import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { dateLocale, detectLang, isLang, makeT, makeTN, translate, type Key, type Lang, type Params, type T, type TN } from '../shared/i18n/core';
import { readJson, writeJson } from './store';
import { font, useTheme } from './theme';

export type { Key, Lang, T, TN };
const STORE = 'hm.lang';

function deviceLanguages(): string[] {
  try { return [Intl.DateTimeFormat().resolvedOptions().locale]; } catch { return ['en']; }
}

/** The language to use outside React (notifications sent by the background geofence task). */
export function currentLang(): Lang {
  const stored = readJson<string | null>(STORE, null);
  return isLang(stored) ? stored : detectLang(deviceLanguages());
}
export const tNow = (key: Key, params?: Params) => translate(currentLang(), key, params);

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: T; tn: TN; locale: string };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);
  const value = useMemo<Ctx>(() => ({
    lang, t: makeT(lang), tn: makeTN(lang), locale: dateLocale(lang),
    setLang: (l) => { setLangState(l); writeJson(STORE, l); },
  }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}

/** English / Norsk. */
export function LanguageSwitch() {
  const { lang, setLang } = useI18n();
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
      {([['en', 'English'], ['nb', 'Norsk']] as const).map(([id, label]) => (
        <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected: lang === id }} onPress={() => setLang(id)}
          style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, minHeight: 36, justifyContent: 'center', backgroundColor: lang === id ? th.accent : th.dark ? '#262C36' : '#ECEEF2' }}>
          <Text style={{ fontFamily: font.semi, fontSize: 14, color: lang === id ? '#FFFFFF' : th.ink }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
