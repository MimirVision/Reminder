import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { searchPlaces, type Hit } from '../lib/placeSearch';
import { getLastKnown } from '../lib/useHere';
import { Icon } from './icons';

/** A search box for an address or a place name; picking a result gives its name, address and coordinates. */
export function AddressPicker({ onPick }: { onPick: (h: Pick<Hit, 'name' | 'address' | 'lat' | 'lon'>) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const text = q.trim();
    setFailed(false);
    if (text.length < 3) { setHits([]); setBusy(false); return; }
    setBusy(true);
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      searchPlaces(text, { near: getLastKnown(), signal: ctl.signal, limit: 6 })
        .then((r) => { setHits(r); setBusy(false); })
        .catch((e) => { if ((e as Error).name === 'AbortError') return; setHits([]); setFailed(true); setBusy(false); });
    }, 300);
    return () => { window.clearTimeout(id); ctl.abort(); };
  }, [q]);

  return (
    <div className="field">
      <label className="searchfield"><Icon name="search" size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('weather.searchAddress')} aria-label={t('weather.searchAddress')} autoComplete="street-address" />
      </label>
      {busy && <span className="muted" role="status">{t('weather.searching')}</span>}
      {failed && <span className="error" role="alert">{t('weather.searchFail')}</span>}
      {!busy && !failed && q.trim().length >= 3 && hits.length === 0 && <span className="muted">{t('weather.noHits')}</span>}
      {hits.length > 0 && (
        <ul className="results">
          {hits.map((h) => (
            <li key={h.key}><button type="button" className="result" onClick={() => onPick(h)}>
              <span className="ico"><Icon name="pin" size={18} /></span>
              <span className="rt"><strong>{h.name || h.address}</strong>{h.name && h.address && <span className="muted">{h.address}</span>}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
