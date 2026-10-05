import { useState } from 'react';
import type { State } from '../core/controller.ts';
import { ACCENTS, ACCOUNT_COLOURS, accountColour, type Settings as Cfg } from '../core/settings.ts';
import { makeSetupCode } from '../core/setup.ts';
import { Icon, Seg, Switch } from './ui.tsx';
import { go, useC } from './ctx.tsx';

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

export function Settings({ s }: { s: State }) {
  const c = useC();
  const set = c.setSettings;
  const a = ACCENTS.find((x) => x.id === s.settings.accent) ?? ACCENTS[0];
  const alertsLine = s.alertsOn ? 'On' : 'Off';
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'inbox' })}><Icon n="back" />Inbox</button></div>
      <div className="ttl"><h1 className="h1">Settings</h1></div>
      <div className="scroll">
        <div className="lbl">Alerts</div>
        <div className="card">
          <button className="it" onClick={() => go({ name: 'settings', page: 'alerts' })}><span className="ico"><Icon n="bell" /></span>Icon number & alerts<span className="v"><i className={`ok-dot${s.alertsOn ? '' : ' bad-dot'}`} />{alertsLine}<Icon n="chev" /></span></button>
        </div>
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
        <div className="lbl">Appearance</div>
        <div className="card">
          <button className="it" onClick={() => go({ name: 'settings', page: 'appearance' })}>Accent colour<span className="v"><i className="swatch" style={{ background: a.light }} />{a.name}<Icon n="chev" /></span></button>
          <Pick label="Theme" value={s.settings.theme} options={[['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => set({ theme: v })} />
          <Pick label="Row size" value={s.settings.rowSize} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['roomy', 'Roomy']]} onChange={(v) => set({ rowSize: v })} />
        </div>
        <div className="lbl">This phone</div>
        <div className="card">
          <button className="it" onClick={() => { if (s.config) void navigator.clipboard?.writeText(makeSetupCode(s.config)).then(() => c.toast('Setup code copied')); }}><span className="ico"><Icon n="copy" /></span>Copy setup code<span className="v">for another device</span></button>
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
    ? <div className="it danger" style={{ flexWrap: 'wrap' }}>Remove Post’s setup from this phone? Your mail stays in Outlook.<span className="v"><button className="link" onClick={() => setSure(false)}>Cancel</button><button className="link" style={{ color: 'var(--bad)' }} onClick={() => { c.forgetEverything(); go({ name: 'inbox' }); }}>Remove</button></span></div>
    : <button className="it danger" onClick={() => setSure(true)}><span className="ico"><Icon n="lock" /></span>Remove setup from this phone</button>;
}

export function Appearance({ s }: { s: State }) {
  const c = useC();
  const emails = s.accounts.map((a) => a.email);
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: '' })}><Icon n="back" />Settings</button></div>
      <div className="ttl"><h1 className="h1">Appearance</h1></div>
      <div className="scroll">
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
                <span style={{ display: 'flex', gap: 8 }}>{ACCOUNT_COLOURS.map((col) => <button key={col} aria-label={`${a.label}: ${col}`} aria-pressed={cur === col} onClick={() => c.setSettings({ accountColours: { ...s.settings.accountColours, [a.email]: col } })} style={{ width: 28, height: 28, borderRadius: 14, background: col, border: cur === col ? '3px solid var(--ink)' : '3px solid transparent', padding: 0 }} />)}</span></div>;
            })}</div>
          </>
        )}
      </div>
    </div>
  );
}
