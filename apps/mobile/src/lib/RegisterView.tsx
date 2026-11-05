import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addHouseCost, deleteAppliance, deleteContact, deleteHouseCost, listAppliances, listContacts, listCostEvents, listHouseCosts, listTasks, saveAppliance, saveContact } from './api';
import { Chip } from './Chip';
import { DateField } from './DateField';
import { useI18n } from './i18n';
import { Select } from './Select';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted } from './ui';
import { nok } from '../shared/lib/condition';
import {
  APPLIANCE_CATEGORIES, TRADES, applianceLine, buildCosts, costTotals, costYears, mailHref, parseAmount, safeUrl, sortAppliances, telHref, warrantiesEnding, warrantyState,
  type Appliance, type Contact, type CostEntry, type CostEvent, type HouseCost,
} from '../shared/lib/register';
import { todayISO } from '../shared/lib/when';
import type { MaintenanceTask } from './types';

const open = (url: string | null) => { if (url) void Linking.openURL(url).catch(() => {}); };

function useSheetPad() { const i = useSafeAreaInsets(); return { padding: 16, gap: 8, paddingBottom: i.bottom + 24 }; }

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const th = useTheme();
  const { t } = useI18n();
  const pad = useSheetPad();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={pad}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text accessibilityRole="header" style={{ flex: 1, color: th.ink, fontFamily: font.display, fontSize: 26 }}>{title}</Text>
            <Btn small label={t('common.close')} onPress={onClose} />
          </View>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Lbl({ children }: { children: string }) {
  const th = useTheme();
  return <Text style={{ color: th.muted, fontFamily: font.semi, fontSize: 14, marginTop: 6 }}>{children}</Text>;
}

export function Pill({ text, tone }: { text: string; tone?: 'soon' | 'expired' }) {
  const th = useTheme();
  const bg = tone === 'soon' ? (th.dark ? '#3A2B12' : '#FFF1D6') : tone === 'expired' ? (th.dark ? '#3A1A15' : '#FBEAE4') : th.dark ? '#262C36' : '#ECEEF2';
  const fg = tone === 'soon' ? (th.dark ? '#F0B35A' : '#8F5200') : tone === 'expired' ? (th.dark ? '#FF8A78' : '#C62D1A') : th.muted;
  return <View style={{ alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: bg }}><Text style={{ color: fg, fontFamily: font.semi, fontSize: 13 }}>{text}</Text></View>;
}

export function WarrantyPill({ a }: { a: Pick<Appliance, 'warranty_until'> }) {
  const { t, tn } = useI18n();
  const w = warrantyState(a, todayISO());
  const text = w.kind === 'none' ? t('warr.none') : w.kind === 'expired' ? t('warr.expired', { date: a.warranty_until as string }) : w.kind === 'active' ? t('warr.active', { date: a.warranty_until as string }) : w.days === 0 ? t('warr.today') : tn('warr.endsIn', w.days);
  return <Pill text={text} tone={w.kind === 'soon' ? 'soon' : w.kind === 'expired' ? 'expired' : undefined} />;
}

