import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { watchForUpdates } from './lib/update';
import { watchTheme } from './lib/theme';

watchTheme();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Installable app: the service worker caches Vakt itself (never data). Not in development.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => { /* works without it */ });
  });
  watchForUpdates();
}
