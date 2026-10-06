import { useEffect, useMemo, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import { MAX_OUT_TOTAL, addPicked, tileLabel, totalBytes, type Picked } from '../core/files.ts';
import { displayName, fileSize, initials } from '../core/format.ts';
import type { OutFile } from '../core/graph.ts';
import { isMine } from '../core/threads.ts';
import { mailKey } from '../core/types.ts';
import { Icon, avatarHue } from './ui.tsx';
import { back, go, labelOf, useC } from './ctx.tsx';

const EMAIL = /[^\s,;<>()"]+@[^\s,;<>()"]+\.[^\s,;<>()"]+/g;
const addresses = (s: string) => [...new Set((s.match(EMAIL) ?? []).map((x) => x.toLowerCase()))];

export function Compose({ s, mode, account, id }: { s: State; mode: 'new' | 'reply' | 'replyAll' | 'forward'; account?: string; id?: string }) {
  const c = useC();
  // The message being answered: one in the inbox on this phone, or one only seen in Outlook (a search result, an older message of a conversation).
  const original = useMemo(() => (id && account ? s.mail.find((m) => m.key === mailKey(account, id)) ?? c.remoteMail(account, id) : undefined), [s.mail, id, account]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [files, setFiles] = useState<OutFile[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const filesReady = useRef(false);   // the saved files have been looked at: only then may the draft's files be written
  const picker = useRef<HTMLInputElement>(null);

  // Start from a saved draft (so closing the app never loses what you wrote), or from the message being answered.
  useEffect(() => {
    if (!first.current) return; first.current = false;
    const d = c.loadDraft();
    if (d && d.mode === mode && (mode === 'new' || d.replyTo === id)) {
      setFrom(d.account); setTo(d.to); setCc(d.cc); setShowCc(!!d.cc); setSubject(d.subject); setText(d.body);
      void c.loadDraftFiles().then((f) => { setFiles(f); filesReady.current = true; });
      return;
    }
    void c.saveDraftFiles([]).then(() => { filesReady.current = true; }); // files kept for some other draft do not belong to this one
    if (mode === 'new') { if (s.settings.signature) setText(`\n\n${s.settings.signature}`); return; }
    if (original) {
      setSubject(`${mode === 'forward' ? 'Fwd' : 'Re'}: ${original.subject.replace(/^(re|fw|fwd|sv|vs):\s*/i, '')}`);
      // Answering something you wrote yourself goes to the people you wrote it to, not to you.
      if (mode !== 'forward') { if (isMine(original)) void c.openBody(original).then((b) => setTo((cur) => cur || b.to.map((r) => r.address).join(', '))).catch(() => {}); else setTo(original.fromAddress); }
      if (s.settings.signature) setText(`\n\n${s.settings.signature}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave about a second after you stop typing.
  useEffect(() => {
    if (sent.current || !(to || cc || subject || text.trim() || files.length)) return;
    const t = setTimeout(() => c.saveDraft({ account: from, to, cc, subject, body: text, replyTo: id, mode }), 800);
    return () => clearTimeout(t);
  }, [from, to, cc, subject, text, files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // The files are kept next to the text, so they are still there after the app is closed.
  useEffect(() => {
    if (sent.current || !filesReady.current) return;
    void c.saveDraftFiles(files).then((ok) => { if (!ok) setProblems(['These files could not be saved on this phone for later. Send the message before you close Post.']); });
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Files from the picker, a drop or a paste. Whatever cannot be added is said, and the rest is added. */
  const attach = async (list: ArrayLike<Picked>) => {
    const chosen = Array.from(list); // before anything else: the browser empties the picker's (and a drop's) list as soon as this handler returns
    if (!chosen.length) return;
    const r = await addPicked(files, chosen);
    setFiles(r.files);
    setProblems(r.problems);
  };
  const dropped = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); void attach(e.dataTransfer.files); };

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
  const canSend = !busy && !!from && (mode === 'reply' || mode === 'replyAll' ? !!id && (body.length > 0 || files.length > 0) : mode === 'forward' ? !!id && rcpt.length > 0 : rcpt.length > 0 && (body.length > 0 || subject.trim().length > 0 || files.length > 0));
  const send = async () => {
    setBusy(true);
    sent.current = true;
    const ok = await c.send({ account: from, kind: mode, to: rcpt, cc: addresses(cc), subject: subject.trim(), body: text, replyTo: id }, files);
    if (ok) back(); else { sent.current = false; setBusy(false); }
  };
  const total = totalBytes(files);
  const heading = mode === 'new' ? 'New message' : mode === 'forward' ? 'Forward' : mode === 'replyAll' ? 'Reply all' : 'Reply';

  return (
    <div className="pg" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={dropped}>
      <div className="nav">
        <button className="cancel" onClick={() => { if ((text.trim() || files.length) && !confirm('Keep this as a draft?')) c.saveDraft(null); back(); }}>Cancel</button>
        <span className="sp" style={{ textAlign: 'center' }}><h1 className="h3 nav-title">{heading}</h1></span>
        <button type="button" className="btn att" aria-label={files.length ? `Attach more files (${files.length} attached)` : 'Attach files'} onClick={() => picker.current?.click()}><Icon n="paperclip" />{files.length > 0 && <span className="cnt" aria-hidden="true">{files.length}</span>}</button>
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
            {suggestions.map(([addr, name]) => <button key={addr} className="sg" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => setTo(to.replace(/[^,;\s]*$/, '') + addr + ', ')}><div className="av small" style={avatarHue(addr, name)}>{initials(name, addr)}</div><div><b>{displayName(name, addr)}</b><span>{addr}</span></div></button>)}
          </div>
        )}
        <div className="write"><textarea aria-label="Message" autoFocus={mode !== 'new'} value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach(e.clipboardData.files); } }} placeholder={mode === 'forward' ? 'Add a note (optional)' : 'Write your message'} /></div>
        <div className="attach">
          <input ref={picker} type="file" multiple hidden aria-label="Choose files to attach" onChange={(e) => { void attach(e.target.files ?? []); e.target.value = ''; }} />
          <button type="button" className="attach-btn" onClick={() => picker.current?.click()}><Icon n="paperclip" size={20} />Attach files</button>
          {files.length > 0 && <span className="attach-total">{files.length === 1 ? '1 file' : `${files.length} files`} · {fileSize(total)} of {fileSize(MAX_OUT_TOTAL)}</span>}
        </div>
        {files.length > 0 && (
          <div className="files out" role="list" aria-label="Files to send">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} role="listitem" className="file">
                <span className="fi">{tileLabel(f.name)}</span>
                <span className="fn"><b>{f.name}</b><span>{fileSize(f.bytes.byteLength)}</span></span>
                <button type="button" className="rm" aria-label={`Remove ${f.name}`} onClick={() => { setFiles(files.filter((_, j) => j !== i)); setProblems([]); }}><Icon n="x" size={18} /></button>
              </div>
            ))}
          </div>
        )}
        {problems.map((p) => <p key={p} className="note warn" role="alert">{p}</p>)}
        {original && mode !== 'new' && <p className="note">The original message is added below your text automatically, like a normal reply. Sending from {labelOf(s, from)}.</p>}
        <p className="note" style={{ marginTop: 6 }}>{s.settings.undoSend ? `You get ${s.settings.undoSend} seconds to undo after tapping Send. ` : ''}Your draft is saved on this device as you type.</p>
        {dragging && <div className="dropzone" aria-hidden="true"><Icon n="paperclip" size={34} />Drop files to attach them</div>}
        {mode === 'new' && !s.accounts.length && <button className="cta" style={{ margin: 16, width: 'calc(100% - 32px)' }} onClick={() => go({ name: 'accounts' })}>Add an account first</button>}
      </div>
    </div>
  );
}
