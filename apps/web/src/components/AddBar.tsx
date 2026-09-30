import { Icon } from './icons';
import { useI18n } from '../i18n';

// The glass "Add a to-do…" bar above the tab bar.
export function AddBar({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="dock add-dock">
      <button className="addbar glass" onClick={onClick} aria-label={t('todo.addAria')}>
        <span className="plus"><Icon name="plus" size={20} /></span>
        <span className="ph">{t('todo.addBar')}</span>
        <Icon name="camera" />
      </button>
    </div>
  );
}
