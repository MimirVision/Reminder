import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

type ToastInput = { text: string; undo?: () => void };
const Ctx = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(Ctx);

// One message at a time, with an optional Undo. Sits above the add bar and the tab bar.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const { t } = useI18n();

  const show = useCallback((input: ToastInput) => {
    window.clearTimeout(timer.current);
    setToast({ ...input, id: ++seq.current });
    timer.current = window.setTimeout(() => setToast(null), input.undo ? 6000 : 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="dock toast-dock" aria-live="polite">
        {toast && (
          <div className="toast glass" key={toast.id} role="status">
            <span>{toast.text}</span>
            {toast.undo && (
              <button type="button" className="toast-undo" onClick={() => { const u = toast.undo!; setToast(null); u(); }}>{t('common.undo')}</button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
