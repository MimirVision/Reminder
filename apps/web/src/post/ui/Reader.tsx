import { useEffect, useMemo, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import { visibleMail } from '../core/controller.ts';
import { displayName, fileSize, shortTime } from '../core/format.ts';
import { frameDocument, hasRemoteImages, inlineCids, safeBlobType, textToHtml } from '../core/html.ts';
import { parseUnsubscribe, type Unsub } from '../core/unsubscribe.ts';
import { isFreemail, orgDomain, ruleFor } from '../core/classify.ts';
import { KIND_ONE, KIND_TAB, KINDS, mailKey, type Mail, type MailBody } from '../core/types.ts';
import { Avatar, Icon, KIND_ICON, Sheet, Switch } from './ui.tsx';
import { SnoozeSheet } from './Inbox.tsx';
import { RemindSheet } from './Remind.tsx';
import { back, go, labelOf, useBadge, useC, useDark, useNow } from './ctx.tsx';

function Frame({ html, remote, dark }: { html: string; remote: boolean; dark: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => frameDocument(html, { remoteImages: remote, dark }), [html, remote, dark]);
  const fit = () => { const d = ref.current?.contentDocument; if (d && ref.current) ref.current.style.height = `${Math.max(80, d.documentElement.scrollHeight)}px`; };
  useEffect(() => { const t = setTimeout(fit, 150); return () => clearTimeout(t); }, [doc]);
  return <iframe ref={ref} className="frame" title="Message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc} onLoad={fit} />;
}

const toDataUri = (bytes: Uint8Array, type: string) => { let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return `data:${type};base64,${btoa(bin)}`; };

export function Reader({ s, account, id, pane = false }: { s: State; account: string; id: string; pane?: boolean }) {
  const c = useC();
  const now = useNow();
  const dark = useDark(s.settings.theme);
  const acct = s.accounts.find((a) => a.id === account || a.email === account);
  const email = acct?.email ?? account;
  const key = mailKey(email, id);
  const m = s.mail.find((x) => x.key === key);
  const badge = useBadge(s)(email);
  const [body, setBody] = useState<MailBody | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadImages, setLoadImages] = useState(false);
  const [cids, setCids] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<null | 'more' | 'snooze' | 'why' | 'remind'>(null);
  const [unsub, setUnsub] = useState<Unsub | null>(null);
  const waited = useRef(false);

  // A notification can arrive before this phone has synced: sync once, then look again.
  useEffect(() => { if (!m && s.ready && acct && !waited.current) { waited.current = true; void c.sync(); } }, [m, s.ready, acct, c]);

  useEffect(() => {
    setBody(null); setErr(null); setLoadImages(false); setCids({}); setUnsub(null);
    if (!m) return;
    let live = true;
    c.openBody(m).then(async (b) => {
      if (!live) return;
      setBody(b);
      if (!m.isRead) void c.setRead(m, true);
      if (b.contentType === 'html' && /cid:/i.test(b.content)) {
        const map: Record<string, string> = {};
        for (const a of b.attachments.filter((x) => x.inline && x.cid && x.contentType.startsWith('image/') && x.size < 1_500_000)) {
          try { const blob = await c.attachment(m, a.id); map[a.cid!] = toDataUri(blob.bytes, blob.contentType); } catch { /* a missing picture must not break the message */ }
        }
        if (live) setCids(map);
      }
    }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'Could not open this message'); });
    return () => { live = false; };
  }, [m?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only mail that says it has an unsubscribe link (or has not been read in detail yet) is worth asking Outlook for the headers.
  useEffect(() => {
    if (!m || (m.kind !== 'promo' && m.kind !== 'update') || (m.sig && !m.sig.includes('unsub'))) return;
    let live = true;
    c.headersOf(m).then((h) => { if (live) setUnsub(parseUnsubscribe(h)); }).catch(() => {});
    return () => { live = false; };
  }, [m?.key, m?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Next and previous follow the tab you came from. Reading a message must not drop it from "unread only" while you are still on it.
  const list = visibleMail({ ...s, unreadOnly: false }, now);
  const idx = list.findIndex((x) => x.key === key);
  const next = idx >= 0 ? list[idx + 1] ?? null : null;
  const prev = idx > 0 ? list[idx - 1] : null;
  const open = (x: Mail | null) => (x ? go({ name: 'message', account: x.account, id: x.id }) : go({ name: 'inbox' }));

  if (!m) {
    return (
      <div className="pg">
        <div className="nav"><button className="back" onClick={() => go({ name: 'inbox' })}><Icon n="back" />Inbox</button></div>
        <div className="empty">{s.sync.running || !waited.current ? <><span className="big">Opening…</span></> : <><span className="big">Not in your inbox</span>It was moved, deleted or archived somewhere else.</>}</div>
      </div>
    );
  }

  const html = body ? (body.contentType === 'html' ? inlineCids(body.content, cids) : textToHtml(body.content)) : '';
  const remote = !!body && body.contentType === 'html' && hasRemoteImages(body.content);
  const showImages = loadImages || !s.settings.blockImages;
  const to = body ? body.to.map((r) => displayName(r.name, r.address).split(' ')[0]).join(', ') : '';
  const archiveNext = () => { void c.archive([m]); open(next); };

  return (
    <div className="pg">
      <div className="nav">
        {!pane && <button className="back" onClick={() => back()} aria-label="Back to inbox"><Icon n="back" />Inbox</button>}
        <span className="sp" />
        {idx >= 0 && <span style={{ fontSize: 13, color: 'var(--mu)' }}>{idx + 1} of {list.length}</span>}
        <button className="btn" aria-label="Previous message" disabled={!prev} onClick={() => open(prev)} style={{ opacity: prev ? 1 : .4 }}><Icon n="up" /></button>
        <button className="btn" aria-label="Next message" disabled={!next} onClick={() => open(next)} style={{ opacity: next ? 1 : .4 }}><Icon n="down" /></button>
      </div>
      <div className="scroll">
        <div className="ttl">
          <h1 className="h2">{m.subject || '(no subject)'}</h1>
          <div className="meta"><span className="chip"><i style={{ background: badge?.colour ?? 'var(--at)' }} />{email}</span>{m.kind !== 'person' && <span className="chip">{KIND_TAB[m.kind]}</span>}</div>
        </div>
        <article className="msg">
          <div className="mh">
            <Avatar m={m} />
            <div className="w"><div className="n">{displayName(m.fromName, m.fromAddress)}</div><div className="s">{to ? `to ${to} · ` : ''}{shortTime(m.received)}</div></div>
            <button className="btn plain" aria-label={m.flagged ? 'Remove flag' : 'Flag'} onClick={() => void c.setFlag(m, !m.flagged)} style={{ color: m.flagged ? 'var(--at)' : undefined }}><Icon n="flag" /></button>
          </div>
          {m.kind !== 'person' && (
            <div className="kindbar"><Icon n="inbox" size={18} /><span>Sorted as {KIND_ONE[m.kind]}</span><span className="sp" />
              {unsub && <button onClick={() => { if (unsub.https) window.open(unsub.https, '_blank', 'noopener'); else if (unsub.mailto) void c.unsubscribe(m, unsub.mailto); }}>Unsubscribe</button>}
              <button onClick={() => setSheet('why')}>Why?</button></div>
          )}
          {remote && !showImages && <div className="banner"><Icon n="eye" size={18} />Images are blocked<button onClick={() => setLoadImages(true)}>Load once</button></div>}
          {err ? <p className="note" style={{ margin: 16 }}>{err}</p> : body ? <Frame html={html} remote={showImages} dark={dark} /> : <p className="note" style={{ margin: '18px 16px' }}>Opening…</p>}
          {body?.attachments.filter((a) => !a.inline).map((a) => (
            <button key={a.id} className="att" onClick={async () => { const f = await c.attachment(m, a.id); const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: safeBlobType(f.contentType, a.name) })); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60_000); }}><Icon n="paperclip" size={20} />{a.name}<span>{fileSize(a.size)}</span></button>
          ))}
        </article>
      </div>
      <div className="bar" role="toolbar" aria-label="Actions">
        <button className="ib" aria-label="Reply" onClick={() => go({ name: 'compose', mode: 'reply', account: email, id: m.id })}><Icon n="reply" /></button>
        <button className="go" onClick={archiveNext}><Icon n="archive" />Archive{next ? <small>· next</small> : null}</button>
        <button className="ib" aria-label="Snooze" onClick={() => setSheet('snooze')}><Icon n="clock" /></button>
        <button className="ib" aria-label="More" onClick={() => setSheet('more')}><Icon n="more" /></button>
      </div>
      {sheet === 'snooze' && <SnoozeSheet onClose={() => setSheet(null)} onPick={(at, label) => { void c.snooze(m, at, label); setSheet(null); open(next); }} />}
      {sheet === 'remind' && <RemindSheet m={m} preview={body?.contentType === 'text' ? body.content : m.preview} onClose={() => setSheet(null)} />}
      {sheet === 'why' && <SortSheet s={s} m={m} onClose={() => setSheet(null)} />}
      {sheet === 'more' && (
        <Sheet title={labelOf(s, email)} onClose={() => setSheet(null)}>
          <div className="card">
            <button className="it" onClick={() => go({ name: 'compose', mode: 'replyAll', account: email, id: m.id })}><span className="ico"><Icon n="replyAll" /></span>Reply all</button>
            <button className="it" onClick={() => go({ name: 'compose', mode: 'forward', account: email, id: m.id })}><span className="ico"><Icon n="forward" /></span>Forward</button>
            <button className="it" onClick={() => setSheet('remind')}><span className="ico"><Icon n="home" /></span>Remind me<span className="v">in Home Memory</span></button>
            <button className="it" onClick={() => { void c.setRead(m, false); setSheet(null); go({ name: 'inbox' }); }}><span className="ico"><Icon n="mail" /></span>Mark as unread</button>
            <button className="it" onClick={() => { void c.setFlag(m, !m.flagged); setSheet(null); }}><span className="ico"><Icon n="flag" /></span>{m.flagged ? 'Remove flag' : 'Flag'}</button>
            <button className="it" onClick={() => setSheet('why')}><span className="ico"><Icon n="inbox" /></span>Sorted as {KIND_TAB[m.kind]}<span className="v">Change</span></button>
            <button className="it danger" onClick={() => { void c.trash([m]); setSheet(null); open(next); }}><span className="ico"><Icon n="trash" /></span>Delete</button>
          </div>
        </Sheet>
      )}
    </div>
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
