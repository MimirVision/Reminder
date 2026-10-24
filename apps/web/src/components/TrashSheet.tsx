import { useEffect, useState } from 'react';
import { listMemories, restoreMemory } from '../lib/api';
import { daysSince, newestFirst } from '../lib/trash';
import type { Household, Memory } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';

// Recently deleted: to-dos deleted in the last 30 days, each with a Restore button.
export function TrashSheet({ household, onClose, onRestored }: { household: Household; onClose: () => void; onRestored: () => void }) {
  const { t, tn } = useI18n();
  const [items, setItems] = useState<Memory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { listMemories(household.id, ['dismissed']).then((l) => setItems(newestFirst(l))).catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setItems([]); }); }, [household.id]);

  const restore = async (m: Memory) => {
    setItems((cur) => (cur ?? []).filter((x) => x.id !== m.id));
    try { await restoreMemory(m.id, m); onRestored(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Sheet label={t('trash.title')} onClose={onClose}>
      <div className="row spread">
        <h2>{t('trash.title')}</h2>
        <button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button>
      </div>
      <span className="muted">{t('trash.keep')}</span>
      {err && <p className="error" role="alert">{err}</p>}
      {items === null && <span className="muted">{t('common.loading')}</span>}
      {items?.length === 0 && !err && <p className="muted">{t('trash.empty')}</p>}
      <ul className="trash-list">
        {(items ?? []).map((m) => {
          const d = daysSince(m.updated_at);
          return (
            <li key={m.id}>
              <span><strong>{(m.body || t('todo.photo')).split('\n')[0]}</strong><br /><span className="muted">{d === 0 ? t('trash.today') : tn('trash.ago', d)}</span></span>
              <button className="btn small" onClick={() => void restore(m)}>{t('trash.restore')}</button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
