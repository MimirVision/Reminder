import { Icon } from './icons';
import { useI18n } from '../i18n';

// The glass "Add a to-do…" bar above the tab bar.
export function AddBar({ onClick, inline }: { onClick: () => void; inline?: boolean }) {
  const { t } = useI18n();
  if (inline) {
    // On a computer the bar sits at the top of the list instead of floating over it.
    return (
      <button className="addbar glass inline" onClick={onClick} aria-label={t('todo.addAria')}>
        <span className="plus"><Icon name="plus" size={18} /></span>
        <span className="ph">{t('desk.addHint')}</span>
        <Icon name="camera" size={18} />
      </button>
    );
  }
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
