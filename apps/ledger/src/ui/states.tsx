import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export function EmptyState({ icon: Icon, title, body, action, compact }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 py-6' : 'gap-2 py-14')}>
      <div className={cn('flex items-center justify-center rounded-full bg-sunken text-ink-3', compact ? 'size-8' : 'size-10')}>
        <Icon className={compact ? 'size-4' : 'size-5'} strokeWidth={1.8} />
      </div>
      <p className="mt-1 text-[13.5px] font-medium text-ink">{title}</p>
      {body && <p className="max-w-sm text-[12.5px] text-ink-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A calm one-line "nothing here" for sections of a page. */
export function QuietLine({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-ink-3">
      <Icon className="size-4 text-ok" strokeWidth={2} />
      {children}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-4 px-3">
          <div className="skeleton size-4 rounded-full" />
          <div className="skeleton h-3" style={{ width: `${30 + ((i * 37) % 30)}%` }} />
          <div className="skeleton ml-auto h-3 w-24" />
          <div className="skeleton h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8" aria-busy="true" aria-label="Loading">
      <div className="skeleton mb-2 h-6 w-56" />
      <div className="skeleton mb-8 h-3.5 w-40" />
      <div className="mb-8 grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}</div>
      <div className="rounded-lg border border-line bg-surface"><SkeletonRows rows={8} /></div>
    </div>
  );
}
