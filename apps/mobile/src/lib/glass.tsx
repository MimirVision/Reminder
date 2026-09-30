import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { readJson, writeJson } from './store';
import { useTheme } from './theme';

// How glassy the floating bars are. "clear" is the most transparent, "frosted" the most readable.
export type GlassLevel = 'clear' | 'regular' | 'frosted';
export const GLASS_LEVELS: { id: GlassLevel; label: string }[] = [
  { id: 'clear', label: 'Clear' },
  { id: 'regular', label: 'Glass' },
  { id: 'frosted', label: 'Frosted' },
];

const KEY = 'hm.glassLevel';
const Ctx = createContext<{ level: GlassLevel; setLevel: (l: GlassLevel) => void }>({ level: 'regular', setLevel: () => {} });

export function GlassProvider({ children }: { children: ReactNode }) {
  const [level, setLevelState] = useState<GlassLevel>('regular');
  useEffect(() => {
    setLevelState(readJson<GlassLevel>(KEY, 'regular'));
  }, []);
  const value = useMemo(
    () => ({ level, setLevel: (l: GlassLevel) => { setLevelState(l); writeJson(KEY, l); } }),
    [level],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useGlass = () => useContext(Ctx);

const nativeGlass = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

const BLUR: Record<GlassLevel, number> = { clear: 25, regular: 55, frosted: 95 };

// System Liquid Glass where the OS has it, otherwise a blur that approximates it.
export function Glass({ style, children, interactive }: { style?: StyleProp<ViewStyle>; children?: ReactNode; interactive?: boolean }) {
  const t = useTheme();
  const { level } = useGlass();
  const flat = StyleSheet.flatten(style) ?? {};

  if (nativeGlass && level !== 'frosted') {
    return (
      <GlassView glassEffectStyle={level === 'clear' ? 'clear' : 'regular'} isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView
      intensity={BLUR[level]}
      tint={t.dark ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
      style={[style, { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.glassEdge }]}
    >
      {level === 'frosted' && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.glassWash, borderRadius: flat.borderRadius }]} />}
      {children}
    </BlurView>
  );
}
