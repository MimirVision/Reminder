import { useCallback, useEffect, useMemo, useState } from 'react';
import { listAppliances, listContacts, listCostEvents, listHouseCosts, listTasks } from '../lib/api';
import type { Appliance, Contact, CostEvent, HouseCost } from '../lib/register';
import type { Household, MaintenanceTask } from '../lib/types';
import { useI18n } from '../i18n';
import { AppliancesView } from './AppliancesView';
import { CostsView } from './CostsView';
import { TradesView } from './TradesView';

type Tab = 'appliances' | 'trades' | 'costs';

// House > Register: appliances with their warranty, the tradespeople, and what has been spent. One load, shared by the three tabs.
export function Register({ household }: { household: Household }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('appliances');
  const [appliances, setAppliances] = useState<Appliance[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [costs, setCosts] = useState<HouseCost[]>([]);
  const [events, setEvents] = useState<CostEvent[]>([]);
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, c, k, e, tk] = await Promise.all([listAppliances(household.id), listContacts(household.id), listHouseCosts(household.id), listCostEvents(household.id), listTasks(household.id).catch(() => [])]);
      setAppliances(a); setContacts(c); setCosts(k); setEvents(e); setTasks(tk); setErr(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/appliances|contacts|house_costs|schema cache|does not exist/i.test(m) ? t('reg.noTable') : m);
      setAppliances([]);
    }
  }, [household.id, t]);
  useEffect(() => { void load(); }, [load]);

  const taskTitles = useMemo(() => new Map(tasks.map((x) => [x.id, x.title])), [tasks]);
  if (appliances === null) return <span className="muted">{t('common.loading')}</span>;

  return (
    <>
      <div className="chips reg-tabs" role="group">
        {(['appliances', 'trades', 'costs'] as Tab[]).map((x) => <button key={x} type="button" className={`chipbtn${tab === x ? ' on' : ''}`} aria-pressed={tab === x} onClick={() => setTab(x)}>{t(`reg.tab.${x}` as 'reg.tab.costs')}</button>)}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {!err && tab === 'appliances' && <AppliancesView household={household} appliances={appliances} contacts={contacts} onChanged={load} />}
      {!err && tab === 'trades' && <TradesView household={household} contacts={contacts} appliances={appliances} tasks={tasks} onChanged={load} />}
      {!err && tab === 'costs' && <CostsView household={household} costs={costs} events={events} appliances={appliances} contacts={contacts} taskTitles={taskTitles} onChanged={load} />}
    </>
  );
}
