import { useColorScheme } from 'react-native';
import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from './store';

// Design E: cool neutral ground, white cards, ink text, one red-orange accent.
const light = {
  dark: false,
  bg: '#F2F3F5', card: '#FFFFFF', sheet: '#FFFFFF',
  ink: '#1E2430', fg: '#1E2430', muted: '#5B6472', line: '#E4E7EC', control: '#8A93A1',
  accent: '#C8431F', accentText: '#C8431F', tint: '#FBEAE4', tintInk: '#8F2F14',
  danger: '#B3261E', glassWash: 'rgba(255,255,255,0.55)', glassEdge: 'rgba(255,255,255,0.75)',
};
const dark: typeof light = {
  dark: true,
  bg: '#0F1217', card: '#1A1F27', sheet: '#1A1F27',
  ink: '#EEF0F3', fg: '#EEF0F3', muted: '#A3ABB8', line: '#2A303A', control: '#8A93A1',
  accent: '#C8431F', accentText: '#F08A66', tint: '#3A2019', tintInk: '#F4B8A3',
  danger: '#F2837A', glassWash: 'rgba(20,24,31,0.55)', glassEdge: 'rgba(255,255,255,0.14)',
};

export type Theme = typeof light;
// Light, dark, or follow the phone (the default).
export type ThemePref = 'system' | 'light' | 'dark';
let pref: ThemePref | null = null;
const listeners = new Set<() => void>();
export function getThemePref(): ThemePref {
  if (pref === null) { const v = readJson<string>('hm.theme', 'system'); pref = v === 'light' || v === 'dark' ? v : 'system'; }
  return pref;
}
export function setThemePref(p: ThemePref) { pref = p; writeJson('hm.theme', p); listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useThemePref = (): ThemePref => useSyncExternalStore(subscribe, getThemePref);

export function useTheme(): Theme {
  const system = useColorScheme();
  const p = useThemePref();
  return (p === 'system' ? system === 'dark' : p === 'dark') ? dark : light;
}

export const font = {
  display: 'BricolageGrotesque_700Bold',
  body: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semi: 'DMSans_600SemiBold',
};
