import { mailCounts, type State } from '../core/controller.ts';
import { Icon } from './ui.tsx';
import { go, useNow } from './ctx.tsx';

/** Tapping the tab you are already on takes the list back to the top (the habit from every iPhone app). */
function toTop() {
  const el = document.querySelector('.pg > .scroll') as HTMLElement | null;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el?.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
}

export function Tabs({ at, s }: { at: 'inbox' | 'folders' | 'search' | 'later'; s: State }) {
  const now = useNow();
  // The number is what is waiting in Primary: promotions and receipts have their own tabs and do not count against you here.
  const unread = mailCounts({ mail: s.mail, accountFilter: null, settings: s.settings }, now).byKind.person.unread;
  return (
    <nav className="tabs" aria-label="Main">
      <button className={`tab${at === 'inbox' ? ' on' : ''}`} aria-current={at === 'inbox' ? 'page' : undefined} onClick={() => (at === 'inbox' ? toTop() : go({ name: 'inbox' }))}><Icon n="inbox" />Inbox{unread > 0 && <span className="bdg">{unread > 99 ? '99+' : unread}</span>}</button>
      <button className={`tab${at === 'folders' ? ' on' : ''}`} aria-current={at === 'folders' ? 'page' : undefined} onClick={() => (at === 'folders' ? toTop() : go({ name: 'folders' }))}><Icon n="folder" />Folders</button>
      <button className={`tab${at === 'search' ? ' on' : ''}`} aria-current={at === 'search' ? 'page' : undefined} onClick={() => go({ name: 'search', q: '' })}><Icon n="search" />Search</button>
      <button className={`tab${at === 'later' ? ' on' : ''}`} aria-current={at === 'later' ? 'page' : undefined} onClick={() => (at === 'later' ? toTop() : go({ name: 'later' }))}><Icon n="clock" />Later</button>
    </nav>
  );
}
