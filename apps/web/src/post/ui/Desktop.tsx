import { useEffect, useState } from 'react';
import { folderKey, mailCounts, visibleThreads, type State, type View } from '../core/controller.ts';
import { DELETE_WAY, placeActions } from '../core/folders.ts';
import { accountColour } from '../core/settings.ts';
import { SHORTCUT_HELP, shortcutFor } from '../core/shortcuts.ts';
import { replyTarget } from '../core/threads.ts';
import { KIND_TAB, mailKey, type Mail } from '../core/types.ts';
import { Compose } from './Compose.tsx';
import { FolderList, SidebarFolders } from './Folders.tsx';
import { Inbox } from './Inbox.tsx';
import { moveWay } from './Move.tsx';
import { Later, Search } from './SearchLater.tsx';
import { Reader } from './Reader.tsx';
import { Triage } from './Triage.tsx';
import { SettingsPage } from './Settings.tsx';
import { AccountsSheet } from './Accounts.tsx';
import { Icon, KIND_ICON, Mark, Sheet } from './ui.tsx';
import { folderContext, folderTitle, go, openMail as openItem, resolveAccount, routeOfFolder, targetOfRoute, useC, useNow, useRoute } from './ctx.tsx';

/** The computer layout: a sidebar, the message list, and the reading pane side by side. The same screens as on the phone, just in panes. */
export function Desktop({ s, onAdd }: { s: State; onAdd: (hint?: string) => void }) {
  const c = useC();
  const route = useRoute();
  const now = useNow();
  const [help, setHelp] = useState(false);

  // What the list shows, and what the keys move through: a folder (when it is open, or holds the message that is), or the inbox (a row per conversation).
  const open = route.name === 'message' ? mailKey(resolveAccount(s, route.account), route.id) : null;
  const inInbox = !!open && s.mail.some((m) => m.key === open);
  const view = route.name === 'folder' ? (s.folder?.key === folderKey(targetOfRoute(route)) ? s.folder : null) : inInbox ? null : folderContext(s, open);
  const inFolder = route.name === 'folder' || (route.name === 'message' && !!view);
  const list = visibleThreads(s, now);
  const rows = inFolder ? view?.items ?? [] : [];
  const idx = !open ? -1 : inFolder ? rows.findIndex((m) => m.key === open) : list.findIndex((t) => t.items.some((m) => m.key === open));
  const size = inFolder ? rows.length : list.length;
  const at = (i: number): Mail | undefined => (inFolder ? rows[i] : list[i]?.latest);
  const currentMail = idx >= 0 ? at(idx) : undefined;
  const current = !inFolder && idx >= 0 ? list[idx] : undefined; // the conversation of the inbox that is open
  const home = inFolder && view ? routeOfFolder(view.target) : { name: 'inbox' as const };

  // Keyboard: j and k move through the list, e archives, and so on. Ignored while typing, and while a sheet is open.
  useEffect(() => {
    const goNext = () => { const n = at(idx + 1) ?? at(idx - 1); if (n) openItem(n); else go(home); }; // after a message has left the list
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === 'Enter' && t && /^(BUTTON|A)$/.test(t.tagName)) return;
      const a = shortcutFor({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, typing, sheetOpen: !!document.querySelector('.sheet, .viewer') });
      if (!a) return;
      switch (a) {
        case 'next': { const n = idx >= 0 ? at(idx + 1) ?? at(idx) : at(0); if (n) openItem(n); break; }
        case 'prev': { const n = idx > 0 ? at(idx - 1) : at(0); if (n) openItem(n); break; }
        case 'open': if (!currentMail) { const n = at(0); if (n) openItem(n); } else return; break;
        case 'archive': {
          if (inFolder) { // the button of the folder it is in: Archive for a sent message, Inbox for an archived one ...
            const w = currentMail ? placeActions(currentMail.fk ?? view?.target.kind ?? 'unknown').primary : null;
            if (!currentMail || !w) return;
            void moveWay(c, [currentMail], w); goNext(); break;
          }
          if (!current) return; void c.archive(current.items, 1); goNext(); break;
        }
        case 'delete': {
          if (inFolder) {
            if (!currentMail || !placeActions(currentMail.fk ?? view?.target.kind ?? 'unknown').canDelete) return;
            void moveWay(c, [currentMail], DELETE_WAY); goNext(); break;
          }
          if (!current) return; void c.trash(current.items, 1); goNext(); break;
        }
        case 'reply': case 'replyAll': {
          if (inFolder) { if (!currentMail) return; go({ name: 'compose', mode: a, account: currentMail.account, id: currentMail.id }); break; }
          if (!current) return; go({ name: 'compose', mode: a, account: current.account, id: (replyTarget(current.items) ?? current.latest).id }); break;
        }
        case 'compose': go({ name: 'compose', mode: 'new' }); break;
        case 'search': go({ name: 'search', q: '' }); break;
        case 'close':
          if (document.querySelector('.sheet, .viewer')) return; /* the sheet or the file viewer closes itself */
          if (route.name === 'message' && inFolder) go(home);
          else if (route.name === 'compose' && route.mode === 'draft' && s.folder?.target.kind === 'drafts') go(routeOfFolder(s.folder.target));
          else if (route.name !== 'inbox' && route.name !== 'folder') go({ name: 'inbox' });
          else return;
          break;
        case 'unread': if (inFolder) { if (!currentMail) return; void c.toggleRead([currentMail]); } else { if (!current) return; void c.toggleRead(current.items); } break;
        case 'flag': if (inFolder) { if (!currentMail) return; void c.toggleFlag([currentMail]); } else { if (!current) return; void c.toggleFlag(current.items); } break;
        case 'undo': { const u = s.toast?.undo; if (!u) return; u(); break; }
        case 'refresh': void c.sync(); if (inFolder) void c.refreshFolder(); break;
        case 'help': setHelp(true); break;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [c, list, rows, idx, size, current, currentMail, inFolder, route.name, help, s.toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const full = route.name === 'settings' || route.name === 'triage';
  // The list pane follows the message or the draft that is open: a message read from Sent keeps Sent in the list, a draft keeps Drafts.
  const draftsOpen = route.name === 'compose' && route.mode === 'draft' && s.folder?.target.kind === 'drafts' ? s.folder.target : null;
  const folderPane = route.name === 'folder' ? targetOfRoute(route) : route.name === 'message' && view ? view.target : draftsOpen;
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
            {folderPane ? <FolderList s={s} target={folderPane} pane /> : route.name === 'search' ? <Search s={s} q={route.q} pane /> : route.name === 'later' ? <Later s={s} pane /> : <Inbox s={s} pane />}
          </section>
          <main className="dsk-main">
            {route.name === 'message' ? <Reader s={s} account={route.account} id={route.id} pane key={open ?? ''} />
              : route.name === 'compose' ? <Compose s={s} mode={route.mode} account={route.account} id={route.id} key={`${route.mode}|${route.account ?? ''}|${route.id ?? ''}`} />
                : <EmptyPane s={s} folder={route.name === 'folder' ? folderTitle(s, targetOfRoute(route)) : null} />}
          </main>
        </>
      )}
      {route.name === 'accounts' && <AccountsSheet s={s} onAdd={onAdd} onClose={() => go({ name: 'inbox' })} />}
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
  // The folder that is open (or the one the open message or draft was opened from), so its row in the sidebar shows where you are.
  const open = route.name === 'message' ? mailKey(resolveAccount(s, route.account), route.id) : null;
  const folder = route.name === 'folder' ? folderKey(targetOfRoute(route))
    : route.name === 'message' && !s.mail.some((m) => m.key === open) ? folderContext(s, open)?.key ?? null
      : route.name === 'compose' && route.mode === 'draft' && s.folder?.target.kind === 'drafts' ? s.folder.key : null;
  const inbox = !folder && (route.name === 'inbox' || route.name === 'folders' || route.name === 'message' || route.name === 'compose' || route.name === 'accounts');
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
      <SidebarFolders s={s} active={folder} />
      <nav className="sb-nav sb-gap" aria-label="Main">
        {nav(route.name === 'search', 'search', 'Search', () => go({ name: 'search', q: '' }))}
        {nav(route.name === 'later', 'clock', 'Later', () => go({ name: 'later' }))}
        {nav(route.name === 'triage', 'cards', 'Triage mode', () => go({ name: 'triage' }))}
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

function EmptyPane({ s, folder }: { s: State; folder: string | null }) {
  const now = useNow();
  const counts = mailCounts({ mail: s.mail, accountFilter: s.accountFilter, settings: s.settings }, now);
  const unread = s.view === 'all' ? counts.unread : counts.byKind[s.view].unread;
  return (
    <div className="dsk-empty">
      <div className="mark"><Mark size={44} /></div>
      <h2 className="h2">{folder ?? (unread ? `${unread} unread${s.view === 'all' ? '' : ` in ${KIND_TAB[s.view]}`}` : 'All caught up')}</h2>
      <p>Choose a message to read it. <kbd>j</kbd> and <kbd>k</kbd> move through the list, <kbd>e</kbd> archives, <kbd>?</kbd> shows every shortcut.</p>
    </div>
  );
}
