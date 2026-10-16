import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

const control = 'w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-100 hover:border-ink-3/50 focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus:ring-danger/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, 'h-8', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-20 resize-y py-2 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(control, 'h-8 appearance-none pr-8')} {...rest}>{children}</select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
    </div>
  );
});

/** A labelled form row with optional hint and error. The control gets the id via render prop. */
export function Field({ label, hint, error, children, className }: {
  label: string; hint?: ReactNode; error?: string | null; className?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[12.5px] font-medium text-ink-2">{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? <p id={`${id}-err`} className="text-[12px] text-danger">{error}</p>
        : hint ? <p id={`${id}-hint`} className="text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5', disabled && 'cursor-default opacity-50')}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--c-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col">
        <span className="text-[13px] text-ink">{label}</span>
        {description && <span className="text-[12px] text-ink-3">{description}</span>}
      </span>
    </label>
  );
}

/** A compact segmented control (Month | Week, List | Board …). */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-md bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-[5px] px-3 text-[12.5px] font-medium transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-soft' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
