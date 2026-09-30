import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useI18n } from '../i18n';
import { CATEGORIES, categoryName, placeLabel, shopName, type Category } from '../lib/labels';
import { categoryFromQuery, findExistingPlace, matchSaved, searchPlaces, type Hit } from '../lib/placeSearch';
import { getLastKnown } from '../lib/useHere';
import type { Place } from '../lib/types';

export type Pick =
  | { type: 'saved'; place: Place }
  | { type: 'kind'; category: Category }
  | { type: 'hit'; hit: Hit };

// One search box for shops ("kiwi myren"), kinds of shop ("apotek") and addresses. Used to pick where a to-do goes,
// and on the Places page to save a place.
export function PlaceSearchBox({ places, showSaved, autoFocus, idle, onPick }: { places: Place[]; showSaved: boolean; autoFocus?: boolean; idle?: React.ReactNode; onPick: (p: Pick) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    const text = q.trim();
    setFailed(false);
    if (text.length < 2) { setHits([]); setBusy(false); return; }
    setBusy(true);
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      searchPlaces(text, { near: getLastKnown(), signal: ctl.signal })
        .then((r) => { setHits(r); setBusy(false); })
        .catch((e) => { if ((e as Error).name === 'AbortError') return; setHits([]); setFailed(true); setBusy(false); });
    }, 250);
    return () => { window.clearTimeout(id); ctl.abort(); };
  }, [q]);

  const text = q.trim();
  const saved = showSaved ? matchSaved(places, text, (p) => placeLabel(p, t)) : [];
  const kind = text ? categoryFromQuery(text) : null;
  const kindSaved = kind ? places.find((p) => p.kind === 'category' && p.category === kind) : undefined;
  const hitRows = hits.map((hit) => ({ hit, existing: findExistingPlace(places, hit) }));
  const visibleHits = showSaved ? hitRows.filter((r) => !r.existing) : hitRows;
  const rows: { key: string; node: React.ReactNode; pick?: Pick }[] = [];

  for (const p of saved) {
    rows.push({ key: `s${p.id}`, pick: { type: 'saved', place: p }, node: (
      <>
        <span className="ico"><Icon name={p.kind === 'category' ? 'store' : 'pin'} size={18} /></span>
        <span className="rt"><strong>{placeLabel(p, t)}</strong>{p.address && <span className="muted">{p.address}</span>}</span>
        <span className="tag">{t('where.saved')}</span>
      </>
    ) });
  }
  if (kind && !(showSaved && kindSaved && saved.includes(kindSaved))) {
    rows.push({ key: `k${kind}`, pick: kindSaved && !showSaved ? undefined : { type: 'kind', category: kind }, node: (
      <>
        <span className="ico"><Icon name="store" size={18} /></span>
        <span className="rt"><strong>{categoryName(kind, t)}</strong><span className="muted">{t('places.kindCategory')}</span></span>
        <span className="tag">{kindSaved && !showSaved ? t('places.already') : t('where.kinds')}</span>
      </>
    ) });
  }
  for (const { hit, existing } of visibleHits) {
    rows.push({ key: `h${hit.key}`, pick: existing && !showSaved ? undefined : { type: 'hit', hit }, node: (
      <>
        <span className="ico"><Icon name={hit.isAddress ? 'pin' : 'store'} size={18} /></span>
        <span className="rt"><strong>{hit.name}</strong>{hit.address && <span className="muted">{hit.address}</span>}</span>
        <span className="tag">{existing && !showSaved ? t('places.already') : hit.isAddress ? t('where.address') : hit.category ? shopName(hit.category, t) : ''}</span>
      </>
    ) });
  }

  return (
    <div className="psb">
      <label className="searchfield">
        <Icon name="search" size={18} />
        <input ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          placeholder={t('where.placeholder')} aria-label={t('where.label')} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const first = rows.find((r) => r.pick); if (first?.pick) onPick(first.pick); } }} />
        {q && <button type="button" className="mini" aria-label={t('where.clearAria')} onClick={() => { setQ(''); input.current?.focus(); }}><Icon name="x" size={14} /></button>}
      </label>
      {text.length >= 2 && (
        <ul className="results" aria-label={t('where.results')}>
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" className="result" disabled={!r.pick} onClick={() => r.pick && onPick(r.pick)}>{r.node}</button>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="muted result-note" role="status">{busy ? t('where.searching') : failed ? t('where.offline') : t('where.none')}</li>
          )}
          {rows.length > 0 && busy && <li className="muted result-note" role="status">{t('where.searching')}</li>}
        </ul>
      )}
      {text.length < 2 && idle}
      {text.length < 2 && !showSaved && !idle && (
        <div className="chips" aria-label={t('places.addKinds')}>
          {CATEGORIES.filter((c) => !places.some((p) => p.category === c && p.kind === 'category')).map((c) => (
            <button key={c} type="button" className="chipbtn" onClick={() => onPick({ type: 'kind', category: c })}>+ {categoryName(c, t)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
