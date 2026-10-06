import { mailCounts, type State } from '../core/controller.ts';
import { Icon } from './ui.tsx';
import { go, useNow } from './ctx.tsx';

export function Tabs({ at, s }: { at: 'inbox' | 'search' | 'later'; s: State }) {
  const now = useNow();
  // The number is what is waiting in Primary: promotions and receipts have their own tabs and do not count against you here.
  const unread = mailCounts({ mail: s.mail, accountFilter: null, settings: s.settings }, now).byKind.person.unread;
  return (
    <nav className="tabs" aria-label="Main">
      <button className={`tab${at === 'inbox' ? ' on' : ''}`} aria-current={at === 'inbox' ? 'page' : undefined} onClick={() => go({ name: 'inbox' })}><Icon n="inbox" />Inbox{unread > 0 && <span className="bdg">{unread > 99 ? '99+' : unread}</span>}</button>
      <button className={`tab${at === 'search' ? ' on' : ''}`} aria-current={at === 'search' ? 'page' : undefined} onClick={() => go({ name: 'search', q: '' })}><Icon n="search" />Search</button>
      <button className={`tab${at === 'later' ? ' on' : ''}`} aria-current={at === 'later' ? 'page' : undefined} onClick={() => go({ name: 'later' })}><Icon n="clock" />Later</button>
    </nav>
  );
}
