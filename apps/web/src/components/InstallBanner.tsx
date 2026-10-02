import { useEffect, useState } from 'react';
import { currentInstallKind, onInstallChange, promptInstall } from '../lib/install';
import { useI18n } from '../i18n';
import { Icon } from './icons';

const KEY = 'hm.installDismissed';

// A gentle "add to home screen" card, shown once there is something worth coming back to, until it is dismissed.
export function InstallBanner() {
  const { t } = useI18n();
  const [kind, setKind] = useState(currentInstallKind);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  useEffect(() => onInstallChange(() => setKind(currentInstallKind())), []);
  if (hidden || (kind !== 'prompt' && kind !== 'ios')) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
  return (
    <section className="card install" aria-label={t('install.title')}>
      <div className="row spread">
        <strong>{t('install.title')}</strong>
        <button className="mini" aria-label={t('install.later')} onClick={dismiss}><Icon name="x" size={14} /></button>
      </div>
      <span className="muted">{t('install.body')}</span>
      {kind === 'prompt'
        ? <div className="row"><button className="btn small primary" onClick={() => void promptInstall().then((ok) => ok && dismiss())}>{t('install.button')}</button><button className="btn small" onClick={dismiss}>{t('install.later')}</button></div>
        : <ol className="steps"><li>{t('install.iosStep1')}</li><li>{t('install.iosStep2')}</li><li>{t('install.iosStep3')}</li></ol>}
    </section>
  );
}
