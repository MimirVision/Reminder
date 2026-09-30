import { Icon } from './icons';
import { PlaceSearchBox, type Pick } from './PlaceSearchBox';
import { useI18n } from '../i18n';
import type { Where } from '../lib/api';
import { categoryName, placeLabel } from '../lib/labels';
import { categoryFromName, directionsUrl } from '../lib/placeSearch';
import type { Place } from '../lib/types';

export function whereFrom(placeId: string | null): Where {
  return placeId ? { kind: 'place', placeId } : { kind: 'none' };
}

// Where a to-do belongs: pick one of your places, or search a shop, a kind of shop or an address.
export function WhereField({ places, value, onChange }: { places: Place[]; value: Where; onChange: (w: Where) => void }) {
  const { t } = useI18n();

  const pick = (p: Pick) => {
    if (p.type === 'saved') onChange({ kind: 'place', placeId: p.place.id });
    else if (p.type === 'kind') onChange({ kind: 'category', category: p.category, name: categoryName(p.category, t) });
    else onChange({ kind: 'hit', hit: p.hit, kindOfShop: p.hit.category ?? categoryFromName(p.hit.name) });
  };

  if (value.kind !== 'none') {
    const place = value.kind === 'place' ? places.find((p) => p.id === value.placeId) : undefined;
    const label = value.kind === 'place' ? (place ? placeLabel(place, t) : '…') : value.kind === 'category' ? value.name : value.hit.name;
    const address = value.kind === 'place' ? place?.address : value.kind === 'hit' ? value.hit.address : null;
    const coords = value.kind === 'hit' ? value.hit : place?.lat != null && place.lon != null ? { lat: place.lat, lon: place.lon } : null;
    return (
      <div className="field">
        <div className="selected">
          <span className="ico"><Icon name={value.kind === 'category' || (place && place.kind === 'category') ? 'store' : 'pin'} size={18} /></span>
          <span className="rt"><strong>{label}</strong>{address && <span className="muted">{address}</span>}</span>
          {coords && <a className="mini" href={directionsUrl(coords)} target="_blank" rel="noreferrer" aria-label={t('where.directions')}><Icon name="navigate" size={15} /></a>}
          <button type="button" className="mini" aria-label={t('where.clear')} onClick={() => onChange({ kind: 'none' })}><Icon name="x" size={15} /></button>
        </div>
      </div>
    );
  }

  const idle = places.length > 0 && (
    <div className="chips" aria-label={t('where.saved')}>
      {places.slice(0, 8).map((p) => (
        <button key={p.id} type="button" className="chipbtn" onClick={() => onChange({ kind: 'place', placeId: p.id })}>
          <Icon name={p.kind === 'category' ? 'store' : 'pin'} size={14} />{placeLabel(p, t)}
        </button>
      ))}
    </div>
  );
  return <div className="field"><PlaceSearchBox places={places} showSaved idle={idle || undefined} onPick={pick} /></div>;
}
