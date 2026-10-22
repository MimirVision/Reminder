import { useEffect, useState } from 'react';

/** True on a laptop or desktop sized window (1000 px or wider): the layout with a side bar and two columns. */
export const DESKTOP_QUERY = '(min-width: 1000px)';

export function useDesktop(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setOn(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return on;
}
