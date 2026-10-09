import type { Mail } from '../core/types.ts';

// The search you were in, kept while you read a result and come back (or, on a computer, while the result is open next to the list). It is dropped as soon
// as you go anywhere that is not a search, a message or a reply, so a new visit to Search starts empty. Nothing is saved; a reload starts fresh.
let kept: { q: string; remote: Mail[] | null } | null = null;

export const searchKept = () => kept;
export function keepSearch(q: string, remote: Mail[] | null) { kept = q.trim() ? { q, remote } : null; }
export const dropSearch = () => { kept = null; };