/** A cost sheet used from the Costs tab and from a finding of the condition report. */
export type CostPrefill = { title?: string; item_id?: string | null; contact_id?: string | null };
export function CostModal({ householdId, prefill, contacts, appliances, onClose, onSaved }: { householdId: string; prefill?: CostPrefill; contacts: Contact[]; appliances: Appliance[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(todayISO());
  const [contact, setContact] = useState<string | null>(prefill?.contact_id ?? null);
  const [appliance, setAppliance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = parseAmount(amount);
    if (!title.trim()) return Alert.alert(t('cost.titleErr'));
    if (n == null) return Alert.alert(t('cost.amountErr'));
    setBusy(true);
    try {
      await addHouseCost(householdId, { title: title.trim(), amount_nok: n, spent_on: date ?? todayISO(), contact_id: contact, appliance_id: appliance, ...(prefill?.item_id ? { item_id: prefill.item_id } : {}) });
      await onSaved(); onClose();
    } catch (e) { Alert.alert(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Sheet title={t('cost.new')} onClose={onClose}>
      <Lbl>{t('cost.what')}</Lbl><Field value={title} maxLength={120} onChangeText={setTitle} accessibilityLabel={t('cost.what')} />
      <Lbl>{t('cost.amount')}</Lbl><Field value={amount} keyboardType="decimal-pad" onChangeText={setAmount} accessibilityLabel={t('cost.amount')} />
      <DateField label={t('cost.date')} value={date} onChange={setDate} />
      {contacts.length > 0 && <Select<string | null> label={t('trade.pick')} value={contact} options={[{ value: null, label: t('trade.none') }, ...contacts.map((c) => ({ value: c.id as string | null, label: c.name }))]} onChange={setContact} />}
      {appliances.length > 0 && <Select<string | null> label={t('reg.tab.appliances')} value={appliance} options={[{ value: null, label: t('trade.none') }, ...appliances.map((a) => ({ value: a.id as string | null, label: a.name }))]} onChange={setAppliance} />}
      <Btn primary disabled={busy} label={t('common.save')} onPress={() => void save()} />
    </Sheet>
  );
}

type ADraft = Omit<Appliance, 'household_id' | 'created_at' | 'id'> & { id?: string };
const blankA = (): ADraft => ({ name: '', category: 'other', brand: null, model: null, serial: null, room: null, purchased_on: null, price_nok: null, store: null, warranty_until: null, manual_url: null, contact_id: null, notes: null });

function ApplianceModal({ draft, contacts, onClose, onSave, onDelete }: { draft: ADraft; contacts: Contact[]; onClose: () => void; onSave: (d: ADraft) => Promise<void>; onDelete?: () => void }) {
  const { t, tn } = useI18n();
  const [d, setD] = useState<ADraft>(draft);
  const [price, setPrice] = useState(draft.price_nok != null ? String(draft.price_nok).replace('.', ',') : '');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ADraft>(k: K, v: ADraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const txt = (k: 'brand' | 'model' | 'serial' | 'room' | 'store', label: string) => <><Lbl>{label}</Lbl><Field value={d[k] ?? ''} onChangeText={(v) => set(k, v || null)} accessibilityLabel={label} /></>;
  async function save() {
    if (!d.name.trim()) return Alert.alert(t('appl.nameErr'));
    const p = price.trim() ? parseAmount(price) : null;
    if (price.trim() && p == null) return Alert.alert(t('appl.priceErr'));
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), price_nok: p, manual_url: d.manual_url?.trim() || null }); } catch (e) { Alert.alert(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  const addYears = (n: number) => { const base = d.purchased_on ?? todayISO(); set('warranty_until', `${+base.slice(0, 4) + n}${base.slice(4)}`); };
  return (
    <Sheet title={d.id ? t('appl.edit') : t('appl.new')} onClose={onClose}>
      <Lbl>{t('appl.name')}</Lbl><Field value={d.name} maxLength={80} onChangeText={(v) => set('name', v)} accessibilityLabel={t('appl.name')} />
      <Select<string> label={t('appl.category')} value={d.category} options={APPLIANCE_CATEGORIES.map((c) => ({ value: c as string, label: t(`appl.cat.${c}` as 'appl.cat.other') }))} onChange={(v) => set('category', v)} />
      {txt('brand', t('appl.brand'))}{txt('model', t('appl.model'))}{txt('serial', t('appl.serial'))}{txt('room', t('appl.room'))}
      <DateField label={t('appl.purchased')} value={d.purchased_on} onChange={(v) => set('purchased_on', v)} />
      <Lbl>{t('appl.price')}</Lbl><Field value={price} keyboardType="decimal-pad" onChangeText={setPrice} accessibilityLabel={t('appl.price')} />
      {txt('store', t('appl.store'))}
      <DateField label={t('appl.warranty')} value={d.warranty_until} onChange={(v) => set('warranty_until', v)} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{[2, 3, 5].map((n) => <Chip key={n} label={tn('appl.years', n)} onPress={() => addYears(n)} />)}</View>
      <Lbl>{t('appl.manual')}</Lbl><Field value={d.manual_url ?? ''} autoCapitalize="none" keyboardType="url" onChangeText={(v) => set('manual_url', v || null)} accessibilityLabel={t('appl.manual')} />
      <Muted>{t('appl.manualHelp')}</Muted>
      {contacts.length > 0 && <Select<string | null> label={t('appl.service')} value={d.contact_id} options={[{ value: null, label: t('trade.none') }, ...contacts.map((c) => ({ value: c.id as string | null, label: c.name }))]} onChange={(v) => set('contact_id', v)} />}
      <Lbl>{t('appl.notes')}</Lbl><Field multiline value={d.notes ?? ''} onChangeText={(v) => set('notes', v || null)} accessibilityLabel={t('appl.notes')} />
      <Btn primary disabled={busy} label={t('common.save')} onPress={() => void save()} />
      {onDelete ? <Btn danger label={t('appl.delete')} onPress={onDelete} /> : null}
    </Sheet>
  );
}

type CDraft = Omit<Contact, 'household_id' | 'id'> & { id?: string };
const blankC = (): CDraft => ({ name: '', trade: 'plumber', company: null, phone: null, email: null, notes: null });

function ContactModal({ draft, onClose, onSave, onDelete }: { draft: CDraft; onClose: () => void; onSave: (d: CDraft) => Promise<void>; onDelete?: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<CDraft>(draft);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CDraft>(k: K, v: CDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  async function save() {
    if (!d.name.trim()) return Alert.alert(t('trade.nameErr'));
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim() }); } catch (e) { Alert.alert(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Sheet title={d.id ? t('trade.edit') : t('trade.new')} onClose={onClose}>
      <Lbl>{t('trade.name')}</Lbl><Field value={d.name} maxLength={80} onChangeText={(v) => set('name', v)} accessibilityLabel={t('trade.name')} />
      <Select<string> label={t('trade.trade')} value={d.trade} options={TRADES.map((x) => ({ value: x as string, label: t(`trade.t.${x}` as 'trade.t.other') }))} onChange={(v) => set('trade', v)} />
      <Lbl>{t('trade.company')}</Lbl><Field value={d.company ?? ''} onChangeText={(v) => set('company', v || null)} accessibilityLabel={t('trade.company')} />
      <Lbl>{t('trade.phone')}</Lbl><Field value={d.phone ?? ''} keyboardType="phone-pad" onChangeText={(v) => set('phone', v || null)} accessibilityLabel={t('trade.phone')} />
      <Lbl>{t('trade.email')}</Lbl><Field value={d.email ?? ''} autoCapitalize="none" keyboardType="email-address" onChangeText={(v) => set('email', v || null)} accessibilityLabel={t('trade.email')} />
      <Lbl>{t('trade.notes')}</Lbl><Field multiline value={d.notes ?? ''} onChangeText={(v) => set('notes', v || null)} accessibilityLabel={t('trade.notes')} />
      <Btn primary disabled={busy} label={t('common.save')} onPress={() => void save()} />
      {onDelete ? <Btn danger label={t('trade.delete')} onPress={onDelete} /> : null}
    </Sheet>
  );
}

// House > Register: appliances with their warranty, the tradespeople, and what has been spent.
export function RegisterView({ householdId }: { householdId: string }) {
  const th = useTheme();
  const { t, tn, locale } = useI18n();
  const [tab, setTab] = useState<'appliances' | 'trades' | 'costs'>('appliances');
  const [appliances, setAppliances] = useState<Appliance[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [costs, setCosts] = useState<HouseCost[]>([]);
  const [events, setEvents] = useState<CostEvent[]>([]);
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [aDraft, setADraft] = useState<ADraft | null>(null);
  const [cDraft, setCDraft] = useState<CDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  const load = useCallback(async () => {
    try {
      const [a, c, k, e, tk] = await Promise.all([listAppliances(householdId), listContacts(householdId), listHouseCosts(householdId), listCostEvents(householdId), listTasks(householdId).catch(() => [])]);
      setAppliances(a); setContacts(c); setCosts(k); setEvents(e); setTasks(tk); setErr(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/appliances|contacts|house_costs|schema cache|does not exist/i.test(m) ? t('reg.noTable') : m);
      setAppliances([]);
    }
  }, [householdId, t]);
  useEffect(() => { void load(); }, [load]);

  const today = todayISO();
  const sorted = useMemo(() => sortAppliances(appliances ?? [], today), [appliances, today]);
  const ending = warrantiesEnding(appliances ?? [], today, 60).length;
  const taskTitles = useMemo(() => new Map(tasks.map((x) => [x.id, x.title])), [tasks]);
  const years = useMemo(() => costYears([...costs.map((c) => c.spent_on), ...events.map((e) => e.done_at), ...(appliances ?? []).flatMap((a) => (a.purchased_on ? [a.purchased_on] : []))], thisYear), [costs, events, appliances, thisYear]);
  const entries = useMemo(() => buildCosts({ year, events, taskTitles, extras: costs, appliances: appliances ?? [] }), [year, events, taskTitles, costs, appliances]);
  const totals = useMemo(() => costTotals(entries), [entries]);
  const linked = useMemo(() => { const m = new Map<string, number>(); for (const x of [...(appliances ?? []), ...tasks]) if (x.contact_id) m.set(x.contact_id, (m.get(x.contact_id) ?? 0) + 1); return m; }, [appliances, tasks]);
  const who = (e: CostEntry) => contacts.find((c) => c.id === e.contactId)?.name;

  if (appliances === null) return <Muted>{t('common.loading')}</Muted>;
  const max = Math.max(1, ...totals.byMonth);

  const removeCost = (e: CostEntry) => Alert.alert(t('cost.deleteAsk'), undefined, [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('cost.delete'), style: 'destructive', onPress: async () => { try { await deleteHouseCost(e.id.slice(2)); await load(); } catch (x) { Alert.alert(x instanceof Error ? x.message : String(x)); } } },
  ]);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['appliances', 'trades', 'costs'] as const).map((x) => <Chip key={x} label={t(`reg.tab.${x}` as 'reg.tab.costs')} on={tab === x} onPress={() => setTab(x)} />)}
      </View>
      {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}

      {!err && tab === 'appliances' && (
        <>
          <Muted>{tn('appl.count', (appliances ?? []).length)}{ending > 0 ? ` · ${tn('warr.ending', ending)}` : ''}</Muted>
          <Btn primary label={t('appl.add')} onPress={() => setADraft(blankA())} />
          {(appliances ?? []).length === 0 ? <Muted>{t('appl.empty')}</Muted> : null}
          {sorted.map((a) => {
            const c = contacts.find((x) => x.id === a.contact_id);
            const url = safeUrl(a.manual_url);
            const tel = telHref(c?.phone);
            return (
              <Card key={a.id} gap={6}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, color: th.ink, fontSize: 17, fontFamily: font.semi }}>{a.name}</Text>
                  <Pill text={t(`appl.cat.${a.category}` as 'appl.cat.other')} />
                </View>
                {applianceLine(a) ? <Muted>{applianceLine(a)}</Muted> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <WarrantyPill a={a} />
                  {a.purchased_on ? <Pill text={`${t('appl.purchased')}: ${a.purchased_on}`} /> : null}
                  {a.price_nok != null ? <Pill text={`${nok(a.price_nok)} kr`} /> : null}
                </View>
                {a.notes ? <Muted>{a.notes}</Muted> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Btn small label={t('appl.edit')} onPress={() => setADraft({ ...a })} />
                  {url ? <Btn small label={t('appl.open')} onPress={() => open(url)} /> : null}
                  {c && tel ? <Btn small label={`${t('trade.call')} ${c.name}`} onPress={() => open(tel)} /> : null}
                </View>
              </Card>
            );
          })}
        </>
      )}

      {!err && tab === 'trades' && (
        <>
          <Btn primary label={t('trade.add')} onPress={() => setCDraft(blankC())} />
          {contacts.length === 0 ? <Muted>{t('trade.empty')}</Muted> : null}
          {contacts.map((c) => {
            const tel = telHref(c.phone), mail = mailHref(c.email), n = linked.get(c.id) ?? 0;
            return (
              <Card key={c.id} gap={6}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, color: th.ink, fontSize: 17, fontFamily: font.semi }}>{c.name}</Text>
                  <Pill text={t(`trade.t.${c.trade}` as 'trade.t.other')} />
                </View>
                {c.company ? <Muted>{c.company}</Muted> : null}
                {c.phone ? <Text style={{ color: th.ink, fontFamily: font.body, fontSize: 15 }}>{c.phone}</Text> : null}
                {n > 0 ? <Muted>{tn('trade.linked', n)}</Muted> : null}
                {c.notes ? <Muted>{c.notes}</Muted> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {tel ? <Btn small primary label={t('trade.call')} onPress={() => open(tel)} /> : null}
                  {mail ? <Btn small label={t('trade.mail')} onPress={() => open(mail)} /> : null}
                  <Btn small label={t('trade.edit')} onPress={() => setCDraft({ ...c })} />
                </View>
              </Card>
            );
          })}
        </>
      )}

      {!err && tab === 'costs' && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{years.map((y) => <Chip key={y} label={String(y)} on={y === year} onPress={() => setYear(y)} />)}</View>
          <Btn primary label={t('cost.add')} onPress={() => setAdding(true)} />
          <Card gap={6}>
            <Muted>{t('cost.total', { year })}</Muted>
            <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 32, fontFamily: font.display }}>{nok(Math.round(totals.total))} kr</Text>
            <Muted>{`${t('cost.jobs')} ${nok(Math.round(totals.bySource.job))} · ${t('cost.logged')} ${nok(Math.round(totals.bySource.extra))} · ${t('cost.bought')} ${nok(Math.round(totals.bySource.purchase))}`}</Muted>
            <View style={{ flexDirection: 'row', gap: 4, height: 56, alignItems: 'flex-end' }} accessible accessibilityLabel={totals.byMonth.map((v, i) => `${new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' })}: ${nok(Math.round(v))} kr`).join(', ')}>
              {totals.byMonth.map((v, i) => (
                <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', borderRadius: 6, backgroundColor: th.dark ? '#262C36' : '#ECEEF2', overflow: 'hidden' }}>
                  <View style={{ height: `${Math.max(4, Math.round((v / max) * 100))}%`, backgroundColor: th.accent, borderTopLeftRadius: 6, borderTopRightRadius: 6, opacity: v > 0 ? 1 : 0.25 }} />
                </View>
              ))}
            </View>
          </Card>
          {entries.length === 0 ? <Muted>{t('cost.empty', { year })}</Muted> : null}
          {entries.map((e) => (
            <Pressable key={e.id} accessibilityRole={e.source === 'extra' ? 'button' : undefined} accessibilityHint={e.source === 'extra' ? t('cost.delete') : undefined} onLongPress={e.source === 'extra' ? () => removeCost(e) : undefined}>
              <Card gap={2}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, color: th.ink, fontSize: 16, fontFamily: font.semi }}>{e.title}</Text>
                  <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{nok(Math.round(e.amount))} kr</Text>
                </View>
                <Muted>{`${e.date} · ${t(`cost.src.${e.source}` as 'cost.src.job')}${who(e) ? ` · ${who(e)}` : ''}`}</Muted>
                {e.source === 'extra' ? <Pressable accessibilityRole="button" onPress={() => removeCost(e)} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ color: th.danger, fontFamily: font.semi, fontSize: 14 }}>{t('cost.delete')}</Text></Pressable> : null}
              </Card>
            </Pressable>
          ))}
        </>
      )}

      {aDraft ? <ApplianceModal draft={aDraft} contacts={contacts} onClose={() => setADraft(null)}
        onSave={async (d) => { await saveAppliance(householdId, d); setADraft(null); await load(); }}
        onDelete={aDraft.id ? () => Alert.alert(t('appl.deleteAsk'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('appl.delete'), style: 'destructive', onPress: async () => { try { await deleteAppliance(aDraft.id as string); setADraft(null); await load(); } catch (e) { Alert.alert(e instanceof Error ? e.message : String(e)); } } }]) : undefined} /> : null}
      {cDraft ? <ContactModal draft={cDraft} onClose={() => setCDraft(null)}
        onSave={async (d) => { await saveContact(householdId, d); setCDraft(null); await load(); }}
        onDelete={cDraft.id ? () => Alert.alert(t('trade.deleteAsk'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('trade.delete'), style: 'destructive', onPress: async () => { try { await deleteContact(cDraft.id as string); setCDraft(null); await load(); } catch (e) { Alert.alert(e instanceof Error ? e.message : String(e)); } } }]) : undefined} /> : null}
      {adding ? <CostModal householdId={householdId} contacts={contacts} appliances={appliances ?? []} onClose={() => setAdding(false)} onSaved={load} /> : null}
    </View>
  );
}
