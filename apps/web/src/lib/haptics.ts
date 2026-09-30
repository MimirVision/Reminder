// A light tap when you tick something off. Android and desktop Chrome can vibrate from a web page; iPhone Safari cannot
// (the native app can). Silent where unsupported.
export function tap(kind: 'light' | 'success' = 'light') {
  try {
    if (!('vibrate' in navigator)) return;
    navigator.vibrate(kind === 'success' ? [12, 40, 18] : 10);
  } catch { /* not allowed */ }
}
