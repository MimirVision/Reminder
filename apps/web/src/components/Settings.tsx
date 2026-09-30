import { useCallback, useEffect, useState } from 'react';
import { createCaptureKey, deleteCaptureKey, listCaptureKeys, rotateInviteCode, type CaptureKey } from '../lib/api';
import { applyGlass, getGlass, GLASS_LEVELS, type GlassLevel } from '../lib/glass';
import { downloadExport } from '../lib/exportZip';
import { ReminderLinks } from './ReminderLinks';
import { inviteLink } from '../lib/invite';
import { supabase } from '../lib/supabase';
import type { Household } from '../lib/types';
import { LanguageSwitch, useI18n } from '../i18n';
import { ThemeSwitch } from '../theme';
import { applyContrast, applyTextSize, getContrast, getTextSize, TEXT_SIZES, type Contrast, type TextSize } from '../lib/a11y';
import { NotificationsControl } from './NotificationsControl';

export function Settings({ household }: { household: Household }) {
  const { t, lang, locale } = useI18n();
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [label, setLabel] = useState(() => t('quick.defaultLabel'));
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [glass, setGlass] = useState<GlassLevel>(getGlass);
  const [invite, setInvite] = useState(household.invite_code);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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

  return (
    <main className="page">
      <h1>{t('set.title')}</h1>
      {err && <p className="error">{err}</p>}

      <section className="card">
        <h2>{t('set.language')}</h2>
        <LanguageSwitch />
        <h2 className="gap">{t('set.appearance')}</h2>
        <ThemeSwitch />
      </section>

      <section className="card">
        <h2>{t('push.title')}</h2>
        <span className="muted">{t('push.intro')}</span>
        <NotificationsControl />
      </section>

      <section className="card">
        <h2>{t('a11y.title')}</h2>
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
      </section>

      <section className="card">
        <h2>{t('glass.title')}</h2>
        <span className="muted">{t('glass.help')}</span>
        <div className="row">
          {GLASS_LEVELS.map((g) => (
            <button key={g} className={`btn small${glass === g ? ' primary' : ''}`} aria-pressed={glass === g} onClick={() => { setGlass(g); applyGlass(g); }}>{t(`glass.${g}` as const)}</button>
          ))}
        </div>
        <div className="glass previewbar">{t('glass.preview')}</div>
        <span className="muted">{t('glass.note')}</span>
      </section>

      <ReminderLinks household={household} />

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
      </section>

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

      <button className="btn danger" onClick={() => supabase.auth.signOut()}>{t('auth.signOut')}</button>
    </main>
  );
}
