import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createController, type Controller } from './core/controller.ts';
import { openStore } from './idb.ts';
import { clearBadge, hasPush, markSeen, registerWorker } from './push.ts';
import { App } from './ui/App.tsx';
import { showFatal } from './ui/recover.ts';
import './post.css';

const kv = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: settings last for this visit only */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

async function boot() {
  (window as { __first?: boolean }).__first = history.length <= 1;
  // Whatever goes wrong before there is a controller to write it down in waits here until there is one.
  let ctl: Controller | null = null;
  const waiting: Array<(c: Controller) => void> = [];
  const tell = (fn: (c: Controller) => void) => { if (ctl) fn(ctl); else waiting.push(fn); };
  window.addEventListener('error', (e) => tell((c) => c.crashed('error', e.error ?? e.message)));
  window.addEventListener('unhandledrejection', (e) => tell((c) => c.crashed('promise', e.reason)));

  const store = await openStore((kind, e) => tell((c) => c.note(kind, e)));
  // Ask the phone to keep Post's copy of the mail rather than clear it when it is short of room. It may say no; the Health page shows what it said.
  try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
  // The Post server is the Supabase function next to the database Home Memory already uses, so there is nothing to type in.
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const c = createController({
    store, kv, fetch: (...a) => fetch(...a),
    serverUrl: base ? `${base}/functions/v1/post-alerts` : null,
    // Files over 3 MB go to Outlook in slices; if the browser may not do that itself, this site's own server passes them on (worker/upload-relay.js).
    uploadRelay: new URL('/api/post-upload', location.origin).href,
    seen: markSeen,
    pushState: hasPush,
  });
  ctl = c;
  for (const fn of waiting.splice(0)) fn(c);
  void registerWorker();
  void clearBadge();
  // Both crash screens are in the app (see ui/Crash.tsx); this is the last resort, for when even those could not be drawn.
  createRoot(document.getElementById('root')!, { onUncaughtError: (e) => { c.note('screen', e); showFatal(e); } }).render(<StrictMode><App controller={c} /></StrictMode>);
  void c.init();
}
boot().catch((e) => showFatal(e));
