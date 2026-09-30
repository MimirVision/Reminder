import type { ReactNode } from 'react';
import { Icon } from './icons';
import { useI18n } from '../i18n';
import type { Memory } from '../lib/types';

// One to-do: tick to finish, tap the text to edit. Due date and place show as small chips; nothing else competes.
export function TodoRow({ m, photos, done, due, dueLate, place, byline, onToggle, onEdit, children }: {
  m: Memory; photos?: string[]; done?: boolean; due?: string; dueLate?: boolean; place?: string; byline?: string;
  onToggle: () => void; onEdit: () => void; children?: ReactNode;
}) {
  const { t } = useI18n();
  const title = m.body || t('todo.photo');
  return (
    <div className={`todo${done ? ' done' : ''}`}>
      <button type="button" className={`check${done ? ' on' : ''}`} aria-label={done ? t('todo.uncheck') : t('todo.check')} onClick={onToggle}>
        {done && <Icon name="check" size={14} />}
      </button>
      <div className="text">
        <button type="button" className="body" aria-label={t('todo.edit', { title: title.split('\n')[0] })} onClick={onEdit}>{title}</button>
        {(due || place || byline) && (
          <div className="meta">
            {due && <span className={`chip${dueLate ? ' warm' : ''}`}><Icon name="calendar" size={12} />{due}</span>}
            {place && <span className="chip plain"><Icon name="pin" size={12} />{place}</span>}
            {byline && <span className="muted">{byline}</span>}
          </div>
        )}
        {photos && photos.length > 0 && (
          <div className="photos">{photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" loading="lazy" /></a>)}</div>
        )}
        {children}
      </div>
    </div>
  );
}
