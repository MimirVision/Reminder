import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';

const KEYS: [string, string][] = [
  ['N', 'desk.keyNew'], ['/', 'desk.keySearch'], ['Ctrl K', 'desk.keyPalette'], ['1–4', 'desk.keyTabs'], ['V', 'cmd.keyView'], ['?', 'cmd.keyHelp'],
  ['J K ↑ ↓', 'desk.keyMove'], ['X', 'desk.keyDone'], ['E Enter', 'desk.keyEdit'], ['T', 'desk.keyTomorrow'], ['M', 'cmd.keyDay'], ['P', 'cmd.keyPin'], ['Del', 'cmd.keyDelete'], ['Esc', 'cmd.keyEsc'],
];

/** Every keyboard shortcut on a computer, opened with ? */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet label={t('cmd.keys')} onClose={onClose}>
      <div className="row spread"><h2>{t('cmd.keys')}</h2><button type="button" className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      <dl className="keylist">
        {KEYS.map(([k, label]) => <div key={k}><dt>{k.split(' ').map((x) => <kbd key={x}>{x}</kbd>)}</dt><dd>{t(label as 'cmd.keyView')}</dd></div>)}
      </dl>
      <p className="muted">{t('cmd.keysHint')}</p>
    </Sheet>
  );
}
