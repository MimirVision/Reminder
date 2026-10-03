import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { progress, toggleItem } from '../lib/checklist';
import type { ChecklistItem } from '../lib/types';
import { Icon } from './icons';
import { SwipeRow } from './SwipeRow';
import { useI18n } from '../i18n';
import type { Memory } from '../lib/types';

export type Who = { id: string; name: string | null } | null;

// One to-do: tick to finish, tap the text to edit, swipe right to finish or left to delete. Due date, repeat and place show
// as small chips; who added it shows as a small avatar once the household has more than one person.
export function TodoRow({ m, photos, done, due, dueLate, place, forName, author, doneBy, byline, onToggle, onEdit, onDelete, onReschedule, onChecklist, reorder, children }: {
  m: Memory; photos?: string[]; done?: boolean; due?: string; dueLate?: boolean; place?: string; forName?: string; author?: Who; doneBy?: string | null; byline?: string;
  onToggle: () => void; onEdit: () => void; onDelete?: () => void; onReschedule?: () => void; onChecklist?: (items: ChecklistItem[]) => void; reorder?: { up?: () => void; down?: () => void }; children?: ReactNode;
}) {
  const { t } = useI18n();
  const title = m.body || t('todo.photo');
  const steps = m.checklist ?? [];
  const prog = progress(steps);
  const prio = m.priority ?? 0;
  const row = (
    <div className={`todo${done ? ' done' : ''}${m.pending ? ' pending' : ''}${prio ? ` has-prio prio-${prio}` : ''}`}>
      <button type="button" className={`check${done ? ' on' : ''}${prio ? ` prio-${prio}` : ''}`} aria-label={done ? t('todo.uncheck') : t('todo.check')} onClick={onToggle}>
        {done && <Icon name="check" size={14} />}
      </button>
      <div className="text">
        <button type="button" className="body" aria-label={t('todo.edit', { title: title.split('\n')[0] })} onClick={onEdit}>{title}</button>
        {(due || place || byline || m.repeat_rule || m.pending || doneBy || forName || m.pinned || prio > 0 || prog.total > 0 || (m.tags?.length ?? 0) > 0) && (
          <div className="meta">
            {due && (onReschedule && !done
              ? <button type="button" className={`chip chipbtn-lite${dueLate ? ' warm' : ''}`} aria-label={t('resched.aria', { title: title.split('\n')[0] })} onClick={onReschedule}><Icon name="calendar" size={12} />{due}</button>
              : <span className={`chip${dueLate ? ' warm' : ''}`}><Icon name="calendar" size={12} />{due}</span>)}
            {prio > 0 && !done && <span className={`chip plain prio-chip prio-${prio}`}><Icon name="flag" size={12} />{t(`prio.short.${prio}` as 'prio.short.1')}</span>}
            {prog.total > 0 && <span className="chip plain"><Icon name="list" size={12} />{t('check.progress', { done: prog.done, total: prog.total })}</span>}
            {m.repeat_rule && <span className="chip plain"><Icon name="repeat" size={12} />{t(`repeat.short.${m.repeat_rule}` as 'repeat.short.daily')}</span>}
            {m.pinned && !done && <span className="chip plain">{t('row.pinned')}</span>}
            {forName && <span className="chip plain">{forName}</span>}
            {place && <span className="chip plain"><Icon name="pin" size={12} />{place}</span>}
            {!done && (m.tags ?? []).map((g) => <span key={g} className="chip plain tagchip">#{g}</span>)}
            {m.pending && <span className="chip plain">{t('row.pending')}</span>}
            {doneBy && <span className="muted">{t('row.doneBy', { name: doneBy })}</span>}
            {byline && <span className="muted">{byline}</span>}
          </div>
        )}
        {m.notes && !done && <p className="todo-notes"><Icon name="note" size={12} /> {m.notes.split('\n')[0]}</p>}
        {steps.length > 0 && !done && (
          <ul className="steps-inline">
            {steps.map((i) => (
              <li key={i.id} className={i.done ? 'done' : undefined}>
                <button type="button" className={`check small${i.done ? ' on' : ''}`} aria-label={t('check.tick', { text: i.text })} aria-pressed={i.done} disabled={!onChecklist || m.pending} onClick={() => onChecklist?.(toggleItem(steps, i.id))}>{i.done && <Icon name="check" size={11} />}</button>
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        )}
        {photos && photos.length > 0 && (
          <div className="photos">{photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" loading="lazy" /></a>)}</div>
        )}
        {children}
      </div>
      {reorder && (
        <div className="reorder">
          <button type="button" className="mini" disabled={!reorder.up} aria-label={t('reorder.up', { title: title.split('\n')[0] })} onClick={reorder.up}><Icon name="up" size={16} /></button>
          <button type="button" className="mini" disabled={!reorder.down} aria-label={t('reorder.down', { title: title.split('\n')[0] })} onClick={reorder.down}><Icon name="down" size={16} /></button>
        </div>
      )}
      {author && <Avatar id={author.id} name={author.name} />}
    </div>
  );
  return onDelete && !done && !reorder ? <SwipeRow onDone={onToggle} onDelete={onDelete}>{row}</SwipeRow> : row;
}
