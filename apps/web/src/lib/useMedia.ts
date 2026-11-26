import { useEffect, useState } from 'react';

/** Follows a CSS media query (for example a very wide window). */
export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return on;
}

/** A window wide enough for the overview board (several columns of panels). */
export const WIDE_QUERY = '(min-width: 1800px)';
