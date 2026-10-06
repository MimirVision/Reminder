import { useEffect, useMemo, useRef, useState } from 'react';
import type { Draft, State } from '../core/controller.ts';
import { MAX_OUT_TOTAL, addPicked, tileLabel, totalBytes, type Picked } from '../core/files.ts';
import { displayName, fileSize, initials } from '../core/format.ts';
import { DRAFT_FIELDS, type AttachmentInfo, type DraftField, type OutFile } from '../core/graph.ts';
import { isMine } from '../core/threads.ts';
import { mailKey } from '../core/types.ts';
import { Icon, Sheet, avatarHue } from './ui.tsx';
import { back, go, labelOf, useC } from './ctx.tsx';

const EMAIL = /[^\s,;<>()"]+@[^\s,;<>()"]+\.[^\s,;<>()"]+/g;
const addresses = (s: string) => [...new Set((s.match(EMAIL) ?? []).map((x) => x.toLowerCase()))];

/**
 * Writing. `mode: 'draft'` is a draft that is already at Outlook (made in another app, or left behind): it is opened as it is, edited, and sent
 * from here. `id` is then the draft's own id, and what you change is kept on this phone until you send it or save it to the draft. What is kept
 * for a draft has a place of its own, apart from the message being written (new, reply, forward): opening one never touches the other.
 */
export function Compose({ s, mode, account, id }: { s: State; mode: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'; account?: string; id?: string }) {
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
  // A draft from Outlook: read first (nothing to edit until it is), and what it was when it was read, to tell whether you changed anything.
  const [loaded, setLoaded] = useState<{ state: 'loading' | 'ready' | 'failed'; error?: string }>({ state: mode === 'draft' ? 'loading' : 'ready' });
  const [kept, setKept] = useState<AttachmentInfo[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const base = useRef<{ to: string; cc: string; subject: string; text: string; modified: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // What was kept here for this draft is older than the draft at Outlook (it was changed over there since): which to go on with is asked, never guessed.
  const [conflict, setConflict] = useState(false);
  const slot = useMemo(() => (mode === 'draft' && account && id ? { account, id } : undefined), [mode, account, id]);
  /** Keeps (or, with null, lets go of) the half-written text: the draft's own place for a draft at Outlook, the message being written otherwise. Never the wrong one. */
  const keep = (d: Draft | null) => { if (mode === 'draft' && !slot) return; c.saveDraft(d, slot); };

  /** Opens the draft at Outlook. What you had typed here and not saved comes back over it (the draft itself stays at Outlook as it was). */
  const openDraft = async () => {
    if (!slot) { setLoaded({ state: 'failed', error: 'This draft has no address.' }); return; }
    setLoaded({ state: 'loading' });
    try {
      const { content, files: have } = await c.openDraft(slot.account, slot.id);
      base.current = { to: content.to.join(', '), cc: content.cc.join(', '), subject: content.subject, text: content.body, modified: content.modified };
      setFrom(slot.account); setBcc(content.bcc); setKept(have);
      const mine = c.loadDraft(slot);
      if (mine && mine.mode === 'draft' && mine.replyTo === slot.id) {
        setTo(mine.to); setCc(mine.cc); setShowCc(!!mine.cc); setSubject(mine.subject); setText(mine.body);
        setFiles(await c.loadDraftFiles(slot));
        if (mine.modified && content.modified && mine.modified !== content.modified) setConflict(true);
      } else {
        setTo(base.current.to); setCc(base.current.cc); setShowCc(!!base.current.cc); setSubject(base.current.subject); setText(base.current.text);
        setFiles([]);
      }
      filesReady.current = true;
      setLoaded({ state: 'ready' });
    } catch (e) {
      setLoaded({ state: 'failed', error: e instanceof Error && e.message ? e.message : 'Could not open this draft.' });
    }
  };
  /** Whether anything differs from the draft as Outlook has it. */
  const changed = () => { const b = base.current; return !!b && (to !== b.to || cc !== b.cc || subject !== b.subject || text !== b.text || files.length > 0); };
  /**
   * Which parts differ from the draft as Outlook has it: only those are written back. A text that came back as plain text must not replace the
   * formatted one when it was left alone, and a name that went with an address must not be lost when only the subject was changed.
   */
  const edited = (): DraftField[] => {
    const b = base.current;
    if (!b) return [...DRAFT_FIELDS];
    const out: DraftField[] = [];
    if (subject.trim() !== b.subject.trim()) out.push('subject');
    if (text !== b.text) out.push('body');
    if (addresses(to).join(',') !== addresses(b.to).join(',')) out.push('to');
    if (addresses(cc).join(',') !== addresses(b.cc).join(',')) out.push('cc');
    return out;
  };
  /** The question about a draft that changed at Outlook was answered: the Outlook version, or what was kept here. */
  const useOutlookVersion = () => {
    const b = base.current;
    setConflict(false);
    if (!b) return;
    setTo(b.to); setCc(b.cc); setShowCc(!!b.cc); setSubject(b.subject); setText(b.text); setFiles([]);
    keep(null);
  };
  const keepMine = () => {
    setConflict(false);
    const b = base.current;
    if (b) keep({ account: from, to, cc, subject, body: text, replyTo: id, mode, modified: b.modified }); // from now on these are changes to the draft as it is at Outlook now
  };

  // Start from a saved draft (so closing the app never loses what you wrote), or from the message being answered.
  useEffect(() => {
    if (!first.current) return; first.current = false;
    if (mode === 'draft') { void openDraft(); return; }
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
    if (mode === 'draft') {
      // Only what you changed is kept: a draft that is as Outlook has it needs nothing saved on the phone (and nothing left over from an edit you took back).
      // While the question about a newer version at Outlook is open nothing is written: what was kept stays as it was, so the question comes again if it is not answered.
      if (loaded.state !== 'ready' || conflict) return;
      if (!changed()) { if (c.loadDraft(slot)) keep(null); return; }
    }
    const t = setTimeout(() => keep({ account: from, to, cc, subject, body: text, replyTo: id, mode, ...(mode === 'draft' && base.current ? { modified: base.current.modified } : {}) }), 800);
    return () => clearTimeout(t);
  }, [from, to, cc, subject, text, files.length, loaded.state, conflict]); // eslint-disable-line react-hooks/exhaustive-deps

  // The files are kept next to the text, so they are still there after the app is closed.
  useEffect(() => {
    if (sent.current || !filesReady.current) return;
    if (mode === 'draft' && !slot) return;
    void c.saveDraftFiles(files, slot).then((ok) => { if (!ok) setProblems(['These files could not be saved on this phone for later. Send the message before you close Post.']); });
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
  const canSend = !busy && !!from && (mode === 'reply' || mode === 'replyAll' ? !!id && (body.length > 0 || files.length > 0)
    : mode === 'forward' ? !!id && rcpt.length > 0
      : mode === 'draft' ? loaded.state === 'ready' && !conflict && !!id && (rcpt.length > 0 || addresses(cc).length > 0 || bcc.length > 0) && (body.length > 0 || subject.trim().length > 0 || files.length > 0 || kept.length > 0)
        : rcpt.length > 0 && (body.length > 0 || subject.trim().length > 0 || files.length > 0));
  const send = async () => {
    setBusy(true);
    sent.current = true;
    const ok = await c.send({ account: from, kind: mode, to: rcpt, cc: addresses(cc), subject: subject.trim(), body: text, replyTo: id, ...(mode === 'draft' ? { edited: edited() } : {}) }, files);
    if (ok) back(); else { sent.current = false; setBusy(false); }
  };
  /** Leaving a draft you changed: keep the changes (and the files you added) in the draft at Outlook, or let them go (the draft stays at Outlook as it was). */
  const saveAndLeave = async () => {
    if (!slot) return;
    setBusy(true); setSaveError(null);
    try {
      await c.saveDraftEdits(slot.account, slot.id, { subject: subject.trim(), body: text, to: rcpt, cc: addresses(cc), edited: edited() }, files);
      sent.current = true; keep(null);
      back();
    } catch (e) { setBusy(false); setSaveError(e instanceof Error && e.message ? e.message : 'Outlook would not take the changes.'); }
  };
  const discardAndLeave = () => { sent.current = true; keep(null); back(); };
  const cancel = () => {
    if (mode === 'draft') { if (loaded.state === 'ready' && changed()) setLeaving(true); else { sent.current = true; back(); } return; }
    if ((text.trim() || files.length) && !confirm('Keep this as a draft?')) c.saveDraft(null);
    back();
  };
  const total = totalBytes(files);
  const heading = mode === 'new' ? 'New message' : mode === 'draft' ? 'Draft' : mode === 'forward' ? 'Forward' : mode === 'replyAll' ? 'Reply all' : 'Reply';

  return (
    <div className="pg" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={dropped}>
      <div className="nav">
        <button className="cancel" onClick={cancel}>Cancel</button>
        <span className="sp" style={{ textAlign: 'center' }}><h1 className="h3 nav-title">{heading}</h1></span>
        <button type="button" className="btn att" aria-label={files.length ? `Attach more files (${files.length} attached)` : 'Attach files'} onClick={() => picker.current?.click()}><Icon n="paperclip" />{files.length > 0 && <span className="cnt" aria-hidden="true">{files.length}</span>}</button>
        <button className="send" disabled={!canSend} onClick={() => void send()}><Icon n="send" size={18} />Send</button>
      </div>
      <div className="scroll">
        {mode === 'draft' && loaded.state === 'loading' && <div role="status" aria-label="Opening the draft" style={{ padding: '18px 20px' }}><span className="sk-l" style={{ width: '40%' }} /><span className="sk-l" style={{ width: '85%' }} /><span className="sk-l" style={{ width: '70%' }} /><span className="sk-l" style={{ width: '60%' }} /></div>}
        {mode === 'draft' && loaded.state === 'failed' && (
          <div className="empty">
            <span className="big">{loaded.error === 'This message has already been sent.' ? 'Already sent' : 'Could not open this draft'}</span>
            {loaded.error}
            <div style={{ marginTop: 14, display: 'flex', gap: 18, justifyContent: 'center' }}>
              {loaded.error !== 'This message has already been sent.' && <button className="link" onClick={() => void openDraft()}>Try again</button>}
              <button className="link" onClick={() => back()}>Back</button>
            </div>
          </div>
        )}
        {(mode !== 'draft' || loaded.state === 'ready') && <>
        <div className="fields">
          {s.accounts.length > 1 && <div className="f"><span className="k">From</span><select aria-label="Send from" disabled={mode === 'draft'} value={from} onChange={(e) => setFrom(e.target.value)}>{s.accounts.map((a) => <option key={a.email} value={a.email}>{a.label} · {a.email}</option>)}</select></div>}
          <div className="f"><span className="k">To</span><input aria-label="To" inputMode="email" autoCapitalize="none" autoCorrect="off" value={to} onChange={(e) => setTo(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder={mode === 'new' ? 'name@example.com' : ''} />{!showCc && <button className="link" onClick={() => setShowCc(true)} style={{ minHeight: 44 }}>Cc</button>}</div>
          {showCc && <div className="f"><span className="k">Cc</span><input aria-label="Cc" inputMode="email" autoCapitalize="none" value={cc} onChange={(e) => setCc(e.target.value)} /></div>}
          {bcc.length > 0 && <div className="f"><span className="k">Bcc</span><span className="ro" aria-label={`Bcc: ${bcc.join(', ')}`}>{bcc.join(', ')}</span></div>}
          <div className="f"><span className="k">Subject</span><input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={mode === 'reply' || mode === 'replyAll'} /></div>
        </div>
        {suggestions.length > 0 && (
          <div className="sugg" role="listbox" aria-label="Suggestions">
            {suggestions.map(([addr, name]) => <button key={addr} className="sg" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => setTo(to.replace(/[^,;\s]*$/, '') + addr + ', ')}><div className="av small" style={avatarHue(addr, name)}>{initials(name, addr)}</div><div><b>{displayName(name, addr)}</b><span>{addr}</span></div></button>)}
          </div>
        )}
        <div className="write"><textarea aria-label="Message" autoFocus={mode === 'reply' || mode === 'replyAll' || mode === 'forward'} value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach(e.clipboardData.files); } }} placeholder={mode === 'forward' ? 'Add a note (optional)' : 'Write your message'} /></div>
        <div className="attach">
          <input ref={picker} type="file" multiple hidden aria-label="Choose files to attach" onChange={(e) => { void attach(e.target.files ?? []); e.target.value = ''; }} />
          <button type="button" className="attach-btn" onClick={() => picker.current?.click()}><Icon n="paperclip" size={20} />Attach files</button>
          {files.length > 0 && <span className="attach-total">{files.length === 1 ? '1 file' : `${files.length} files`} · {fileSize(total)} of {fileSize(MAX_OUT_TOTAL)}</span>}
        </div>
        {kept.length > 0 && (
          <div className="files out" role="list" aria-label="Files already on this draft">
            {kept.map((f) => (
              <div key={f.id} role="listitem" className="file">
                <span className="fi">{tileLabel(f.name)}</span>
                <span className="fn"><b>{f.name}</b><span>{fileSize(f.size)} · already on the draft</span></span>
              </div>
            ))}
          </div>
        )}
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
        {original && (mode === 'reply' || mode === 'replyAll' || mode === 'forward') && <p className="note">The original message is added below your text automatically, like a normal reply. Sending from {labelOf(s, from)}.</p>}
        {mode === 'draft'
          ? <p className="note" style={{ marginTop: 6 }}>{s.settings.undoSend ? `You get ${s.settings.undoSend} seconds to undo after tapping Send. ` : ''}This draft is kept in Outlook. If you change its text, Post saves it as plain text, so formatting and pictures in the text are lost; files already on it stay on it. What you change is kept on this phone until you send it or save it.</p>
          : <p className="note" style={{ marginTop: 6 }}>{s.settings.undoSend ? `You get ${s.settings.undoSend} seconds to undo after tapping Send. ` : ''}Your draft is saved on this device as you type.</p>}
        {dragging && <div className="dropzone" aria-hidden="true"><Icon n="paperclip" size={34} />Drop files to attach them</div>}
        {mode === 'new' && !s.accounts.length && <button className="cta" style={{ margin: 16, width: 'calc(100% - 32px)' }} onClick={() => go({ name: 'accounts' })}>Add an account first</button>}
        </>}
      </div>
      {leaving && (
        <Sheet title="Keep your changes?" onClose={() => { if (!busy) setLeaving(false); }}>
          <div className="card">
            <button className="it" disabled={busy} onClick={() => void saveAndLeave()}><span className="ico"><Icon n="check" /></span><span className="rw">Save to the draft<small>The draft stays in Outlook with your changes</small></span></button>
            <button className="it danger" disabled={busy} onClick={discardAndLeave}><span className="ico"><Icon n="trash" /></span><span className="rw">Throw the changes away<small>The draft stays in Outlook as it was</small></span></button>
            <button className="it" disabled={busy} onClick={() => setLeaving(false)}><span className="ico"><Icon n="edit" /></span>Keep writing</button>
          </div>
          {files.length > 0 && <p className="note">The {files.length === 1 ? 'file' : `${files.length} files`} you added here {files.length === 1 ? 'is' : 'are'} attached to the draft as well. A big file can take a while: keep Post open until this closes.</p>}
          {busy && <p className="note" role="status">Saving to the draft…</p>}
          {saveError && <p className="note warn" role="alert">Could not save: {saveError} Your changes are still here.</p>}
        </Sheet>
      )}
      {conflict && (
        <Sheet title="Draft changed in Outlook" onClose={() => {}}>
          <p className="note" style={{ marginTop: 0 }}>You changed this draft on this phone and left without saving. Since then it has been changed somewhere else too. Which one do you want to go on with?</p>
          <div className="card">
            <button className="it" onClick={useOutlookVersion}><span className="ico"><Icon n="refresh" /></span><span className="rw">Use the one in Outlook<small>The changes you made on this phone are thrown away</small></span></button>
            <button className="it" onClick={keepMine}><span className="ico"><Icon n="edit" /></span><span className="rw">Keep my changes<small>They replace what Outlook has when you send or save</small></span></button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
