import { useMemo, useState } from 'react';
import { parseTasks } from '../../lib/quickAdd.ts';
import type { Mail } from '../core/types.ts';
import { Icon, Sheet } from './ui.tsx';
import { useC } from './ctx.tsx';

// "Remind me": turns a message into a Home Memory to-do. Post finds the date in the text with Home Memory's own parser, so what it says
// it found is exactly what Home Memory will understand. Home Memory is a separate app with its own sign-in, so the hand-over is a link.

export function RemindSheet({ m, preview, onClose }: { m: Mail; preview: string; onClose: () => void }) {
  const c = useC();
  const [title, setTitle] = useState(m.subject.replace(/^(re|fw|fwd|sv|vs):\s*/i, '').trim());
  const found = useMemo(() => {
    try {
      const t = parseTasks(`${m.subject}. ${preview.slice(0, 400)}`, { places: [] })[0];
      return t && (t.due_on || t.due_time) ? t : null;
    } catch { return null; }
  }, [m.subject, preview]);
  const when = found ? [found.due_on ? new Date(`${found.due_on}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '', found.due_time ? `at ${found.due_time}` : ''].filter(Boolean).join(' ') : '';
  const text = found && !/\d/.test(title) && when ? `${title} ${found.due_on ?? ''} ${found.due_time ?? ''}`.trim() : title;
  // Home Memory already opens its add sheet from a share link (Web Share Target), so the hand-over needs nothing new on its side.
  const link = `${location.origin}/?share=1&text=${encodeURIComponent(text)}`;
  return (
    <Sheet title="Remind me" onClose={onClose}>
      {found && <div className="bn bn-ok" style={{ margin: '0 0 12px' }}><Icon n="clock" size={18} /><div><b>Date found</b>{when}</div></div>}
      <label className="lbl" htmlFor="rm-title" style={{ marginTop: 4 }}>To-do</label>
      <input id="rm-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      <a className="cta" style={{ marginTop: 14, textDecoration: 'none' }} href={link} target="_blank" rel="noopener" onClick={onClose}>Add to Home Memory</a>
      <button className="alt" onClick={() => { void navigator.clipboard?.writeText(text).then(() => c.toast('Copied. Paste it in Home Memory’s add bar.')); onClose(); }}><Icon n="copy" size={18} /> Copy the text instead</button>
      <p className="note">Home Memory opens with this filled in. If it asks you to sign in first, do that once and tap the link again.</p>
    </Sheet>
  );
}
