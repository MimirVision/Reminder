import { useEffect, useMemo, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import { displayName, initials } from '../core/format.ts';
import { mailKey } from '../core/types.ts';
import { Icon } from './ui.tsx';
import { back, go, labelOf, useC } from './ctx.tsx';

const EMAIL = /[^\s,;<>()"]+@[^\s,;<>()"]+\.[^\s,;<>()"]+/g;
const addresses = (s: string) => [...new Set((s.match(EMAIL) ?? []).map((x) => x.toLowerCase()))];

export function Compose({ s, mode, account, id }: { s: State; mode: 'new' | 'reply' | 'replyAll' | 'forward'; account?: string; id?: string }) {
  const c = useC();
  const original = useMemo(() => (id && account ? s.mail.find((m) => m.key === mailKey(account, id)) : undefined), [s.mail, id, account]);
  const first = useRef(true);
  const sent = useRef(false);
  const [from, setFrom] = useState(account ?? s.accounts[0]?.email ?? '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(false);

  // Start from a saved draft (so closing the app never loses what you wrote), or from the message being answered.
  useEffect(() => {
    if (!first.current) return; first.current = false;
    const d = c.loadDraft();
    if (d && d.mode === mode && (mode === 'new' || d.replyTo === id)) { setFrom(d.account); setTo(d.to); setCc(d.cc); setShowCc(!!d.cc); setSubject(d.subject); setText(d.body); return; }
    if (mode === 'new') { if (s.settings.signature) setText(`\n\n${s.settings.signature}`); return; }
    if (original) {
      setSubject(`${mode === 'forward' ? 'Fwd' : 'Re'}: ${original.subject.replace(/^(re|fw|fwd|sv|vs):\s*/i, '')}`);
      if (mode !== 'forward') setTo(original.fromAddress);
      if (s.settings.signature) setText(`\n\n${s.settings.signature}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave about a second after you stop typing.
  useEffect(() => {
    if (sent.current || !(to || cc || subject || text.trim())) return;
    const t = setTimeout(() => c.saveDraft({ account: from, to, cc, subject, body: text, replyTo: id, mode }), 800);
    return () => clearTimeout(t);
  }, [from, to, cc, subject, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastWord = to.split(/[,;\s]+/).pop() ?? '';
  const suggestions = useMemo(() => {
    if (!focus || lastWord.length < 2 || lastWord.includes('@')) return [];
    const q = lastWord.toLowerCase();
    const seen = new Map<string, string>();
    for (const m of s.mail) if (!seen.has(m.fromAddress) && `${m.fromName} ${m.fromAddress}`.toLowerCase().includes(q)) seen.set(m.fromAddress, m.fromName);
    return [...seen].slice(0, 4);
  }, [focus, lastWord, s.mail]);

  const rcpt = addresses(to);
  const body = text.trim();
  const canSend = !busy && !!from && (mode === 'reply' || mode === 'replyAll' ? !!id && body.length > 0 : mode === 'forward' ? !!id && rcpt.length > 0 : rcpt.length > 0 && (body.length > 0 || subject.trim().length > 0));
  const send = async () => {
    setBusy(true);
    sent.current = true;
    await c.send({ account: from, kind: mode, to: rcpt, cc: addresses(cc), subject: subject.trim(), body: text, replyTo: id });
    back();
  };
  const heading = mode === 'new' ? 'New message' : mode === 'forward' ? 'Forward' : mode === 'replyAll' ? 'Reply all' : 'Reply';

  return (
    <div className="pg">
      <div className="nav">
        <button className="cancel" onClick={() => { if (text.trim() && !confirm('Keep this as a draft?')) c.saveDraft(null); back(); }}>Cancel</button>
        <span className="sp" style={{ textAlign: 'center' }}><h1 className="h3">{heading}</h1></span>
        <button className="send" disabled={!canSend} onClick={() => void send()}><Icon n="send" size={18} />Send</button>
      </div>
      <div className="scroll">
        <div className="fields">
          {s.accounts.length > 1 && <div className="f"><span className="k">From</span><select aria-label="Send from" value={from} onChange={(e) => setFrom(e.target.value)}>{s.accounts.map((a) => <option key={a.email} value={a.email}>{a.label} · {a.email}</option>)}</select></div>}
          <div className="f"><span className="k">To</span><input aria-label="To" inputMode="email" autoCapitalize="none" autoCorrect="off" value={to} onChange={(e) => setTo(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder={mode === 'new' ? 'name@example.com' : ''} />{!showCc && <button className="link" onClick={() => setShowCc(true)} style={{ minHeight: 44 }}>Cc</button>}</div>
          {showCc && <div className="f"><span className="k">Cc</span><input aria-label="Cc" inputMode="email" autoCapitalize="none" value={cc} onChange={(e) => setCc(e.target.value)} /></div>}
          <div className="f"><span className="k">Subject</span><input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={mode === 'reply' || mode === 'replyAll'} /></div>
        </div>
        {suggestions.length > 0 && (
          <div className="sugg" role="listbox" aria-label="Suggestions">
            {suggestions.map(([addr, name]) => <button key={addr} className="sg" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => setTo(to.replace(/[^,;\s]*$/, '') + addr + ', ')}><div className="av" style={{ width: 34, height: 34, fontSize: 12, borderRadius: 17 }}>{initials(name, addr)}</div><div><b>{displayName(name, addr)}</b><span>{addr}</span></div></button>)}
          </div>
        )}
        <div className="write"><textarea aria-label="Message" autoFocus={mode !== 'new'} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'forward' ? 'Add a note (optional)' : 'Write your message'} /></div>
        {original && mode !== 'new' && <p className="note">The original message is added below your text automatically, like a normal reply. Sending from {labelOf(s, from)}.</p>}
        <p className="note" style={{ marginTop: 6 }}>{s.settings.undoSend ? `You get ${s.settings.undoSend} seconds to undo after tapping Send. ` : ''}Your draft is saved on this phone as you type.</p>
        {mode === 'new' && !s.accounts.length && <button className="cta" style={{ margin: 16, width: 'calc(100% - 32px)' }} onClick={() => go({ name: 'accounts' })}>Add an account first</button>}
      </div>
    </div>
  );
}
