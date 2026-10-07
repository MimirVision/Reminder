import { useEffect, useState } from 'react';
import type { AppAccount, State } from '../core/controller.ts';
import { accountColour } from '../core/settings.ts';
import { enablePush, isStandalone, pushSupported } from '../push.ts';
import { Icon, Seg, Switch } from './ui.tsx';
import { go, useC } from './ctx.tsx';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MODE_TEXT: Record<string, string> = { people: 'Primary', all: 'All mail', vips: 'VIPs', off: 'Off' };
const EXTRA_HELP = {
  none: 'Only mail in your Primary tab. A one-time code from a no-reply address will not count.',
  codes: 'One-time codes and sign-in alerts count too, because they cannot wait. Receipts and deliveries do not.',
  transactions: 'Everything in Transactions counts too: receipts, invoices, deliveries, bookings and codes.',
} as const;
const quietText = (a: AppAccount) => (a.quiet ? `${a.quiet.days.length === 5 && a.quiet.days.every((d) => d <= 5) ? 'Mon to Fri' : `${a.quiet.days.length} days`}, ${a.quiet.from} to ${a.quiet.to}` : 'any time');

export function Alerts({ s }: { s: State }) {
  const c = useC();
  const [ms, setMs] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const perm = pushSupported() ? Notification.permission : 'denied';
  useEffect(() => {
    const t0 = performance.now();
    c.device()?.ping().then(() => setMs(Math.round(performance.now() - t0))).catch(() => setMs(null));
  }, [c]);
  const server = c.device();
  const turnOn = async () => {
    if (!server) return;
    setBusy(true); setMsg('');
    const r = await enablePush(server, navigator.language);
    setBusy(false);
    if (!r.ok) setMsg(r.message); else { setMsg('Done. Send a test alert to see it work.'); void c.opened(); }
  };
  const test = async () => {
    if (!server) return;
    setBusy(true);
    try { const r = await server.test(); setMsg(r.sent ? 'Sent. It should arrive in a few seconds, and the icon number goes up by one.' : 'No phone is paired yet. Turn on the icon number first.'); } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };
  const standalone = isStandalone();
  const check = (ok: boolean, text: string, right: string) => <div className="c"><i className={ok ? '' : 'no'}><Icon n={ok ? 'check' : 'x'} size={13} /></i>{text}<span>{right}</span></div>;
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: '' })}><Icon n="back" />Settings</button></div>
      <div className="ttl"><h1 className="h1">Alerts</h1></div>
      <div className="scroll">
        <div className="panel">
          <div className="on-line"><span className={`pulse${s.alertsOn ? '' : ' off'}`} /><div><b>{s.alertsOn ? 'The icon number is on' : 'The icon number is off'}</b><span>{s.alertsOn ? 'New mail adds one to the number on Post’s icon.' : 'Turn it on to see new mail on the Home Screen.'}</span></div></div>
          <div style={{ marginTop: 10 }}>
            {check(standalone, 'Post is on your Home Screen', standalone ? 'OK' : 'Add it')}
            {check(perm === 'granted', 'Notifications are allowed', perm === 'granted' ? 'OK' : perm === 'denied' ? 'Blocked' : 'Not yet')}
            {check(ms !== null, 'Your alert server answers', ms !== null ? `${ms} ms` : 'No answer')}
            {s.serverSmart !== null && check(s.serverSmart, 'Alerts follow your Primary tab', s.serverSmart ? 'OK' : 'Needs update')}
          </div>
          {s.serverSmart === false && <p className="note" role="status" style={{ margin: '10px 0 0', color: 'var(--ink)' }}>Your alert server still has the older code, so mail from companies can still add to the number. The newer code sorts mail like your Primary tab. It takes one paste into Supabase: see docs/POST.md, “Updating the alert server”.</p>}
        </div>
        <div className="btns">
          {!s.alertsOn ? <button className="p" disabled={busy || !standalone} onClick={() => void turnOn()}>Turn on the icon number</button> : <button className="p" disabled={busy} onClick={() => void test()}>Send a test alert</button>}
        </div>
        {!standalone && <p className="note">This works from the Home Screen icon only. Open Post from there (Share, Add to Home Screen).</p>}
        {msg && <p className="note" role="status" style={{ color: 'var(--ink)' }}>{msg}</p>}
        <div className="panel">
          <b style={{ fontSize: 14.5 }}>Only the number, no pop-ups</b>
          <p className="note" style={{ margin: '6px 0 0' }}>In iPhone Settings, Notifications, Post: turn on <b>Badges</b> and turn off Lock Screen, Notification Centre, Banners and Sounds. The number counts new mail since you last opened Post, and clears when you open it.</p>
        </div>
        <div className="lbl">Watching</div>
        <div className="card">
          {s.accounts.map((a) => (
            <button key={a.email} className="it" style={{ minHeight: 68 }} onClick={() => go({ name: 'settings', page: 'hours', account: a.email })}>
              <span className="dotc" style={{ background: accountColour(a.email, s.accounts.map((x) => x.email), s.settings.accountColours) }}>{a.label[0]}</span>
              <span><b style={{ display: 'block', fontSize: 15 }}>{a.email}</b><small>{MODE_TEXT[a.mode]} · {quietText(a)}</small>{a.sub_error && !a.needsSignIn && <small style={{ color: 'var(--bad)' }}>New-mail alerts are off: {a.sub_error}. Your mail still works.</small>}</span><span className="v">{a.needsSignIn ? 'Sign in' : a.sub_error ? 'Mail only' : 'Watching'}<Icon n="chev" /></span>
            </button>
          ))}
          {!s.accounts.length && <div className="it">No accounts yet</div>}
        </div>
        <p className="note">Outside an account’s hours nothing is counted, and the mail is waiting when you open Post. If Post is ever unsure, it counts: a missed mail is worse than an extra one.</p>
      </div>
    </div>
  );
}

