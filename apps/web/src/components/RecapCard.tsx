import { useEffect, useMemo, useState } from 'react';
import { listDoneSince } from '../lib/api';
import { useI18n } from '../i18n';
import type { Household, Member } from '../lib/types';
import { Avatar } from './Avatar';

const hideKey = (hid: string) => `hm.recapHidden.${hid}`;
// Monday-based week id, so "Hide" lasts until next week.
const weekId = (d = new Date()) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

// "This week: 12 things done. Anna 7, Per 5." A small proof the app is working for you.
export function RecapCard({ household, members, refreshKey }: { household: Household; members: Member[]; refreshKey: number }) {
  const { t, tn } = useI18n();
  const [done, setDone] = useState<Awaited<ReturnType<typeof listDoneSince>>>([]);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(hideKey(household.id)) === weekId(); } catch { return false; } });

  useEffect(() => { listDoneSince(household.id).then(setDone).catch(() => {}); }, [household.id, refreshKey]);

  const perPerson = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of done) { const who = d.done_by ?? d.author_id; m.set(who, (m.get(who) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [done]);

  if (hidden || done.length < 3) return null; // stay quiet until there is something to be proud of
  return (
    <section className="card recap" aria-label={t('recap.title')}>
      <div className="row spread">
        <span><strong>{t('recap.title')}</strong> <span className="muted">{tn('recap.done', done.length)}</span></span>
        <button className="link quiet" onClick={() => { try { localStorage.setItem(hideKey(household.id), weekId()); } catch { /* ignore */ } setHidden(true); }}>{t('recap.hide')}</button>
      </div>
      {members.length > 1 && (
        <div className="row">
          {perPerson.map(([id, n]) => {
            const name = members.find((m) => m.user_id === id)?.display_name ?? '';
            return <span key={id} className="chip plain"><Avatar id={id} name={name} size={18} />{t('recap.by', { name: name || t('common.partner'), n })}</span>;
          })}
        </div>
      )}
    </section>
  );
}
