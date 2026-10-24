import { useEffect, useState } from 'react';

/** The current time, updated every minute and when the app comes back to the front, so "earned so far", "next shift"
 *  and today's date move on by themselves while the app stays open (also past midnight). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return now;
}
