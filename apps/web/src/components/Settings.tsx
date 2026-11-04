import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createCaptureKey, deleteCaptureKey, deleteMyAccount, listCaptureKeys, rotateInviteCode, type CaptureKey } from '../lib/api';
import { applyGlass, getGlass, GLASS_LEVELS, type GlassLevel } from '../lib/glass';
import { downloadExport } from '../lib/exportZip';
import { ReminderLinks } from './ReminderLinks';
import { WeatherSettings } from './WeatherSettings';
import { inviteLink } from '../lib/invite';
import { supabase } from '../lib/supabase';
import type { Household } from '../lib/types';
import { LanguageSwitch, useI18n } from '../i18n';
import { ThemeSwitch } from '../theme';
import { applyContrast, applyTextSize, getContrast, getTextSize, TEXT_SIZES, type Contrast, type TextSize } from '../lib/a11y';
import { useDesktop } from '../lib/useDesktop';
import { NotificationsControl } from './NotificationsControl';
import { Icon } from './icons';

type Section = 'reminders' | 'weather' | 'appearance' | 'household' | 'data' | 'advanced';
const SECTIONS: { id: Section; icon: 'clock' | 'calendar' | 'settings' | 'house' | 'note' | 'filter' }[] = [
  { id: 'reminders', icon: 'clock' }, { id: 'weather', icon: 'calendar' }, { id: 'appearance', icon: 'settings' },
  { id: 'household', icon: 'house' }, { id: 'data', icon: 'note' }, { id: 'advanced', icon: 'filter' },
];

