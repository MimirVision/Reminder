import { useEffect, useMemo, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import { visibleThreads } from '../core/controller.ts';
import { displayName, shortTime } from '../core/format.ts';
import { DELETE_WAY, FOLDER_ICON, FOLDER_NAME, placeActions, type Way } from '../core/folders.ts';
import { toBase64 } from '../core/graph.ts';
import { BLANK_PICTURE, frameDocument, hasRemoteImages, inlineCids, textToHtml } from '../core/html.ts';
import { parseUnsubscribe, type Unsub } from '../core/unsubscribe.ts';
import { isFreemail, orgDomain, ruleFor } from '../core/classify.ts';
import { isMine, looksLikeReply, replyTarget, threadKey, threadOf } from '../core/threads.ts';
import { KIND_ONE, KIND_TAB, KINDS, mailKey, type FolderKind, type Mail, type MailBody } from '../core/types.ts';
import { Avatar, Icon, KIND_ICON, Sheet, Switch } from './ui.tsx';
import { MoveSheet, moveWay } from './Move.tsx';
import { RemindSheet } from './Remind.tsx';
import { back, folderContext, folderTitle, go, labelOf, openMail, routeOfFolder, useBadge, useC, useDark, useNow, useRoomyPane } from './ctx.tsx';
import { copyText } from './clipboard.ts';
import { FileList } from './Attachments.tsx';
import { BlockSheet, SweepSheet } from './SenderSheets.tsx';
import { canMute } from '../core/tidy.ts';

function Frame({ html, remote, dark }: { html: string; remote: boolean; dark: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => frameDocument(html, { remoteImages: remote, dark }), [html, remote, dark]);
  const fit = () => { const d = ref.current?.contentDocument; if (d && ref.current) ref.current.style.height = `${Math.max(80, d.documentElement.scrollHeight)}px`; };
  useEffect(() => { const t = setTimeout(fit, 150); return () => clearTimeout(t); }, [doc]);
  return <iframe ref={ref} className="frame" title="Message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc} onLoad={fit} />;
}

const toDataUri = (bytes: Uint8Array, type: string) => `data:${type};base64,${toBase64(bytes)}`;

/** Pictures inside a message, remembered while Post is open so going back and forth between messages does not fetch them again. */
const picturesSeen = new Map<string, { cids: Record<string, string>; embedded: string[] }>();

const newestFirst = (a: Mail, b: Mail) => b.received.localeCompare(a.received);
const NONE: ReadonlySet<string> = new Set();
/** Which messages of a conversation you turned over (opened one that was folded, folded one that was open), kept while Post is open: coming back from writing a reply finds the conversation as you left it. */
const turned = new Map<string, ReadonlySet<string>>();

type Found = { ck: string; items: Mail[]; state: 'loading' | 'done' | 'failed' };
/** A message that was asked of Outlook because Post had not seen it (a link kept from earlier, a message another app moved). */
type Asked = { key: string; state: 'looking' | 'done' | 'failed'; mail: Mail | null; error?: string };

/**
 * A message, and the conversation it is part of. The newest message is open and the older ones are folded up under it, each one a tap
 * away; your own replies are in it too. Archiving and the rest reach every message of the conversation that is in the inbox.
 * A message that is not in the inbox (opened from a folder, a search or a link) is one message here: what you do reaches it alone, and the
 * buttons are the ones that fit where it is (Archive for a sent message, Inbox for an archived one, Not junk, Restore).
 */
export function Reader({ s, account, id, pane = false }: { s: State; account: string; id: string; pane?: boolean }) {
  const c = useC();
  const now = useNow();
  const roomy = useRoomyPane();
  const acct = s.accounts.find((a) => a.id === account || a.email === account);
  const email = acct?.email ?? account;
  const key = mailKey(email, id);
  const here = s.mail.find((x) => x.key === key);
  const view = folderContext(s, key); // the folder this message was opened from, when it is the one that is open
  const [asked, setAsked] = useState<Asked | null>(null);
  const [again, setAgain] = useState(0);
  // In the inbox on this phone, or only seen in Outlook (a folder, an older message of a conversation, a search result, a link).
  const m = here ?? view?.items.find((x) => x.key === key) ?? c.remoteMail(email, id) ?? (asked?.key === key ? asked.mail ?? undefined : undefined);
  const far = !here;
  const grouped = s.settings.threads;
  const badge = useBadge(s)(email);
  const [found, setFound] = useState<Found | null>(null);
  const [flip, setFlip] = useState<{ key: string; keys: ReadonlySet<string> }>({ key: '', keys: NONE });
  const [sheet, setSheet] = useState<null | 'more' | 'why' | 'remind' | 'move' | 'block' | 'sweep'>(null);
  const [anchorBody, setAnchorBody] = useState<{ key: string; body: MailBody } | null>(null);
  const [retry, setRetry] = useState(0);
  const forceNext = useRef(false);
  const waited = useRef(false);
  const sentSeen = useRef(s.sent);
  const ck = m ? threadKey(m) : '';

  // A notification can arrive before this phone has synced: sync once, then look for it. A message that is not in the inbox (moved to another folder,
  // archived on another device) is asked of Outlook by its address.
  useEffect(() => {
    if (m || !s.ready || !acct) return;
    let live = true;
    setAsked({ key, state: 'looking', mail: null });
    (async () => {
      if (!waited.current) { waited.current = true; await c.sync(); }
      return c.findMail(email, id);
    })().then(
      (mail) => { if (live) setAsked({ key, state: 'done', mail }); },
      (e) => { if (live) setAsked({ key, state: 'failed', mail: null, error: e instanceof Error && e.message ? e.message : 'Could not open this message.' }); },
    );
    return () => { live = false; };
  }, [key, s.ready, !!acct, again]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which folder a message is in decides which buttons it gets, so the folders are listed (from the phone's copy at once, and from Outlook when they are old).
  useEffect(() => { if (far && m) void c.loadFolders(); }, [far, !!m]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rest of the conversation comes from Outlook: your replies, and anything archived or older than this phone keeps. Asked in the
  // background; the message is already on the screen.
  useEffect(() => {
    if (!m || !grouped || !m.conversationId) return;
    let live = true;
    const force = forceNext.current; forceNext.current = false;
    setFound((f) => ({ ck, items: f?.ck === ck ? f.items : [], state: 'loading' }));
    c.loadConversation(m, { force }).then(
      (items) => { if (live) setFound({ ck, items, state: 'done' }); },
      () => { if (live) setFound((f) => ({ ck, items: f?.ck === ck ? f.items : [], state: 'failed' })); },
    );
    return () => { live = false; };
  }, [m?.key, grouped, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Something you wrote has just gone out: a moment later it is in Sent Items, so the conversation is asked for again to show it.
  useEffect(() => {
    if (s.sent === sentSeen.current) return;
    sentSeen.current = s.sent;
    const t = setTimeout(() => { forceNext.current = true; setRetry((n) => n + 1); }, 2500);
    return () => clearTimeout(t);
  }, [s.sent]);

  const extras = found && found.ck === ck ? found.items : [];
  const looking = found && found.ck === ck ? found.state : 'idle';
  const flipped = flip.key === key ? flip.keys : turned.get(key) ?? NONE;

  const local = m ? threadOf(s.mail, m, grouped) : []; // what is in the inbox on this phone, newest first
  const all: Mail[] = [];
  if (m) {
    const have = new Set(local.map((x) => x.key));
    // The message that is open is the one the screen has now: the copy the conversation lookup brought of it is older (it would show a flag that was taken off).
    all.push(...local, ...extras.filter((x) => !have.has(x.key) && x.key !== m.key));
    if (!all.some((x) => x.key === m.key)) all.push(m);
    all.sort(newestFirst);
  }
  const many = all.length > 1;
  const target = replyTarget(all) ?? m;
  const canTriage = !far && local.length > 0;

  // Next and previous follow the list you came from: the folder, or the tab of the inbox. Reading a message must not drop it from "unread only" while you are still on it.
  const rows = far && view ? view.items : null;
  const list = rows ? [] : visibleThreads({ ...s, unreadOnly: false }, now);
  const idx = rows ? rows.findIndex((x) => x.key === key) : list.findIndex((t) => t.items.some((x) => x.key === key));
  const total = rows ? rows.length : list.length;
  const next: Mail | null = idx < 0 ? null : (rows ? rows[idx + 1] : list[idx + 1]?.latest) ?? null;
  const prev: Mail | null = idx <= 0 ? null : rows ? rows[idx - 1] : list[idx - 1].latest;
  const home = far && view ? routeOfFolder(view.target) : { name: 'inbox' as const };
  const homeName = far ? (view ? folderTitle(s, view.target) : 'Back') : 'Inbox';
  // Moving on after archiving or deleting replaces the screen, so Back goes to the list and not to a message that is gone.
  const open = (n: Mail | null, replace = false) => (n ? openMail(n, { replace }) : go(home, { replace }));

  if (!m || !target) {
    const gone = asked?.key === key && asked.state === 'done';
    const failed = asked?.key === key && asked.state === 'failed';
    return (
      <div className="pg">
        <div className="nav"><button className="back" onClick={() => back()} aria-label="Back"><Icon n="back" />Inbox</button></div>
        <div className="empty">
          {gone ? <><span className="big">Not in Outlook any more</span>It was deleted for good, or another app moved it. Search can find it if it was moved.</>
            : failed ? <><span className="big">Could not open it</span>{asked.error}<div style={{ marginTop: 14 }}><button className="link" onClick={() => setAgain((n) => n + 1)}>Try again</button></div></>
              : <span className="big">Opening…</span>}
        </div>
      </div>
    );
  }

  // Where a message that is not in the inbox is, and so what can be done with it from here.
  const place: FolderKind | 'unknown' = far ? m.fk ?? c.folderOf(m)?.kind ?? 'unknown' : 'inbox';
  const ways = placeActions(place);
  const primary = far ? ways.primary : null;
  const folderName = far && place !== 'unknown' ? (place === 'other' ? c.folderOf(m)?.name ?? 'Folder' : FOLDER_NAME[place]) : '';

  const isOpen = (x: Mail) => !many || (x.key === key) !== flipped.has(x.key);
  const toggle = (x: Mail) => {
    const keys = new Set(flipped);
    if (keys.has(x.key)) keys.delete(x.key); else keys.add(x.key);
    turned.delete(key); turned.set(key, keys);
    if (turned.size > 40) turned.delete(turned.keys().next().value!);
    setFlip({ key, keys });
  };
  const reply = (mode: 'reply' | 'replyAll' | 'forward', x: Mail = target) => go({ name: 'compose', mode, account: email, id: x.id });
  const archiveNext = () => { void c.archive(local, 1); open(next, true); };
  const deleteNext = () => { void c.trash(local, 1); open(next, true); };
  // One message that is not in the inbox: it goes where the button says, and the next one of the list opens.
  const wayNext = (w: Way) => { void moveWay(c, [m], w); open(next, true); };
  const mine = far ? [m] : local; // what read, flag and the rest reach
  const anyUnread = mine.some((x) => !x.isRead);
  const anyFlag = mine.some((x) => x.flagged);
  const conversationLike = looksLikeReply(m.subject) || local.length > 1 || all.some(isMine);
  const canDelete = far ? ways.canDelete : canTriage;
  const deleteIt = () => (far ? wayNext(DELETE_WAY) : deleteNext());
  const movable = far || canTriage; // "Move to a folder" is for everything that can be moved: the inbox mail and the mail seen in a folder
  const backLabel = far ? (view ? `Back to ${homeName}` : 'Back') : 'Back to inbox';

  return (
    <div className="pg">
      <div className="nav">
        {!pane && <button className="back" onClick={() => back(home)} aria-label={backLabel}><Icon n="back" />{homeName}</button>}
        {/* On a computer the actions sit up here, in plain view, the way a desktop mail app has them; on a phone they are the bar at the bottom. */}
        {pane && roomy && (
          <div className="tools" role="toolbar" aria-label="Actions">
            {canTriage && <button type="button" className="tool" title="Archive (e)" onClick={archiveNext}><Icon n="archive" size={18} />Archive</button>}
            {primary && <button type="button" className="tool" title={`${primary.label} (e)`} onClick={() => wayNext(primary)}><Icon n={primary.icon} size={18} />{primary.label}</button>}
            <button type="button" className="tool" title="Reply (r)" aria-label={many && !isMine(target) ? `Reply to ${displayName(target.fromName, target.fromAddress)}` : 'Reply'} onClick={() => reply('reply')}><Icon n="reply" size={18} />Reply</button>
            <button type="button" className="tool" title="Reply all (a)" onClick={() => reply('replyAll')}><Icon n="replyAll" size={18} />Reply all</button>
            <span className="tsep" aria-hidden="true" />
            {/* the rest show their words only when the window is wide enough; their name is always there for a screen reader and a hover */}
            <button type="button" className="tool opt" title="Forward" aria-label="Forward" onClick={() => reply('forward')}><Icon n="forward" size={18} /><span className="tl">Forward</span></button>
            {movable && <button type="button" className="tool opt" title="Move to a folder" aria-label="Move to a folder" onClick={() => setSheet('move')}><Icon n="folder" size={18} /><span className="tl">Move</span></button>}
            {canDelete && <button type="button" className="tool opt" title="Delete (#)" aria-label="Delete" onClick={deleteIt}><Icon n="trash" size={18} /><span className="tl">Delete</span></button>}
            <button type="button" className="tool icon" aria-label="More" title="More" onClick={() => setSheet('more')}><Icon n="more" size={18} /></button>
          </div>
        )}
        <span className="sp" />
        {idx >= 0 && <span className="pos">{idx + 1} of {total}</span>}
        <button className="btn" aria-label="Previous message" disabled={!prev} onClick={() => open(prev)} style={{ opacity: prev ? 1 : .4 }}><Icon n="up" /></button>
        <button className="btn" aria-label="Next message" disabled={!next} onClick={() => open(next)} style={{ opacity: next ? 1 : .4 }}><Icon n="down" /></button>
      </div>
      <div className="scroll">
        <div className="ttl">
          <h1 className="h2">{m.subject || '(no subject)'}</h1>
          {/* Your own address is only worth showing when there is more than one mailbox to tell apart. */}
          {(s.accounts.length > 1 || m.kind !== 'person' || many || !!folderName) && <div className="meta">{s.accounts.length > 1 && <span className="chip"><i style={{ background: badge?.colour ?? 'var(--at)' }} />{email}</span>}{folderName && <span className="chip"><Icon n={place === 'unknown' ? 'folder' : FOLDER_ICON[place]} size={14} />{folderName}</span>}{here && m.kind !== 'person' && <span className="chip">{KIND_TAB[m.kind]}</span>}{many && <span className="chip">{all.length} messages</span>}</div>}
        </div>
        {all.map((x) => (
          <MessageBlock key={x.key} s={s} m={x} open={isOpen(x)} many={many} anchor={x.key === key} onPhone={local.some((y) => y.key === x.key)} editable={local.some((y) => y.key === x.key) || (far && x.key === key)}
            onToggle={() => toggle(x)} onReply={(mode) => reply(mode, x)} onWhy={() => setSheet('why')}
            onBody={x.key === key ? (b) => { setAnchorBody({ key, body: b }); if (here) void c.markRead(c.threadOf(here), { quiet: true }); else if (!m.isRead && !m.draft) void c.markRead([m], { quiet: true }); } : undefined} />
        ))}
        {grouped && m.conversationId && looking === 'loading' && conversationLike && <p className="note" role="status">Looking for the rest of this conversation…</p>}
        {grouped && m.conversationId && looking === 'failed' && conversationLike && <p className="note" role="status">Could not look for the rest of this conversation. <button className="link" onClick={() => { forceNext.current = true; setRetry((n) => n + 1); }}>Try again</button></p>}
      </div>
      {!(pane && roomy) && (
        <div className="bar" role="toolbar" aria-label="Actions">
          <button className="ib" aria-label={many && !isMine(target) ? `Reply to ${displayName(target.fromName, target.fromAddress)}` : 'Reply'} onClick={() => reply('reply')}><Icon n="reply" /><span className="lb">Reply</span></button>
          {canTriage && <button className="go" onClick={archiveNext}><Icon n="archive" />Archive{next ? <small>· next</small> : null}</button>}
          {primary && <button className="go" onClick={() => wayNext(primary)}><Icon n={primary.icon} />{primary.label}{next ? <small>· next</small> : null}</button>}
          {far && <button className="ib" aria-label="Move to a folder" onClick={() => setSheet('move')}><Icon n="folder" /><span className="lb">Move</span></button>}
          <button className="ib" aria-label="More" onClick={() => setSheet('more')}><Icon n="more" /><span className="lb">More</span></button>
        </div>
      )}
      {sheet === 'move' && movable && <MoveSheet s={s} items={far ? [m] : local} rows={1} inbox={!far} onClose={() => setSheet(null)} onMoved={() => open(next, true)} />}
      {sheet === 'remind' && <RemindSheet m={m} preview={anchorBody?.key === key && anchorBody.body.contentType === 'text' ? anchorBody.body.content : m.preview} onClose={() => setSheet(null)} />}
      {sheet === 'why' && here && <SortSheet s={s} m={here} onClose={() => setSheet(null)} />}
      {sheet === 'block' && here && <BlockSheet s={s} m={here} onClose={() => setSheet(null)} onBlocked={() => open(next, true)} />}
      {sheet === 'sweep' && here && <SweepSheet s={s} m={here} onClose={() => setSheet(null)} onSwept={(gone) => { if (gone) open(next, true); }} />}
      {sheet === 'more' && (
        <Sheet title={labelOf(s, email)} onClose={() => setSheet(null)}>
          <div className="card">
            <button className="it" onClick={() => reply('replyAll')}><span className="ico"><Icon n="replyAll" /></span>Reply all</button>
            <button className="it" onClick={() => reply('forward')}><span className="ico"><Icon n="forward" /></span>Forward</button>
            <button className="it" onClick={() => setSheet('remind')}><span className="ico"><Icon n="home" /></span>Remind me<span className="v">in Home Memory</span></button>
            {(canTriage || far) && <button className="it" onClick={() => { void c.toggleRead(mine); setSheet(null); if (!anyUnread) go(home); }}><span className="ico"><Icon n="mail" /></span>{anyUnread ? 'Mark as read' : 'Mark as unread'}</button>}
            {(canTriage || far) && <button className="it" onClick={() => { void c.toggleFlag(mine); setSheet(null); }}><span className="ico"><Icon n="flag" /></span>{anyFlag ? 'Remove flag' : 'Flag'}</button>}
            {movable && <button className="it" onClick={() => setSheet('move')}><span className="ico"><Icon n="folder" /></span>Move to a folder<span className="v">…</span></button>}
            {here && <button className="it" onClick={() => setSheet('why')}><span className="ico"><Icon n="inbox" /></span>Sorted as {KIND_TAB[here.kind]}<span className="v">Change</span></button>}
            {canTriage && here && canMute(here) && !s.muted.some((x) => x.key === threadKey(here)) && <button className="it" onClick={() => { void c.muteConversation(here); setSheet(null); open(next, true); }}><span className="ico"><Icon n="bellOff" /></span>Mute conversation<span className="v">…</span></button>}
            {canTriage && here && !isMine(here) && <button className="it" onClick={() => setSheet('block')}><span className="ico"><Icon n="ban" /></span>Block sender<span className="v">…</span></button>}
            {canTriage && here && !isMine(here) && <button className="it" onClick={() => setSheet('sweep')}><span className="ico"><Icon n="sparkle" /></span>Sweep this sender<span className="v">…</span></button>}
            {canDelete && <button className="it danger" onClick={() => { setSheet(null); deleteIt(); }}><span className="ico"><Icon n="trash" /></span>Delete{many && !far ? ' conversation' : ''}</button>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/**
 * One message of the conversation. Open, it shows who it is from (with the address to copy), what is attached and the text, and, in a
 * conversation, Reply, Reply all and Forward for this very message; folded up, one line with who and what it starts with. `anchor` is the
 * message that was opened: it carries the "sorted as" bar and the unsubscribe button.
 */
function MessageBlock({ s, m, open, many, anchor, onPhone, editable, onToggle, onReply, onWhy, onBody }: {
  s: State; m: Mail; open: boolean; many: boolean; anchor: boolean; onPhone: boolean; editable: boolean;
  onToggle: () => void; onReply: (mode: 'reply' | 'replyAll' | 'forward') => void; onWhy: () => void; onBody?: (b: MailBody) => void;
}) {
  const c = useC();
  const dark = useDark(s.settings.theme);
  const mine = isMine(m);
  const [body, setBody] = useState<MailBody | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadImages, setLoadImages] = useState(false);
  const [cids, setCids] = useState<Record<string, string>>({});
  const [embedded, setEmbedded] = useState<Set<string> | null>(null); // the attachments that are pictures inside the text; null until we know
  const [unsub, setUnsub] = useState<Unsub | null>(null);
  const onBodyRef = useRef(onBody);
  onBodyRef.current = onBody;

  useEffect(() => {
    if (!open) return;
    let live = true;
    setErr(null);
    c.openBody(m).then(async (b) => {
      if (!live) return;
      setBody(b);
      onBodyRef.current?.(b);
      // Pictures that are part of the text (a logo in a signature) are fetched and put in place; every other attachment is a file in the list.
      const wanted = b.contentType === 'html' ? new Set([...b.content.matchAll(/cid:([^"'\s)>]+)/gi)].map((x) => x[1].toLowerCase())) : new Set<string>();
      const pictures = b.attachments.filter((x) => x.inline && x.contentType.startsWith('image/'));
      const seen = picturesSeen.get(m.key);
      if (seen) { setCids(seen.cids); setEmbedded(new Set(seen.embedded)); return; }
      if (!wanted.size || !pictures.length) { setEmbedded(new Set()); return; }
      const map: Record<string, string> = {};
      const used: string[] = [];
      for (const a of pictures.slice(0, 12).filter((x) => x.size < 2_000_000)) {
        try {
          const f = await c.attachment(m, a.id);
          if (f.cid && wanted.has(f.cid)) { map[f.cid] = toDataUri(f.bytes, f.contentType); used.push(a.id); }
        } catch { /* a missing picture must not break the message */ }
      }
      if (picturesSeen.size > 30) picturesSeen.delete(picturesSeen.keys().next().value!);
      picturesSeen.set(m.key, { cids: map, embedded: used });
      if (live) { setCids(map); setEmbedded(new Set(used)); }
    }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'Could not open this message'); });
    return () => { live = false; };
  }, [m.key, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only mail that says it has an unsubscribe link (or has not been read in detail yet) is worth asking Outlook for the headers.
  useEffect(() => {
    if (!anchor || !onPhone || (m.kind !== 'promo' && m.kind !== 'update') || (m.sig && !m.sig.includes('unsub'))) return;
    let live = true;
    c.headersOf(m).then((h) => { if (live) setUnsub(parseUnsubscribe(h)); }).catch(() => {});
    return () => { live = false; };
  }, [m.key, m.kind, anchor, onPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = mine ? 'You' : displayName(m.fromName, m.fromAddress);
  const unread = editable && !m.isRead;

  if (!open) {
    return (
      <article className={`msg folded${unread ? ' u' : ''}`}>
        <button type="button" className="mh folded" onClick={onToggle} aria-expanded={false} aria-label={`${who}, ${shortTime(m.received)}. Show this message`}>
          <Avatar m={m} />
          <span className="w"><span className="n">{who}<span className="when">{shortTime(m.received)}</span></span><span className="pv1">{m.preview}</span></span>
          <Icon n="down" />
        </button>
      </article>
    );
  }

  const html = body ? (body.contentType === 'html' ? inlineCids(body.content, cids, BLANK_PICTURE) : textToHtml(body.content)) : '';
  // Pictures that belong to the text are not files; until it is known which are which, they are kept out of the list rather than flashing in it.
  const files = (body?.attachments ?? []).filter((a) => !(a.inline && a.contentType.startsWith('image/') && (!embedded || embedded.has(a.id))));
  const remote = !!body && body.contentType === 'html' && hasRemoteImages(body.content);
  const showImages = loadImages || !s.settings.blockImages;
  const to = body ? body.to.map((r) => displayName(r.name, r.address).split(' ')[0]).join(', ') : '';
  const named = m.fromName.trim() && m.fromName.trim().toLowerCase() !== m.fromAddress.toLowerCase();

  return (
    <article className="msg">
      <div className="mh" onClick={many ? (e) => { if (!(e.target as HTMLElement).closest('button, a')) onToggle(); } : undefined}>
        <Avatar m={m} />
        <div className="w">
          {mine ? <div className="n">You</div> : <>{named && <div className="n">{m.fromName.trim()}</div>}{m.fromAddress ? <CopyAddress address={m.fromAddress} bold={!named} /> : <div className="n">{displayName(m.fromName, m.fromAddress)}</div>}</>}
          <div className="s">{to ? `to ${to} · ` : ''}{shortTime(m.received)}{many && m.flagged && <span className="fl"><Icon n="flag" size={13} /></span>}</div>
        </div>
        {many ? (
          <button className="btn plain" aria-label="Fold this message up" aria-expanded={true} onClick={onToggle}><Icon n="up" /></button>
        ) : editable && <button className="btn plain" aria-label={m.flagged ? 'Remove flag' : 'Flag'} onClick={() => void c.setFlag(m, !m.flagged)} style={{ color: m.flagged ? 'var(--at)' : undefined }}><Icon n="flag" /></button>}
      </div>
      {anchor && onPhone && m.kind !== 'person' && (
        <div className="kindbar"><Icon n="inbox" size={18} /><span>Sorted as {KIND_ONE[m.kind]}</span><span className="sp" />
          {unsub && <button onClick={() => { if (unsub.https) window.open(unsub.https, '_blank', 'noopener'); else if (unsub.mailto) void c.unsubscribe(m, unsub.mailto); }}>Unsubscribe</button>}
          <button onClick={onWhy}>Why?</button></div>
      )}
      {body && <FileList m={m} files={files} failed={!!body.attachmentsFailed} onRetry={() => { void c.openBody(m).then(setBody).catch(() => {}); }} />}
      {remote && !showImages && <div className="banner"><Icon n="eye" size={18} />Images are blocked<button onClick={() => setLoadImages(true)}>Load once</button></div>}
      {err ? <p className="note" style={{ margin: 16 }}>{err}</p> : body ? <Frame html={html} remote={showImages} dark={dark} /> : <p className="note" style={{ margin: '18px 16px' }}>Opening…</p>}
      {many && (
        <div className="macts" role="group" aria-label={`Answer or forward ${mine ? 'your message' : `the message from ${who}`}`}>
          {!mine && <button type="button" aria-label={`Reply to ${who}`} onClick={() => onReply('reply')}><Icon n="reply" size={18} />Reply</button>}
          {!mine && <button type="button" aria-label={`Reply all to ${who}`} onClick={() => onReply('replyAll')}><Icon n="replyAll" size={18} />Reply all</button>}
          <button type="button" aria-label={mine ? 'Forward your message' : `Forward the message from ${who}`} onClick={() => onReply('forward')}><Icon n="forward" size={18} />Forward</button>
        </div>
      )}
    </article>
  );
}

/** "Why is this here?": the reasons in plain words, and the fix: move this sender (or everything from their company) to another tab. */
function SortSheet({ s, m, onClose }: { s: State; m: Mail; onClose: () => void }) {
  const c = useC();
  const rule = ruleFor(s.overrides, m.fromAddress);
  const domain = orgDomain(m.fromAddress);
  const canCompany = !!domain && !isFreemail(domain);
  const [company, setCompany] = useState(rule?.scope === 'company');
  const move = (k: Mail['kind'] | null, scope: 'sender' | 'company') => { void c.moveSender(m.fromAddress, k, scope); onClose(); };
  return (
    <Sheet title="Why is this here?" onClose={onClose}>
      <div className="card">{m.why.map((w) => <div key={w} className="it"><span className="ico"><Icon n="check" /></span>{w}</div>)}</div>
      <p className="note">Post never hides mail: sorting only decides which tab shows it, and All shows everything. If it is wrong, fix it once and the next mail follows.</p>
      <div className="lbl">Move to</div>
      <div className="card">
        {canCompany && <div className="it"><span className="rw">Everything from {domain}<small>Not only this sender</small></span><Switch on={company} onChange={setCompany} label={`Everything from ${domain}`} /></div>}
        {KINDS.map((k) => <button key={k} className="it" onClick={() => move(k, company && canCompany ? 'company' : 'sender')}><span className="ico"><Icon n={KIND_ICON[k]} /></span>{KIND_TAB[k]}{m.kind === k && <span className="v"><Icon n="check" /></span>}</button>)}
        {rule && <button className="it" onClick={() => move(null, rule.scope)}>Back to automatic<span className="v">{rule.scope === 'company' ? `rule for ${rule.key.slice(1)}` : 'rule for this sender'}</span></button>}
      </div>
    </Sheet>
  );
}

/** The address the mail really came from, as one button: tap it and it is on the clipboard. */
function CopyAddress({ address, bold = false }: { address: string; bold?: boolean }) {
  const c = useC();
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (await copyText(address)) { setDone(true); setTimeout(() => setDone(false), 1600); c.toast(`Copied ${address}`); }
    else c.toast('Could not copy. Press and hold the address to copy it.');
  };
  return <button type="button" className={`addr${bold ? ' bold' : ''}`} onClick={() => void copy()} aria-label={`Copy ${address}`}><span>{address}</span><Icon n={done ? 'check' : 'copy'} size={15} /></button>;
}
