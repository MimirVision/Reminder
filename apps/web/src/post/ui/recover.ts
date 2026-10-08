import { plain } from '../core/diag.ts';

// Ways out that work even when the app itself does not: starting over, and a plain screen for when nothing else can be drawn.
// Nothing here touches mail. (The service worker is never removed: that would also remove the phone's alert subscription.)

/** Starts Post over: forgets the saved copy of the app's own files and loads them again from the internet. Your mail is not touched. */
export async function reloadPost(): Promise<void> {
  try {
    const keys = await Promise.race([caches.keys(), new Promise<string[]>((r) => setTimeout(() => r([]), 3000))]);
    await Promise.all(keys.filter((k) => k.startsWith('post-shell')).map((k) => caches.delete(k)));
  } catch { /* nothing saved, or the browser would not say: loading again is still worth it */ }
  try { void navigator.serviceWorker?.getRegistration('/post/').then((r) => r?.update()).catch(() => {}); } catch { /* ignore */ }
  location.reload();
}

/** Copies text; false when the browser would not let it. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

type Kid = string | Node;
function h(tag: string, attrs: Record<string, string>, ...kids: Kid[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

/**
 * Shown when Post could not even start (or when drawing it failed so badly that the normal crash screen could not be drawn). Built from plain
 * page elements, no React, so that it can be used when React is the problem.
 */
export function showFatal(what: unknown, root: HTMLElement | null = document.getElementById('root')): void {
  if (!root) return;
  const details = plain(what);
  const again = h('button', { type: 'button', class: 'cta' }, 'Try again');
  again.addEventListener('click', () => { again.setAttribute('disabled', ''); void reloadPost(); });
  const copy = h('button', { type: 'button', class: 'alt' }, 'Copy details');
  const said = h('p', { class: 'auth-fine', role: 'status' });
  copy.addEventListener('click', () => {
    void copyText(`Post could not start\n${navigator.userAgent}\n${details}`).then((ok) => { said.textContent = ok ? 'Copied.' : 'Press and hold the text above to copy it.'; });
  });
  root.replaceChildren(
    h('div', { class: 'post', style: 'overflow-y:auto' },
      h('div', { class: 'crash' },
        h('h1', { class: 'h2' }, 'Post could not start'),
        h('p', { class: 'crash-tag' }, 'Your mail is safe in Outlook, and anything that was waiting to be sent is still saved on this phone. Trying again usually fixes this.'),
        h('div', { class: 'code' }, details),
        again, copy, said,
      ),
    ),
  );
}
