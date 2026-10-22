import { Icon } from './icons';
import { useI18n } from '../i18n';

export type Tab = 'todo' | 'house' | 'places' | 'settings';
const TABS: Tab[] = ['todo', 'house', 'places', 'settings'];

// Floating glass tab bar.
export function Nav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { t } = useI18n();
  return (
    <div className="dock nav-dock">
      <div className="nav-brand" aria-hidden="true">Home Memory</div>
      <nav className="nav glass" aria-label={t('nav.main')}>
        {TABS.map((id) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => onChange(id)}>
            <Icon name={id} />
            {t(`nav.${id}` as const)}
          </button>
        ))}
      </nav>
      <dl className="nav-keys" aria-label={t('desk.keys')}>
        <dt>N</dt><dd>{t('desk.keyNew')}</dd>
        <dt>/</dt><dd>{t('desk.keySearch')}</dd>
        <dt>J K</dt><dd>{t('desk.keyMove')}</dd>
        <dt>X</dt><dd>{t('desk.keyDone')}</dd>
        <dt>E</dt><dd>{t('desk.keyEdit')}</dd>
        <dt>T</dt><dd>{t('desk.keyTomorrow')}</dd>
        <dt>Ctrl K</dt><dd>{t('desk.keyPalette')}</dd>
        <dt>1–4</dt><dd>{t('desk.keyTabs')}</dd>
      </dl>
    </div>
  );
}
