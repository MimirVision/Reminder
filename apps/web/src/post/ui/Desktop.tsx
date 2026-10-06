import { useEffect, useState } from 'react';
import { mailCounts, visibleThreads, type State, type View } from '../core/controller.ts';
import { accountColour } from '../core/settings.ts';
import { SHORTCUT_HELP, shortcutFor } from '../core/shortcuts.ts';
import { replyTarget, type Thread } from '../core/threads.ts';
import { KIND_TAB, mailKey } from '../core/types.ts';
import { Compose } from './Compose.tsx';
import { Inbox, SnoozeSheet } from './Inbox.tsx';
import { Later, Search } from './SearchLater.tsx';
import { Reader } from './Reader.tsx';
import { Triage } from './Triage.tsx';
import { SettingsPage } from './Settings.tsx';
import { AccountsSheet } from './Accounts.tsx';
import { Icon, KIND_ICON, Mark, Sheet } from './ui.tsx';
import { go, resolveAccount, useC, useNow, useRoute } from './ctx.tsx';

/** The computer layout: a sidebar, the message list, and the reading pane side by side. The same screens as on the phone, just in panes. */
export function Desktop({ s, onAdd }: { s: State; onAdd: (hint?: string) => void }) {
  const c = useC();
  const route = useRoute();
  const now = useNow();
  const [help, setHelp] = useState(false);
  const [snoozing, setSnoozing] = useState<Thread | null>(null);

  // The list is a row per conversation, and the keys act on the whole conversation of the row that is open.
  const list = visibleThreads(s, now);
  const open = route.name === 'message' ? mailKey(resolveAccount(s, route.account), route.id) : null;
  const idx = open ? list.findIndex((t) => t.items.some((m) => m.key === open)) : -1;
  const current = idx >= 0 ? list[idx] : undefined;
  const openMail = (t?: Thread) => { if (t) go({ name: 'message', account: t.latest.account, id: t.latest.id }); };

  // Keyboard: j and k move through the list, e archives, and so on. Ignored while typing, and while a sheet is open.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === 'Enter' && t && /^(BUTTON|A)$/.test(t.tagName)) return;
      const a = shortcutFor({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, typing, sheetOpen: !!document.querySelector('.sheet, .viewer') });
      if (!a) return;
      switch (a) {
        case 'next': openMail(idx >= 0 ? list[idx + 1] ?? list[idx] : list[0]); break;
        case 'prev': openMail(idx > 0 ? list[idx - 1] : list[0]); break;
        case 'open': if (!current) openMail(list[0]); else return; break;
        case 'archive': { if (!current) return; void c.archive(current.items, 1); openMail(list[idx + 1] ?? list[idx - 1]); if (!list[idx + 1] && !list[idx - 1]) go({ name: 'inbox' }); break; }
        case 'delete': { if (!current) return; void c.trash(current.items, 1); openMail(list[idx + 1] ?? list[idx - 1]); if (!list[idx + 1] && !list[idx - 1]) go({ name: 'inbox' }); break; }
        case 'reply': case 'replyAll': if (!current) return; go({ name: 'compose', mode: a, account: current.account, id: (replyTarget(current.items) ?? current.latest).id }); break;
        case 'compose': go({ name: 'compose', mode: 'new' }); break;
        case 'search': go({ name: 'search', q: '' }); break;
        case 'close': if (document.querySelector('.sheet, .viewer')) return; /* the sheet or the file viewer closes itself */ if (route.name !== 'inbox') go({ name: 'inbox' }); else return; break;
        case 'unread': if (!current) return; void c.toggleRead(current.items); break;
        case 'flag': if (!current) return; void c.toggleFlag(current.items); break;
        case 'snooze': if (!current) return; setSnoozing(current); break;
        case 'undo': { const u = s.toast?.undo; if (!u) return; u(); break; }
        case 'refresh': void c.sync(); break;
        case 'help': setHelp(true); break;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [c, list, idx, current, route.name, help, s.toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const full = route.name === 'settings' || route.name === 'triage';
  return (
    <div className="dsk">
      <Sidebar s={s} onAdd={onAdd} onHelp={() => setHelp(true)} />
      {full ? (
        <main className="dsk-full">
          {route.name === 'triage' ? <Triage s={s} /> : route.name === 'settings' ? <SettingsPage s={s} page={route.page} account={route.account} /> : null}
        </main>
      ) : (
        <>
          <section className="dsk-list" aria-label="Messages">
            {route.name === 'search' ? <Search s={s} q={route.q} pane /> : route.name === 'later' ? <Later s={s} pane /> : <Inbox s={s} pane />}
          </section>
          <main className="dsk-main">
            {route.name === 'message' ? <Reader s={s} account={route.account} id={route.id} pane key={open ?? ''} />
              : route.name === 'compose' ? <Compose s={s} mode={route.mode} account={route.account} id={route.id} />
                : <EmptyPane s={s} />}
          </main>
        </>
      )}
      {route.name === 'accounts' && <AccountsSheet s={s} onAdd={onAdd} onClose={() => go({ name: 'inbox' })} />}
      {snoozing && <SnoozeSheet onClose={() => setSnoozing(null)} onPick={(at, label) => { void c.snooze(snoozing.items, at, label); setSnoozing(null); }} />}
      {help && (
        <Sheet title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <div className="card">{SHORTCUT_HELP.map(([k, t]) => <div key={k} className="it"><kbd>{k}</kbd><span className="v">{t}</span></div>)}</div>
        </Sheet>
      )}
    </div>
  );
}

function Sidebar({ s, onAdd, onHelp }: { s: State; onAdd: (hint?: string) => void; onHelp: () => void }) {
  const c = useC();
  const route = useRoute();
  const now = useNow();
  const emails = s.accounts.map((a) => a.email);
  // The numbers are what is waiting in Primary (for a mailbox: its Primary). Promotions and receipts show their own numbers in their own tabs.
  const unreadOf = (email: string | null) => mailCounts({ mail: s.mail, accountFilter: email, settings: s.settings }, now).byKind.person.unread;
  const counts = mailCounts({ mail: s.mail, accountFilter: s.accountFilter, settings: s.settings }, now);
  const inbox = route.name === 'inbox' || route.name === 'message' || route.name === 'compose' || route.name === 'accounts';
  const nav = (active: boolean, icon: string, text: string, onClick: () => void, badge?: number) => (
    <button className={`sb-it${active ? ' on' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><Icon n={icon} size={20} />{text}{badge ? <span className="sb-n">{badge > 99 ? '99+' : badge}</span> : null}</button>
  );
  const tab = (v: View, icon: string, text: string, n: number) => nav(inbox && s.view === v, icon, text, () => { c.setView(v); go({ name: 'inbox' }); }, n);
  return (
    <aside className="sb" aria-label="Post">
      <div className="sb-brand"><span className="sb-mark"><Mark size={22} /></span><b>Post</b></div>
      <button className="cta sb-compose" onClick={() => go({ name: 'compose', mode: 'new' })}><Icon n="edit" size={18} />New message</button>
      <nav className="sb-nav" aria-label="Inbox">
        {tab('person', KIND_ICON.person, KIND_TAB.person, counts.byKind.person.unread)}
        {tab('transaction', KIND_ICON.transaction, KIND_TAB.transaction, counts.byKind.transaction.unread)}
        {tab('update', KIND_ICON.update, KIND_TAB.update, counts.byKind.update.unread)}
        {tab('promo', KIND_ICON.promo, KIND_TAB.promo, counts.byKind.promo.unread)}
        {tab('all', 'inbox', 'All mail', 0)}
      </nav>
      <nav className="sb-nav sb-gap" aria-label="Main">
        {nav(route.name === 'search', 'search', 'Search', () => go({ name: 'search', q: '' }))}
        {nav(route.name === 'later', 'clock', 'Later', () => go({ name: 'later' }))}
        {nav(route.name === 'triage', 'check', 'Triage mode', () => go({ name: 'triage' }))}
      </nav>
      <div className="sb-h">Accounts</div>
      <nav className="sb-nav" aria-label="Accounts">
        <button className={`sb-it${s.accountFilter === null ? ' on' : ''}`} onClick={() => { c.setAccountFilter(null); if (route.name !== 'inbox') go({ name: 'inbox' }); }}><span className="sb-dot" style={{ background: 'var(--ink)' }} />All accounts</button>
        {s.accounts.map((a) => (
          <button key={a.email} className={`sb-it${s.accountFilter === a.email ? ' on' : ''}`} onClick={() => { if (a.needsSignIn) onAdd(a.email); else { c.setAccountFilter(a.email); if (route.name !== 'inbox') go({ name: 'inbox' }); } }} title={a.email}>
            <span className="sb-dot" style={{ background: accountColour(a.email, emails, s.settings.accountColours) }} />
            <span className="sb-t">{a.label}{a.needsSignIn && <small>Sign in again</small>}</span>{unreadOf(a.email) ? <span className="sb-n">{unreadOf(a.email)}</span> : null}
          </button>
        ))}
        <button className="sb-it quiet" onClick={() => onAdd()}><Icon n="plus" size={18} />Add account</button>
        <button className="sb-it quiet" onClick={() => go({ name: 'accounts' })}><Icon n="user" size={18} />Manage accounts</button>
      </nav>
      <div className="sb-sp" />
      <div className="sb-foot">
        {nav(route.name === 'settings', 'sliders', 'Settings', () => go({ name: 'settings', page: '' }))}
        <button className="sb-it quiet" onClick={onHelp}><Icon n="more" size={18} />Keyboard shortcuts<kbd>?</kbd></button>
        <p className="sb-sync">{s.sync.running ? 'Updating…' : !s.online ? 'Offline' : s.sync.at ? 'Up to date' : ''}</p>
      </div>
    </aside>
  );
}

function EmptyPane({ s }: { s: State }) {
  const now = useNow();
  const counts = mailCounts({ mail: s.mail, accountFilter: s.accountFilter, settings: s.settings }, now);
  const unread = s.view === 'all' ? counts.unread : counts.byKind[s.view].unread;
  return (
    <div className="dsk-empty">
      <div className="mark"><Mark size={44} /></div>
      <h2 className="h2">{unread ? `${unread} unread${s.view === 'all' ? '' : ` in ${KIND_TAB[s.view]}`}` : 'All caught up'}</h2>
      <p>Choose a message to read it. <kbd>j</kbd> and <kbd>k</kbd> move through the list, <kbd>e</kbd> archives, <kbd>?</kbd> shows every shortcut.</p>
    </div>
  );
}
