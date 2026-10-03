import { useState } from 'react';
import { addMany, removeItem, toggleItem } from '../lib/checklist';
import { addTags, removeTag } from '../lib/tags';
import { type Details } from '../lib/details';
import type { Priority } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';

// Notes, a checklist, priority and "remind me before": the part of the add and edit sheet that makes a to-do more than a line of text.
export function TodoDetails({ value, onChange }: { value: Details; onChange: (d: Details) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState('');
  const [tag, setTag] = useState('');
  const putTag = () => { if (tag.trim()) { onChange({ ...value, tags: addTags(value.tags, tag) }); setTag(''); } };
  const addStep = () => { if (step.trim()) { onChange({ ...value, checklist: addMany(value.checklist, step) }); setStep(''); } };

  return (
    <div className="details">
      <div className="label">{t('prio.label')}</div>
      <div className="chips" role="group" aria-label={t('prio.label')}>
        {([0, 1, 2, 3] as Priority[]).map((p) => (
          <button key={p} type="button" className={`chipbtn prio-${p}${value.priority === p ? ' on' : ''}`} aria-pressed={value.priority === p} onClick={() => onChange({ ...value, priority: p })}>
            {p > 0 && <Icon name="flag" size={14} />}{t(`prio.${p}` as 'prio.0')}
          </button>
        ))}
      </div>

      <div className="label">{t('check.label')}</div>
      {value.checklist.length > 0 && (
        <ul className="steps-edit">
          {value.checklist.map((i) => (
            <li key={i.id}>
              <button type="button" className={`check small${i.done ? ' on' : ''}`} aria-label={t('check.tick', { text: i.text })} aria-pressed={i.done} onClick={() => onChange({ ...value, checklist: toggleItem(value.checklist, i.id) })}>
                {i.done && <Icon name="check" size={11} />}
              </button>
              <span className={i.done ? 'done' : undefined}>{i.text}</span>
              <button type="button" className="mini" aria-label={t('check.remove', { text: i.text })} onClick={() => onChange({ ...value, checklist: removeItem(value.checklist, i.id) })}><Icon name="x" size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="row nowrap">
        <input className="growfield" placeholder={t('check.placeholder')} value={step} onChange={(e) => setStep(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }} />
        <button type="button" className="btn small" disabled={!step.trim()} onClick={addStep}>{t('check.add')}</button>
      </div>

      <div className="label">{t('tags.label')}</div>
      {value.tags.length > 0 && (
        <div className="chips">
          {value.tags.map((g) => (
            <span key={g} className="chip tagchip">#{g}<button type="button" className="mini" aria-label={t('tags.remove', { tag: g })} onClick={() => onChange({ ...value, tags: removeTag(value.tags, g) })}><Icon name="x" size={12} /></button></span>
          ))}
        </div>
      )}
      <div className="row nowrap">
        <input className="growfield" placeholder={t('tags.placeholder')} value={tag} onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); putTag(); } }} />
        <button type="button" className="btn small" disabled={!tag.trim()} onClick={putTag}>{t('tags.add')}</button>
      </div>

      <div className="label">{t('notes.label')}</div>
      <textarea rows={2} placeholder={t('notes.placeholder')} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
    </div>
  );
}
