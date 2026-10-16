import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:brightness-95 shadow-soft',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-hover active:bg-sunken shadow-soft',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink active:bg-sunken',
  subtle: 'bg-sunken text-ink-2 hover:bg-hover hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-110 active:brightness-95 shadow-soft',
};
const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,box-shadow,filter] duration-100',
        'disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        VARIANT[variant], SIZE[size], className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }>(
  function IconButton({ label, className, size = 'md', type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink active:bg-sunken disabled:opacity-40',
          size === 'sm' ? 'size-6 [&_svg]:size-3.5' : 'size-8 [&_svg]:size-4',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Kbd({ children }: { children: string }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-sunken px-1 font-sans text-[10.5px] font-medium text-ink-3">{children}</kbd>;
}
