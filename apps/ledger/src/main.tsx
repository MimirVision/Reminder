import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { IS_ARTIFACT } from './data/config';
import './lib/install';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Installable app: the service worker caches Ledger itself (never data). Not in development or the hosted demo page.
if (import.meta.env.PROD && !IS_ARTIFACT && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => { /* works without it */ });
  });
}
