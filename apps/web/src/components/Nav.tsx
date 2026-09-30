import { Icon } from './icons';
import { useI18n } from '../i18n';

export type Tab = 'todo' | 'house' | 'places' | 'settings';
const TABS: Tab[] = ['todo', 'house', 'places', 'settings'];

// Floating glass tab bar.
export function Nav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { t } = useI18n();
  return (
    <div className="dock nav-dock">
      <nav className="nav glass" aria-label={t('nav.main')}>
        {TABS.map((id) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => onChange(id)}>
            <Icon name={id} />
            {t(`nav.${id}` as const)}
          </button>
        ))}
      </nav>
    </div>
  );
}
