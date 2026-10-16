import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { cn } from './cn';

interface ToastOpts { tone?: 'default' | 'error'; undo?: () => void }
interface Toast extends ToastOpts { id: number; message: string }
interface ToastApi { show(message: string, opts?: ToastOpts): void }

const Ctx = createContext<ToastApi>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback((message: string, opts: ToastOpts = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, message, ...opts }]);
    window.setTimeout(() => dismiss(id), opts.tone === 'error' ? 8000 : opts.undo ? 6000 : 3500);
  }, [dismiss]);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={cn(
            'pointer-events-auto flex max-w-md animate-toast-in items-center gap-2.5 rounded-lg py-2 pr-2 pl-3 text-[13px] shadow-pop',
            t.tone === 'error' ? 'bg-surface text-danger' : 'bg-ink text-surface',
          )}>
            {t.tone === 'error' ? <AlertCircle className="size-4 shrink-0" /> : <Check className="size-4 shrink-0 opacity-80" />}
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.undo && (
              <button className="rounded px-2 py-0.5 font-medium underline-offset-2 hover:underline" onClick={() => { t.undo!(); dismiss(t.id); }}>
                Undo
              </button>
            )}
            <button aria-label="Dismiss" className="rounded p-1 opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
