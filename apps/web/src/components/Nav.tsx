import { Icon } from './icons';

export type Tab = 'todo' | 'house' | 'places' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'todo', label: 'To-do' }, { id: 'house', label: 'House' }, { id: 'places', label: 'Places' }, { id: 'settings', label: 'Settings' },
];

// Floating glass tab bar.
export function Nav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="dock nav-dock">
      <nav className="nav glass" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onChange(t.id)}>
            <Icon name={t.id} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
