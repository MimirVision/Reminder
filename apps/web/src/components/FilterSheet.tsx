import { activeCount, noFilter, type Filter } from '../lib/todoFilter';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';

// One place for every way to narrow the list: whose, how important, which tag. Changes apply at once.
export function FilterSheet({ value, onChange, partnerName, tags, onClose }: {
  value: Filter; onChange: (f: Filter) => void; partnerName: string | null; tags: { tag: string; count: number }[]; onClose: () => void;
}) {
  const { t } = useI18n();
  const set = (p: Partial<Filter>) => onChange({ ...value, ...p });
  return (
    <Sheet label={t('filter.title')} onClose={onClose}>
      <div className="row spread">
        <h2>{t('filter.title')}</h2>
        <button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button>
      </div>
      {partnerName != null && (
        <>
          <div className="label">{t('filter.who')}</div>
          <div className="chips" role="group" aria-label={t('filter.who')}>
            {([['all', t('filter.all')], ['mine', t('filter.mine')], ['theirs', t('filter.theirs', { name: partnerName })]] as const).map(([id, label]) => (
              <button key={id} type="button" className={`chipbtn${value.who === id ? ' on' : ''}`} aria-pressed={value.who === id} onClick={() => set({ who: id })}>{label}</button>
            ))}
          </div>
        </>
      )}
      <div className="label">{t('filter.priority')}</div>
      <div className="chips" role="group" aria-label={t('filter.priority')}>
        {([0, 1, 2, 3] as const).map((p) => (
          <button key={p} type="button" className={`chipbtn${value.minPriority === p ? ' on' : ''}`} aria-pressed={value.minPriority === p} onClick={() => set({ minPriority: p })}>
            {p === 0 ? t('filter.priorityAny') : t('filter.priorityMin', { p: t(`prio.${p}` as 'prio.1') })}
          </button>
        ))}
      </div>
      {tags.length > 0 && (
        <>
          <div className="label">{t('filter.tag')}</div>
          <div className="chips" role="group" aria-label={t('filter.tag')}>
            <button type="button" className={`chipbtn${value.tag == null ? ' on' : ''}`} aria-pressed={value.tag == null} onClick={() => set({ tag: null })}>{t('filter.tagAny')}</button>
            {tags.map((g) => <button key={g.tag} type="button" className={`chipbtn${value.tag === g.tag ? ' on' : ''}`} aria-pressed={value.tag === g.tag} onClick={() => set({ tag: g.tag })}>#{g.tag}</button>)}
          </div>
        </>
      )}
      <div className="row spread filter-foot">
        <button className="link" disabled={activeCount(value) === 0} onClick={() => onChange(noFilter())}>{t('filter.clear')}</button>
        <button className="btn primary" onClick={onClose}>{t('filter.done')}</button>
      </div>
    </Sheet>
  );
}
