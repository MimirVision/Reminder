import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './glass';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';

type ToastInput = { text: string; undo?: () => void };
const Ctx = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(Ctx);

// One message at a time, with an optional Undo, above the floating bars.
export function ToastProvider({ children }: { children: ReactNode }) {
  const th = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const show = useCallback((input: ToastInput) => {
    clearTimeout(timer.current);
    setToast({ ...input, id: ++seq.current });
    timer.current = setTimeout(() => setToast(null), input.undo ? 6000 : 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + 150 }}>
          <Glass style={{ borderRadius: 24, paddingLeft: 18, paddingRight: 8, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text accessibilityLiveRegion="polite" style={{ color: th.ink, fontFamily: font.semi, fontSize: 15, flex: 1 }}>{toast.text}</Text>
            {toast.undo && (
              <Pressable accessibilityRole="button" onPress={() => { const u = toast.undo!; setToast(null); u(); }} style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
                <Text style={{ color: th.accentText, fontFamily: font.semi, fontSize: 15 }}>{t('common.undo')}</Text>
              </Pressable>
            )}
          </Glass>
        </View>
      )}
    </Ctx.Provider>
  );
}
