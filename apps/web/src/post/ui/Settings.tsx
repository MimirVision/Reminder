import { useState } from 'react';
import { mailCounts, type State } from '../core/controller.ts';
import { ACCENTS, ACCOUNT_COLOURS, LOOKS, accountColour, lookChange, type Settings as Cfg } from '../core/settings.ts';
import { sortingReport } from '../core/report.ts';
import { asKind, KINDS, KIND_TAB, type Kind } from '../core/types.ts';
import { Icon, KIND_ICON, Seg, Switch } from './ui.tsx';
import { go, useC, useNow } from './ctx.tsx';
import { Alerts, Hours } from './Alerts.tsx';
import { Health, dotOf, useHealthLine } from './Health.tsx';

declare const __BUILD__: string;

function Pick<T extends string>({ icon, label, value, options, onChange }: { icon?: string; label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const shown = options.find(([v]) => v === value)?.[1] ?? '';
  return (
    <label className="it" style={{ position: 'relative' }}>
      {icon && <span className="ico"><Icon n={icon} /></span>}{label}
      <span className="v">{shown}<Icon n="chev" /></span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%' }}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

const SWIPE: [Cfg['swipeRight'], string][] = [['archive', 'Archive'], ['read', 'Mark read'], ['flag', 'Flag'], ['delete', 'Delete']];
const SWIPE_L: [Cfg['swipeLeft'], string][] = [['snooze', 'Snooze'], ['flag', 'Flag'], ['delete', 'Delete'], ['read', 'Mark read']];

/** Which settings page an address means. The phone layout and the computer layout both ask here, so a new page only needs adding once. */
export function SettingsPage({ s, page, account }: { s: State; page: string; account?: string }) {
  switch (page) {
    case 'alerts': return <Alerts s={s} />;
    case 'hours': return <Hours s={s} email={account ?? ''} />;
    case 'appearance': return <Appearance s={s} />;
    case 'sorting': return <Sorting s={s} />;
    case 'health': return <Health s={s} />;
    default: return <Settings s={s} />;
  }
}

export function Settings({ s }: { s: State }) {
  const c = useC();
  const set = c.setSettings;
  const a = ACCENTS.find((x) => x.id === s.settings.accent) ?? ACCENTS[0];
  const alertsLine = s.alertsOn ? 'On' : 'Off';
  const health = useHealthLine(s);
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'inbox' })}><Icon n="back" />Inbox</button></div>
      <div className="ttl"><h1 className="h1">Settings</h1></div>
      <div className="scroll">
        <div className="lbl">Alerts</div>
        <div className="card">
          <button className="it" onClick={() => go({ name: 'settings', page: 'alerts' })}><span className="ico"><Icon n="bell" /></span>Icon number & alerts<span className="v"><i className={`ok-dot${s.alertsOn ? '' : ' bad-dot'}`} />{alertsLine}<Icon n="chev" /></span></button>
        </div>
        <div className="lbl">Sorting</div>
        <div className="card">
          <button className="it" onClick={() => go({ name: 'settings', page: 'sorting' })}><span className="ico"><Icon n="sliders" /></span>Tabs and rules<span className="v">{sortingLine(s)}<Icon n="chev" /></span></button>
        </div>
        <div className="lbl">Conversations</div>
        <div className="card">
          <div className="it"><span className="ico"><Icon n="reply" /></span>Group replies together<Switch on={s.settings.threads} onChange={(v) => set({ threads: v })} label="Group replies together" /></div>
        </div>
        <p className="note">Messages that answer each other are one row in the list, and one conversation when you open it, with your own replies in it. Nothing is hidden: every message is still there.</p>
        <div className="lbl">Swipe</div>
        <div className="card">
          <Pick icon="archive" label="Swipe right" value={s.settings.swipeRight} options={SWIPE} onChange={(v) => set({ swipeRight: v })} />
          <Pick icon="clock" label="Swipe left" value={s.settings.swipeLeft} options={SWIPE_L} onChange={(v) => set({ swipeLeft: v })} />
        </div>
        <div className="lbl">Privacy</div>
        <div className="card">
          <div className="it">Block remote images<Switch on={s.settings.blockImages} onChange={(v) => set({ blockImages: v })} label="Block remote images" /></div>
          <div className="it">Send read receipts<span className="v">Never</span></div>
          <div className="it">Add “Sent from Post”<span className="v">Never</span></div>
        </div>
        <p className="note">Remote images are how senders see that you opened a mail. They stay blocked until you tap Load once.</p>
        <div className="lbl">Writing</div>
        <div className="card">
          <Pick label="Undo send" value={String(s.settings.undoSend)} options={[['0', 'Off'], ['5', '5 seconds'], ['10', '10 seconds'], ['20', '20 seconds'], ['30', '30 seconds']]} onChange={(v) => set({ undoSend: Number(v) })} />
          <div className="it" style={{ alignItems: 'flex-start', flexDirection: 'column', padding: '12px 16px' }}>Signature<textarea className="field" aria-label="Signature" rows={2} placeholder="None" value={s.settings.signature} onChange={(e) => set({ signature: e.target.value })} style={{ minHeight: 64, marginTop: 6 }} /></div>
        </div>
        <p className="note">Undo works while Post is on screen. If you leave Post, what is waiting is sent right away, so it never gets stuck on a phone that has put Post to sleep.</p>
        <div className="lbl">Appearance</div>
        <div className="card">
          <Pick label="Look" value={s.settings.look} options={LOOKS} onChange={(v) => set(lookChange(s.settings, v))} />
          <button className="it" onClick={() => go({ name: 'settings', page: 'appearance' })}>Accent colour<span className="v"><i className="swatch" style={{ background: a.light }} />{a.name}<Icon n="chev" /></span></button>
          <Pick label="Theme" value={s.settings.theme} options={[['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => set({ theme: v })} />
          <Pick label="Row size" value={s.settings.rowSize} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['roomy', 'Roomy']]} onChange={(v) => set({ rowSize: v })} />
        </div>
        <div className="lbl">This device</div>
        <div className="card">
          <button className="it" onClick={() => go({ name: 'settings', page: 'health' })}><span className="ico"><Icon n="pulse" /></span>Health<span className="v"><i className={dotOf(health.level)} />{health.text}<Icon n="chev" /></span></button>
          <ForgetRow />
        </div>
        <p className="note">Version {typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}</p>
      </div>
    </div>
  );
}

