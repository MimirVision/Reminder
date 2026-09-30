import { useEffect, useState } from 'react';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push';
import { useI18n } from '../i18n';

// Turn partner notifications on or off for this device, with an honest explanation when it cannot work.
export function NotificationsControl() {
  const { t, lang } = useI18n();
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (support === 'ok') currentSubscription().then((s) => setOn(!!s && Notification.permission === 'granted')).catch(() => setOn(false));
  }, [support]);

  if (support === 'not-configured') return <span className="muted">{t('push.notConfigured')}</span>;
  if (support === 'needs-install') return <span className="muted">{t('push.needsInstall')}</span>;
  if (support === 'unsupported') return <span className="muted">{t('push.unsupported')}</span>;

  async function toggle() {
    setBusy(true); setMsg(null);
    try {
      if (on) { await disablePush(); setOn(false); }
      else if (await enablePush(lang)) setOn(true);
      else setMsg(t('push.denied'));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="field">
      {on && <span className="muted">{t('push.on')}</span>}
      <div className="row"><button className={`btn small${on ? '' : ' primary'}`} disabled={busy || on === null} onClick={() => void toggle()}>{on ? t('push.disable') : t('push.enable')}</button></div>
      {msg && <span className="error" role="alert">{msg}</span>}
    </div>
  );
}
