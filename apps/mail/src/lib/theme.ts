import { useColorScheme } from 'react-native';

// Same tokens as the Home Memory app (apps/mobile/src/lib/theme.ts): cool grey ground, white cards, ink text, one red-orange accent.
const light = {
  dark: false,
  bg: '#F2F3F5', card: '#FFFFFF', ink: '#1E2430', muted: '#5B6472', line: '#E4E7EC',
  accent: '#C8431F', accentText: '#C8431F', tint: '#FBEAE4', tintInk: '#8F2F14', ok: '#1F7A4D', danger: '#B3261E',
};
const dark: typeof light = {
  dark: true,
  bg: '#0F1217', card: '#1A1F27', ink: '#EEF0F3', muted: '#A3ABB8', line: '#2A303A',
  accent: '#C8431F', accentText: '#F08A66', tint: '#3A2019', tintInk: '#F4B8A3', ok: '#5FD39A', danger: '#F2837A',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
