import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createController } from './core/controller.ts';
import { openStore } from './idb.ts';
import { clearBadge, hasPush, markSeen, registerWorker } from './push.ts';
import { App } from './ui/App.tsx';
import './post.css';

const kv = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: settings last for this visit only */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

async function boot() {
  (window as { __first?: boolean }).__first = history.length <= 1;
  const store = await openStore();
  // The Post server is the Supabase function next to the database Home Memory already uses, so there is nothing to type in.
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const c = createController({
    store, kv, fetch: (...a) => fetch(...a),
    serverUrl: base ? `${base}/functions/v1/post-alerts` : null,
    seen: markSeen,
    pushState: hasPush,
  });
  void registerWorker();
  void clearBadge();
  createRoot(document.getElementById('root')!).render(<StrictMode><App controller={c} /></StrictMode>);
  void c.init();
}
void boot();
