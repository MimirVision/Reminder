// Keeping the installed app up to date. A Home Screen app on the iPhone is often resumed from memory instead of
// reloaded, so it could show an old version for days. Each time it comes to the front it fetches its own page and
// compares the script it names with the one running; when they differ, the app says so (UPDATE_EVENT) and offers a
// reload instead of reloading in the middle of something.
export const UPDATE_EVENT = 'vakt-updated';

const scriptOf = (html: string) => /\/assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null;

export function watchForUpdates() {
  const running = scriptOf(document.documentElement.outerHTML);
  if (!running) return;
  let told = false;
  const check = async () => {
    if (told || document.visibilityState !== 'visible') return;
    try {
      const res = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
      const latest = res.ok ? scriptOf(await res.text()) : null;
      if (latest && latest !== running) { told = true; window.dispatchEvent(new Event(UPDATE_EVENT)); }
    } catch { /* offline: try again next time */ }
  };
  document.addEventListener('visibilitychange', () => void check());
  window.setInterval(() => void check(), 30 * 60_000);
  void check();
}
