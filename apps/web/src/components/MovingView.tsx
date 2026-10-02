import { useState } from 'react';
import { addMemory, listMemories, notifyPartnerIfSet } from '../lib/api';
import { buildMoveTodos, MOVE_GROUPS, MOVE_ITEMS } from '../lib/moving';
import { todayISO } from '../lib/when';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';

// Moving mode: tick what applies, pick moving day, and the checklist becomes ordinary to-dos with dates.
export function MovingView({ household }: { household: Household }) {
  const { t, tn, lang } = useI18n();
  const [day, setDay] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(MOVE_ITEMS.map((i) => i.key)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const flip = (key: string) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  async function add() {
    if (picked.size === 0) { setErr(t('move.empty')); return; }
    setBusy(true); setErr(null);
    try {
      const have = new Set((await listMemories(household.id, ['inbox', 'active']).catch(() => [])).map((m) => m.body.trim().toLowerCase()));
      const todos = buildMoveTodos([...picked], day || null, lang, todayISO());
      const fresh = todos.filter((x) => !have.has(x.body.trim().toLowerCase()));
      const ids: string[] = [];
      for (const x of fresh) ids.push((await addMemory({ household_id: household.id, body: x.body, due_on: x.due_on })).id);
      notifyPartnerIfSet(ids);
      setResult({ added: fresh.length, skipped: todos.length - fresh.length });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (result) {
    return (
      <div className="card" role="status">
        <h2>{t('move.title')}</h2>
        <p>{tn('move.added', result.added)}</p>
        {result.skipped > 0 && <p className="muted">{t('move.skipped', { n: result.skipped })}</p>}
        <button className="btn" onClick={() => setResult(null)}>{t('common.done')}</button>
      </div>
    );
  }

  return (
    <>
      <p className="muted">{t('move.intro')}</p>
      <div className="card">
        <label className="label nopad" htmlFor="moveday">{t('move.day')}</label>
        <input id="moveday" type="date" className="autowidth" value={day} min={todayISO()} onChange={(e) => setDay(e.target.value)} />
        {!day && <span className="muted hint">{t('move.noDay')}</span>}
      </div>
      <div className="row">
        <button className="link" onClick={() => setPicked(new Set(MOVE_ITEMS.map((i) => i.key)))}>{t('move.all')}</button>
        <button className="link" onClick={() => setPicked(new Set())}>{t('move.none')}</button>
      </div>
      {MOVE_GROUPS.map((g) => (
        <section key={g}>
          <div className="label">{t(`move.group.${g}` as 'move.group.before')}</div>
          <div className="card">
            {MOVE_ITEMS.filter((i) => i.group === g).map((i) => (
              <label key={i.key} className="row checkrow">
                <input type="checkbox" checked={picked.has(i.key)} onChange={() => flip(i.key)} />
                {lang === 'nb' ? i.nb : i.en}
              </label>
            ))}
          </div>
        </section>
      ))}
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary big" disabled={busy || picked.size === 0} onClick={() => void add()}><Icon name="plus" size={16} /> {busy ? t('sheet.saving') : tn('sheet.addN', picked.size)}</button>
    </>
  );
}
