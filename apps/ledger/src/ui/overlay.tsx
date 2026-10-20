import { useState, type ReactNode } from 'react';
import { Dialog as D, DropdownMenu as M, Popover as P } from 'radix-ui';
import { Check, X } from 'lucide-react';
import { Button, IconButton } from './button';
import { cn } from './cn';

/** A centred modal dialog. */
/**
 * Escape inside a field that handles it itself (marked data-escape-local, e.g. a checklist item being edited) cancels
 * that edit instead of closing the dialog or panel around it.
 */
function keepEscapeLocal(e: KeyboardEvent) {
  if ((document.activeElement as HTMLElement | null)?.closest('[data-escape-local]')) e.preventDefault();
}

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 'max-w-lg' }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[rgb(20_20_28/0.28)]" />
        <D.Content
          className={cn('fixed top-[10vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 animate-pop-in flex-col rounded-xl bg-surface shadow-pop focus:outline-none', width)}
          onEscapeKeyDown={keepEscapeLocal}
          onOpenAutoFocus={(e) => {
            // Focus the first field rather than the close button.
            const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('input:not([type=checkbox]),textarea,select');
            if (el) { e.preventDefault(); el.focus(); }
          }}
        >
          <div className="flex items-start gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <D.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[12.5px] text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild><IconButton label="Close" size="sm" className="-mr-1"><X /></IconButton></D.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** A side panel that slides in from the right, leaving the list underneath (and its scroll position) intact. */
export function Sheet({ open, onOpenChange, title, children, width = 'w-[min(560px,100vw)]' }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-[rgb(20_20_28/0.12)]" />
        <D.Content
          className={cn('fixed inset-y-0 right-0 z-40 flex animate-slide-in flex-col bg-surface shadow-panel focus:outline-none', width)}
          onEscapeKeyDown={keepEscapeLocal}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const SheetClose = D.Close;

/** "Are you sure?" for destructive or hard-to-undo actions. */
export function Confirm({ open, onOpenChange, title, body, confirmLabel, tone = 'danger', onConfirm, children, disabled }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body: ReactNode; confirmLabel: string;
  tone?: 'danger' | 'primary'; onConfirm: () => Promise<unknown> | void; children?: ReactNode; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width="max-w-md" footer={<>
      <Button onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button variant={tone} loading={busy} disabled={disabled} onClick={async () => {
        setBusy(true);
        try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); }
      }}>{confirmLabel}</Button>
    </>}>
      <div className="text-[13px] leading-relaxed text-ink-2">{body}</div>
      {children}
    </Dialog>
  );
}

// Menus ---------------------------------------------------------------------------------------------------------

export function Menu({ trigger, children, align = 'start', label }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; label?: string }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild aria-label={label}>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={4} className="z-50 min-w-44 animate-pop-in rounded-lg bg-surface p-1 shadow-pop" onCloseAutoFocus={(e) => {
          // Back to the trigger (keyboard users keep their place), unless the chosen item moved focus somewhere on purpose.
          const a = document.activeElement as HTMLElement | null;
          if (a && a !== document.body && !a.closest('[role=menu]')) e.preventDefault();
        }}>
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

const itemCls = 'flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-ink-3';

export function MenuItem({ children, onSelect, danger, disabled, shortcut }: { children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <M.Item className={cn(itemCls, danger && 'text-danger [&_svg]:text-danger')} onSelect={onSelect} disabled={disabled}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[11.5px] text-ink-3">{shortcut}</span>}
    </M.Item>
  );
}

export function MenuCheck({ children, checked, onChange }: { children: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <M.CheckboxItem className={cn(itemCls, 'pr-6')} checked={checked} onCheckedChange={onChange} onSelect={(e) => e.preventDefault()}>
      <span className="flex size-4 items-center justify-center">{checked && <Check className="!text-accent" />}</span>
      {children}
    </M.CheckboxItem>
  );
}

export function MenuRadio<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <M.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {options.map((o) => (
        <M.RadioItem key={o.value} value={o.value} className={cn(itemCls, 'pr-6')}>
          <span className="flex size-4 items-center justify-center"><M.ItemIndicator><Check className="!text-accent" /></M.ItemIndicator></span>
          {o.label}
        </M.RadioItem>
      ))}
    </M.RadioGroup>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">{children}</M.Label>;

// Popover -------------------------------------------------------------------------------------------------------

export function Popover({ trigger, children, open, onOpenChange, align = 'start' }: {
  trigger: ReactNode; children: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: 'start' | 'center' | 'end';
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={4} collisionPadding={12} className="z-50 animate-pop-in rounded-lg bg-surface shadow-pop focus:outline-none">
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