function ForgetRow() {
  const c = useC();
  const [sure, setSure] = useState(false);
  return sure
    ? <div className="it danger" style={{ flexWrap: 'wrap' }}>Sign out of Post on this device? Your mail stays in Outlook.<span className="v"><button className="link" onClick={() => setSure(false)}>Cancel</button><button className="link" style={{ color: 'var(--bad)' }} onClick={() => { c.forgetEverything(); go({ name: 'inbox' }); }}>Sign out</button></span></div>
    : <button className="it danger" onClick={() => setSure(true)}><span className="ico"><Icon n="lock" /></span>Sign out on this device</button>;
}

export function Appearance({ s }: { s: State }) {
  const c = useC();
  const emails = s.accounts.map((a) => a.email);
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: '' })}><Icon n="back" />Settings</button></div>
      <div className="ttl"><h1 className="h1">Appearance</h1></div>
      <div className="scroll">
        <div className="lbl">Look</div>
        <div className="panel" style={{ marginTop: 0 }}><Seg label="Look" value={s.settings.look} options={LOOKS} onChange={(v) => c.setSettings(lookChange(s.settings, v))} /></div>
        <p className="note">Refined is warm, with rounded cards. Calm is plain and quiet, close to the apps that come with the phone. The same mail, the same buttons: only how it looks changes.</p>
        <div className="lbl">Accent colour</div>
        <div className="card"><div className="accent-grid" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => <button key={a.id} role="radio" aria-checked={s.settings.accent === a.id} className={`accent${s.settings.accent === a.id ? ' on' : ''}`} onClick={() => c.setSettings({ accent: a.id })}><i style={{ background: a.light }} />{a.name}</button>)}
        </div></div>
        <div className="lbl">Theme</div>
        <div className="panel" style={{ marginTop: 0 }}><Seg label="Theme" value={s.settings.theme} options={[['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => c.setSettings({ theme: v })} /></div>
        <div className="card" style={{ marginTop: 10 }}><div className="it">Pure black in dark mode<Switch on={s.settings.pureBlack} onChange={(v) => c.setSettings({ pureBlack: v })} label="Pure black" /></div></div>
        <p className="note">Pure black saves battery on iPhones with an OLED screen.</p>
        <div className="lbl">Row size</div>
        <div className="panel" style={{ marginTop: 0 }}><Seg label="Row size" value={s.settings.rowSize} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['roomy', 'Roomy']]} onChange={(v) => c.setSettings({ rowSize: v })} /></div>
        {s.accounts.length > 1 && (
          <>
            <div className="lbl">Account colours</div>
            <div className="card">{s.accounts.map((a) => {
              const cur = accountColour(a.email, emails, s.settings.accountColours);
              return <div key={a.email} className="it" style={{ flexWrap: 'wrap' }}><span className="dotc" style={{ background: cur }}>{a.label[0]}</span><span style={{ flex: 1 }}>{a.label}<small>{a.email}</small></span>
                <span style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>{ACCOUNT_COLOURS.map((col) => <button key={col} aria-label={`${a.label}: ${col}`} aria-pressed={cur === col} onClick={() => c.setSettings({ accountColours: { ...s.settings.accountColours, [a.email]: col } })} style={{ width: 40, height: 40, borderRadius: 20, border: 0, padding: 0, background: `radial-gradient(circle, ${col} 0 11px, transparent 12px), ${cur === col ? 'radial-gradient(circle, transparent 0 13px, var(--ink) 14px 16px, transparent 17px)' : 'none'}` }} />)}</span></div>;
            })}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** How the inbox is sorted: the four tabs and what is in them, the rules you made by moving a sender, and a report for improving the rules. */
/** What the Settings row for sorting says: how many rules you made and how many senders are blocked. */
function sortingLine(s: State): string {
  const rules = Object.keys(s.overrides).filter((k) => !s.blocked.includes(k)).length;
  const parts = [rules ? `${rules} rule${rules > 1 ? 's' : ''}` : '', s.blocked.length ? `${s.blocked.length} blocked` : ''].filter(Boolean);
  return parts.join(', ') || 'Automatic';
}

export function Sorting({ s }: { s: State }) {
  const c = useC();
  const now = useNow();
  // The sorting is about messages, so this page counts messages even when the list groups them into conversations.
  const counts = mailCounts({ mail: s.mail, accountFilter: null, settings: { ...s.settings, threads: false } }, now);
  const rules = Object.entries(s.overrides).filter(([key]) => !s.blocked.includes(key)).sort((a, b) => a[0].localeCompare(b[0])); // a blocked sender is listed under Blocked senders
  const [report, setReport] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const copy = async () => {
    const text = sortingReport(s.mail, s.overrides, new Date().toISOString().slice(0, 10));
    setReport(text);
    try { await navigator.clipboard.writeText(text); setNote('Copied. Paste it where you report problems with the sorting.'); } catch { setNote('Press and hold the text below to copy it.'); }
  };
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: '' })}><Icon n="back" />Settings</button></div>
      <div className="ttl"><h1 className="h1">Sorting</h1></div>
      <div className="scroll">
        <p className="note" style={{ marginTop: 8 }}>Post puts each message in one of four tabs, like iOS Mail. It looks at who sent it, what the subject says, and the hidden marks that bulk mail carries. Nothing is ever hidden: All shows everything, and a message it is unsure about stays in Primary.</p>
        <div className="lbl">In your inbox now</div>
        <div className="card">
          {KINDS.map((k) => <div key={k} className="it"><span className="ico"><Icon n={KIND_ICON[k]} /></span>{KIND_TAB[k]}<span className="v">{counts.byKind[k].total}{counts.byKind[k].unread ? ` · ${counts.byKind[k].unread} unread` : ''}</span></div>)}
        </div>
        {counts.unsorted > 0 && <p className="note">{counts.unsorted} of {counts.total} are still first guesses. Post reads the hidden marks of the rest in the background.</p>}
        <div className="lbl">Your rules</div>
        {rules.length ? (
          <div className="card">
            {rules.map(([key, kind]) => (
              <div key={key} className="it rule">
                <span className="ico"><Icon n={KIND_ICON[kind]} /></span>
                <span className="rw">{key.startsWith('@') ? key.slice(1) : key}<small>{key.startsWith('@') ? 'Everything from this company' : 'This sender only'}</small></span>
                <label className="rs">{KIND_TAB[kind]}<Icon n="chev" size={16} />
                  <select aria-label={`Tab for ${key}`} value={kind} onChange={(e) => { const k = asKind(e.target.value); if (k) void c.moveSender(key.startsWith('@') ? `x${key}` : key, k as Kind, key.startsWith('@') ? 'company' : 'sender'); }}>
                    {KINDS.map((k) => <option key={k} value={k}>{KIND_TAB[k]}</option>)}
                  </select>
                </label>
                <button className="btn plain" aria-label={`Remove the rule for ${key}`} style={{ width: 40, height: 40 }} onClick={() => void c.removeRule(key)}><Icon n="x" size={16} /></button>
              </div>
            ))}
          </div>
        ) : <p className="note" style={{ marginTop: 0 }}>No rules yet. When a message is in the wrong tab, open it, tap Why, and move it: one tap fixes that sender from then on.</p>}
        <div className="lbl">Blocked senders</div>
        {s.blocked.length ? (
          <div className="card">
            {s.blocked.map((key) => (
              <div key={key} className="it rule">
                <span className="ico"><Icon n="ban" /></span>
                <span className="rw">{key.startsWith('@') ? key.slice(1) : key}<small>{key.startsWith('@') ? 'Everything from this company' : 'This sender only'}</small></span>
                <button className="btn plain" style={{ width: 'auto', height: 44, padding: '0 12px' }} aria-label={`Unblock ${key.startsWith('@') ? key.slice(1) : key}`} onClick={() => void c.unblock(key)}>Unblock</button>
              </div>
            ))}
          </div>
        ) : <p className="note" style={{ marginTop: 0 }}>Nobody is blocked. Open a message, tap More, then Block sender: their mail goes to Junk from then on.</p>}
        <p className="note">Blocked mail is moved to Junk, never deleted, whenever Post is open. While Post is closed it waits in your Outlook inbox until the next time you open Post. Mail you bring back from Junk stays where you put it.</p>
        <div className="lbl">Clean up old promotions</div>
        <div className="card">
          <Pick label="Archive by itself" value={String(s.settings.autoClean)} options={[['0', 'Off'], ['3', 'After 3 days'], ['7', 'After 7 days'], ['14', 'After 14 days'], ['30', 'After 30 days']]} onChange={(v) => c.setSettings({ autoClean: Number(v) })} />
        </div>
        <p className="note">Promotions older than this are archived while Post is open, with an Undo. Mail you flagged, mail Post has only guessed a tab for, and mail you brought back are left alone. Archived mail is still in Outlook, in Archive.</p>
        <p className="note">{s.serverSmart === false ? 'The icon number does not follow these tabs yet: your alert server still has the older code. See Settings, Alerts.' : 'The icon number follows these tabs too: when Alerts is set to Primary, mail from a sender you moved out of Primary does not count (people on your VIP list always do).'}</p>
        <div className="lbl">Help improve the sorting</div>
        <div className="card"><button className="it" onClick={() => void copy()}><span className="ico"><Icon n="copy" /></span>Copy sorting report</button></div>
        <p className="note">A summary of how your inbox was sorted: companies and counts only, never subjects, names or addresses.</p>
        {note && <p className="note" role="status" style={{ color: 'var(--ink)' }}>{note}</p>}
        {report && <textarea className="field code-box" readOnly aria-label="Sorting report" rows={10} value={report} onFocus={(e) => e.currentTarget.select()} />}
      </div>
    </div>
  );
}