export function Hours({ s, email }: { s: State; email: string }) {
  const c = useC();
  const a = s.accounts.find((x) => x.email === email);
  const [vip, setVip] = useState('');
  if (!a) return <div className="pg"><div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: 'alerts' })}><Icon n="back" />Alerts</button></div><div className="empty">Account not found.</div></div>;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = (patch: Parameters<typeof c.setAlerts>[1]) => c.setAlerts(a.email, { ...patch, ...('quiet' in patch ? { tz } : {}) } as never);
  const anyTime = !a.quiet;
  const q = a.quiet ?? { days: [1, 2, 3, 4, 5], from: '07:30', to: '17:00' };
  const toggleDay = (d: number) => void save({ quiet: { ...q, days: q.days.includes(d) ? q.days.filter((x) => x !== d) : [...q.days, d].sort() } });
  const addVip = () => { const v = vip.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+$/.test(v)) return; void save({ vips: [...new Set([...a.vips, v])] }); setVip(''); };
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: 'alerts' })}><Icon n="back" />Alerts</button></div>
      <div className="ttl"><h1 className="h1">Alert hours</h1><p className="sub">Choose when each account may add to the icon number. Mail always arrives; this only decides when Post taps your shoulder.</p></div>
      <div className="scroll">
        <div className="panel">
          <div className="acc-h"><span className="dotc" style={{ background: accountColour(a.email, s.accounts.map((x) => x.email), s.settings.accountColours) }}>{a.label[0]}</span><div><b>{a.label}</b><span>{a.email}</span></div></div>
          <div className="lbl" style={{ margin: '14px 2px 6px' }}>Count new mail from</div>
          <Seg label="Count new mail from" value={a.mode} options={[['people', 'Primary'], ['all', 'All mail'], ['vips', 'VIPs'], ['off', 'Off']]} onChange={(v) => void save({ mode: v })} />
          {a.mode === 'people' && (
            <>
              <p className="note" style={{ margin: '8px 2px 0' }}>Counts mail that lands in your Primary tab, with the senders you moved there, and never mail you moved to another tab.</p>
              {s.serverSmart !== false && (
                <>
                  <div className="lbl" style={{ margin: '14px 2px 6px' }}>Besides Primary, also count</div>
                  <Seg label="Besides Primary, also count" value={a.extra ?? 'codes'} options={[['none', 'Nothing'], ['codes', 'Codes'], ['transactions', 'Transactions']]} onChange={(v) => void c.setExtra(a.email, v)} />
                  <p className="note" style={{ margin: '8px 2px 0' }}>{EXTRA_HELP[a.extra ?? 'codes']}</p>
                </>
              )}
            </>
          )}
          <div className="any">Any time of day<Switch on={anyTime} label="Any time of day" onChange={(v) => void save({ quiet: v ? null : q })} /></div>
          {!anyTime && (
            <>
              <div className="lbl" style={{ margin: '10px 2px 6px' }}>Only on these days</div>
              <div className="days">{DAYS.map((d, i) => <button key={i} className={q.days.includes(i + 1) ? 'on' : ''} aria-pressed={q.days.includes(i + 1)} aria-label={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]} onClick={() => toggleDay(i + 1)}>{d}</button>)}</div>
              <div className="times">
                <label className="t"><small>FROM</small><input type="time" value={q.from} onChange={(e) => e.target.value && void save({ quiet: { ...q, from: e.target.value } })} /></label>
                <label className="t"><small>TO</small><input type="time" value={q.to} onChange={(e) => e.target.value && void save({ quiet: { ...q, to: e.target.value } })} /></label>
              </div>
            </>
          )}
        </div>
        <div className="panel">
          <b style={{ fontSize: 14.5 }}>Always count mail from</b>
          <p className="note" style={{ margin: '2px 0 0' }}>These people count whatever the hours.</p>
          <div className="vip">{a.vips.map((v) => <span key={v} className="vc">{v}<button aria-label={`Remove ${v}`} className="btn plain" style={{ width: 28, height: 28 }} onClick={() => void save({ vips: a.vips.filter((x) => x !== v) })}><Icon n="x" size={14} /></button></span>)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input className="field" style={{ height: 48, flex: 1 }} aria-label="Add a person by email" inputMode="email" autoCapitalize="none" placeholder="name@example.com" value={vip} onChange={(e) => setVip(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addVip()} />
            <button className="send" onClick={addVip}>Add</button>
          </div>
        </div>
        <p className="note">Hours use this phone’s time zone ({tz}).</p>
      </div>
    </div>
  );
}
