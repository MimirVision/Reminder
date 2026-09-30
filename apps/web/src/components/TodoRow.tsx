import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { Icon } from './icons';
import { SwipeRow } from './SwipeRow';
import { useI18n } from '../i18n';
import type { Memory } from '../lib/types';

export type Who = { id: string; name: string | null } | null;

// One to-do: tick to finish, tap the text to edit, swipe right to finish or left to delete. Due date, repeat and place show
// as small chips; who added it shows as a small avatar once the household has more than one person.
export function TodoRow({ m, photos, done, due, dueLate, place, author, doneBy, byline, onToggle, onEdit, onDelete, children }: {
  m: Memory; photos?: string[]; done?: boolean; due?: string; dueLate?: boolean; place?: string; author?: Who; doneBy?: string | null; byline?: string;
  onToggle: () => void; onEdit: () => void; onDelete?: () => void; children?: ReactNode;
}) {
  const { t } = useI18n();
  const title = m.body || t('todo.photo');
  const row = (
    <div className={`todo${done ? ' done' : ''}${m.pending ? ' pending' : ''}`}>
      <button type="button" className={`check${done ? ' on' : ''}`} aria-label={done ? t('todo.uncheck') : t('todo.check')} onClick={onToggle}>
        {done && <Icon name="check" size={14} />}
      </button>
      <div className="text">
        <button type="button" className="body" aria-label={t('todo.edit', { title: title.split('\n')[0] })} onClick={onEdit}>{title}</button>
        {(due || place || byline || m.repeat_rule || m.pending || doneBy) && (
          <div className="meta">
            {due && <span className={`chip${dueLate ? ' warm' : ''}`}><Icon name="calendar" size={12} />{due}</span>}
            {m.repeat_rule && <span className="chip plain"><Icon name="repeat" size={12} />{t(`repeat.short.${m.repeat_rule}` as 'repeat.short.daily')}</span>}
            {place && <span className="chip plain"><Icon name="pin" size={12} />{place}</span>}
            {m.pending && <span className="chip plain">{t('row.pending')}</span>}
            {doneBy && <span className="muted">{t('row.doneBy', { name: doneBy })}</span>}
            {byline && <span className="muted">{byline}</span>}
          </div>
        )}
        {photos && photos.length > 0 && (
          <div className="photos">{photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" loading="lazy" /></a>)}</div>
        )}
        {children}
      </div>
      {author && <Avatar id={author.id} name={author.name} />}
    </div>
  );
  return onDelete && !done ? <SwipeRow onDone={onToggle} onDelete={onDelete}>{row}</SwipeRow> : row;
}