// Settings: a short list of areas, each opening its own page (on a computer the list stays on the left and the page opens on the right).
export function Settings({ household }: { household: Household }) {
  const { t, lang, locale } = useI18n();
  const desktop = useDesktop();
  const [section, setSection] = useState<Section | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [label, setLabel] = useState(() => t('quick.defaultLabel'));
  const [fresh, setFresh] = useState<string | null>(null);
  const [glass, setGlass] = useState<GlassLevel>(getGlass);
  const [invite, setInvite] = useState(household.invite_code);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [recap, setRecap] = useState(() => { try { return localStorage.getItem('hm.recap') === '1'; } catch { return false; } });
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [acctBusy, setAcctBusy] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>(getTextSize);
  const [contrast, setContrast] = useState<Contrast>(getContrast);

  const load = useCallback(async () => {
    try { setKeys(await listCaptureKeys()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/capture_memory`;
  const current: Section | null = section ?? (desktop ? 'reminders' : null);

  const pages: Record<Section, ReactNode> = {
    reminders: (
      <>
        <section className="card">
          <h2>{t('push.title')}</h2>
          <span className="muted">{t('push.intro')}</span>
          <NotificationsControl />
        </section>
        <ReminderLinks household={household} />
        <section className="card">
          <h2>{t('set.todoList')}</h2>
          <label className="row spread">
            <span><strong>{t('set.recap')}</strong><span className="muted" style={{ display: 'block' }}>{t('set.recapBody')}</span></span>
            <input type="checkbox" className="switch" checked={recap} aria-label={t('set.recap')} onChange={(e) => { setRecap(e.target.checked); try { localStorage.setItem('hm.recap', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
          </label>
        </section>
      </>
    ),
    weather: <WeatherSettings household={household} />,
    appearance: (
      <section className="card">
        <h3 className="sub">{t('set.language')}</h3>
        <LanguageSwitch />
        <h3 className="sub">{t('set.theme')}</h3>
        <ThemeSwitch />
        <h3 className="sub">{t('a11y.title')}</h3>
        <span className="muted">{t('a11y.textSize')}</span>
        <div className="row">
          {TEXT_SIZES.map((s) => (
            <button key={s} className={`btn small${textSize === s ? ' primary' : ''}`} aria-pressed={textSize === s} onClick={() => { setTextSize(s); applyTextSize(s); }}>{t(`a11y.${s}` as 'a11y.normal')}</button>
          ))}
        </div>
        <span className="muted">{t('a11y.contrast')}: {t('a11y.contrastHelp')}</span>
        <div className="row">
          {(['normal', 'high'] as const).map((c) => (
            <button key={c} className={`btn small${contrast === c ? ' primary' : ''}`} aria-pressed={contrast === c} onClick={() => { setContrast(c); applyContrast(c); }}>{c === 'high' ? t('a11y.on') : t('a11y.off')}</button>
          ))}
        </div>
        <h3 className="sub">{t('glass.title')}</h3>
        <span className="muted">{t('glass.help')}</span>
        <div className="row">
          {GLASS_LEVELS.map((g) => (
            <button key={g} className={`btn small${glass === g ? ' primary' : ''}`} aria-pressed={glass === g} onClick={() => { setGlass(g); applyGlass(g); }}>{t(`glass.${g}` as const)}</button>
          ))}
        </div>
        <div className="glass previewbar">{t('glass.preview')}</div>
        <span className="muted">{t('glass.note')}</span>
      </section>
    ),
    household: (
      <section className="card">
        <h2>{t('hh.title')}</h2>
        <span>{household.name}</span>
        <span className="muted">{t('hh.invite')} <code>{invite}</code></span>
        <div className="row">
          <button className="btn small primary" onClick={async () => {
            const link = inviteLink(window.location.origin, invite);
            try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt(t('hh.sendLink'), link); }
          }}>{copied ? t('common.copied') : t('hh.copyLink')}</button>
          <button className="btn small" onClick={() => confirm(t('hh.confirmNew')) && void run(async () => setInvite(await rotateInviteCode(household.id)))}>{t('hh.newCode')}</button>
        </div>
      </section>
    ),
    data: (
      <>
        <section className="card">
          <h2>{t('data.title')}</h2>
          <span className="muted">{t('data.intro')}</span>
          <button className="btn" disabled={exportBusy} onClick={() => {
            setExportBusy(true);
            setExporting(t('data.starting'));
            downloadExport(household.id, household.name, setExporting, t, lang)
              .catch((e) => setExporting(t('data.failed', { msg: e instanceof Error ? e.message : String(e) })))
              .finally(() => setExportBusy(false));
          }}>{t('data.export')}</button>
          {exporting && <span className="muted" role="status">{exporting}</span>}
        </section>
        <section className="card">
          <h2>{t('acct.title')}</h2>
          <a className="link" href="/privacy.html" target="_blank" rel="noreferrer">{t('acct.privacy')}</a>
          {deleting ? (
            <>
              <span className="muted">{t('acct.deleteIntro')}</span>
              <input placeholder={t('acct.typeToConfirm')} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" />
              <div className="row">
                <button className="btn danger" disabled={acctBusy || confirmText.trim().toUpperCase() !== t('acct.confirmWord')}
                  onClick={() => { setAcctBusy(true); void deleteMyAccount(household.id).catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setAcctBusy(false); }); }}>
                  {acctBusy ? t('acct.deleting') : t('acct.deleteConfirmBtn')}
                </button>
                <button className="btn" onClick={() => { setDeleting(false); setConfirmText(''); }}>{t('common.cancel')}</button>
              </div>
            </>
          ) : (
            <button className="btn small danger" onClick={() => setDeleting(true)}>{t('acct.delete')}</button>
          )}
        </section>
      </>
    ),
    advanced: (
      <section className="card">
        <h2>{t('quick.title')}</h2>
        <span className="muted">{t('quick.intro')}</span>
        {keys.length === 0 && <span className="muted">{t('quick.none')}</span>}
        {keys.map((k) => (
          <div key={k.id} className="row spread">
            <span>{k.label}<span className="muted"> · {k.last_used_at ? t('rem.lastUsed', { date: new Date(k.last_used_at).toLocaleDateString(locale) }) : t('quick.neverUsed')}</span></span>
            <button className="btn small danger" onClick={() => confirm(t('quick.revokeConfirm')) && void run(() => deleteCaptureKey(k.id))}>{t('common.revoke')}</button>
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => setFresh(await createCaptureKey(household.id, label))); }}>
          <input className="growfield" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('quick.label')} />
          <button className="btn primary small">{t('quick.create')}</button>
        </form>
        {fresh && <div><span className="muted">{t('quick.copyNow')}</span><br /><code>{fresh}</code></div>}
        <span className="muted">{t('quick.endpoint')}</span>
        <code>{endpoint}</code>
        <span className="muted">{t('set.version')}: {__BUILD__}</span>
      </section>
    ),
  };

  const list = (
    <nav className="set-list" aria-label={t('set.title')}>
      {SECTIONS.map((s) => (
        <button key={s.id} type="button" className={`set-row${current === s.id ? ' on' : ''}`} aria-current={current === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
          <span className="set-ico"><Icon name={s.icon} size={20} /></span>
          <span className="set-txt"><strong>{t(`set.sec.${s.id}` as 'set.sec.reminders')}</strong><span className="muted">{t(`set.sec.${s.id}.sub` as 'set.sec.reminders.sub')}</span></span>
          <Icon name="chevron" size={18} />
        </button>
      ))}
    </nav>
  );

  return (
    <main className={`page settings-page set-shell${desktop ? ' split' : ''}`}>
      {current && !desktop ? (
        <div className="set-head"><button type="button" className="btn small" onClick={() => setSection(null)}><span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}><Icon name="chevron" size={14} /></span> {t('set.back')}</button><h1>{t(`set.sec.${current}` as 'set.sec.reminders')}</h1></div>
      ) : <h1>{t('set.title')}</h1>}
      {err && <p className="error" role="alert">{err}</p>}
      {desktop ? (
        <div className="set-split">
          <div className="set-side">{list}<button className="btn danger" onClick={() => supabase.auth.signOut()}>{t('auth.signOut')}</button></div>
          <div className="set-page"><h2 className="set-title">{t(`set.sec.${current ?? 'reminders'}` as 'set.sec.reminders')}</h2>{pages[current ?? 'reminders']}</div>
        </div>
      ) : current ? (
        <div className="set-page">{pages[current]}</div>
      ) : (
        <>
          {list}
          <button className="btn danger" onClick={() => supabase.auth.signOut()}>{t('auth.signOut')}</button>
          <p className="muted center">{t('set.version')}: {__BUILD__}</p>
        </>
      )}
    </main>
  );
}
