import { useColorScheme } from 'react-native';

const light = { bg: '#ffffff', fg: '#1a1a1a', muted: '#6b6b6b', line: '#e2e2e2', card: '#f7f7f8', accent: '#1d5fd1', danger: '#b3261e' };
const dark = { bg: '#121214', fg: '#ececec', muted: '#9a9a9f', line: '#2c2c30', card: '#1b1b1e', accent: '#5b8def', danger: '#f2837a' };

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
