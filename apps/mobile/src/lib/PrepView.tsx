import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, Share, Text, View } from 'react-native';
import { deletePrepStock, getPrepSettings, listPrepStock, listWeatherPlaces, savePrepSettings, savePrepStock } from './api';
import { Chip } from './Chip';
import { DateField } from './DateField';
import { useI18n } from './i18n';
import { addMissingTodos, addReplacementTodo, addReviewJob } from './prepTodos';
import { Lbl, Pill, Sheet } from './RegisterView';
import { Select } from './Select';
import { readJson, writeJson } from './store';
import { useToast } from './Toast';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted } from './ui';
import {
  EMERGENCY_NUMBERS, PREP_CATS, PREP_ITEMS, addMonths, byExpiry, cardText, catLabel, daysUntil, expiringSoon, expiryState, formatNumber, isoOf, itemName, itemStates, itemTip, itemUnit,
  missingItems, parseMonthDate, readiness, stormAhead, suggestedExpiry, type ItemState, type PrepItem, type PrepProfile, type PrepStock,
} from '../shared/lib/prep';
import { loadForecast } from '../shared/lib/weather';

type Tab = 'overview' | 'list' | 'stock' | 'plan';
type Draft = Omit<PrepStock, 'id' | 'household_id'> & { id?: string };
const cacheKey = (id: string) => `hm.prep.${id}`;

function Bar({ pct, h = 8 }: { pct: number; h?: number }) {
  const th = useTheme();
  return <View style={{ height: h, borderRadius: h / 2, backgroundColor: th.dark ? '#262C36' : '#ECEEF2', overflow: 'hidden' }}><View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: h, backgroundColor: th.accent }} /></View>;
}

// House > Beredskap: what to have at home for a week (DSB's advice), what is in stock and when it expires, a family plan and emergency numbers.
export function PrepView({ householdId }: { householdId: string }) {
  const th = useTheme();
  const { t, tn, lang, locale } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [profile, setProfile] = useState<PrepProfile | null>(null);
  const [stock, setStock] = useState<PrepStock[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ahead, setAhead] = useState<ReturnType<typeof stormAhead>>(null);
  const [busy, setBusy] = useState(false);
  const today = isoOf(new Date());

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([getPrepSettings(householdId), listPrepStock(householdId)]);
      setProfile(p); setStock(s); setOffline(false); setNeedsUpgrade(false); setErr(null);
      writeJson(cacheKey(householdId), { p, s });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/prep_settings|prep_stock|schema cache|does not exist/i.test(m)) { setNeedsUpgrade(true); return; }
      // No connection (the very moment this page is for): the last saved copy.
      const c = readJson<{ p: PrepProfile; s: PrepStock[] } | null>(cacheKey(householdId), null);
      if (c) { setProfile(c.p); setStock(c.s); setOffline(true); return; }
      setErr(m);
    }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    listWeatherPlaces(householdId).then(async (places) => { const home = places.find((p) => p.is_home); if (home) setAhead(stormAhead(await loadForecast(home.lat, home.lon), today)); }).catch(() => {});
  }, [householdId, today]);

  const p = profile;
  const states = useMemo(() => (p ? itemStates(p, stock) : []), [p, stock]);
  const ready = useMemo(() => (p ? readiness(p, stock) : null), [p, stock]);
  const expiring = useMemo(() => (p ? expiringSoon(stock, today, p.lead_days) : []), [p, stock, today]);

  const saveProfile = async (next: PrepProfile) => { setProfile(next); try { await savePrepSettings(householdId, next); writeJson(cacheKey(householdId), { p: next, s: stock }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const run = async (fn: () => Promise<void>) => { try { setErr(null); setBusy(true); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  if (needsUpgrade) return <Card><Text style={{ color: th.danger, fontFamily: font.body, fontSize: 15 }}>{t('prep.noTable')}</Text></Card>;
  if (!p || !ready) return err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : <Muted>{t('common.loading')}</Muted>;

  const dateText = (d: string) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const expiryPill = (s: PrepStock) => {
    const st = expiryState(s.expires_on, today, p.lead_days);
    if (st === 'none') return <Pill text={t('prep.noDate')} />;
    const d = daysUntil(s.expires_on as string, today);
    const text = st === 'expired' ? t('prep.expired', { date: dateText(s.expires_on as string) }) : d === 0 ? t('prep.expiresToday') : d < 60 ? tn('prep.expiresIn', d) : t('prep.expiresOn', { date: dateText(s.expires_on as string) });
    return <Pill text={text} tone={st === 'expired' ? 'expired' : st === 'soon' ? 'soon' : undefined} />;
  };
  const stockFor = (item: PrepItem): Draft => ({ key: item.key, name: itemName(item, lang), category: item.cat, qty: 1, unit: itemUnit(item, lang), expires_on: suggestedExpiry(item, today), renew_months: item.renewMonths ?? null, location: null, notes: null });

  async function buy() {
    if (!p) return;
    const miss = missingItems(p, stock);
    if (miss.length === 0) return toast({ text: t('prep.buyNone') });
    setBusy(true);
    try { const r = await addMissingTodos(householdId, miss, lang, t); toast({ text: r.made > 0 ? tn('prep.buyDone', r.made) : t('prep.buyAlready') }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const used = (s: PrepStock) => run(async () => {
    const item = PREP_ITEMS.find((i) => i.key === s.key) ?? null;
    if (s.qty > 1) await savePrepStock(householdId, { ...s, qty: s.qty - 1 }); else await deletePrepStock(s.id);
    await addReplacementTodo(householdId, item, s.name, s.unit ?? '', lang, t);
    toast({ text: t('prep.usedMsg') });
  });
  const checked = (s: PrepStock) => run(async () => {
    if (!s.renew_months) return;
    const next = addMonths(s.expires_on && s.expires_on > today ? s.expires_on : today, s.renew_months);
    await savePrepStock(householdId, { ...s, expires_on: next });
    toast({ text: t('prep.checkedMsg', { date: dateText(next) }) });
  });

  const num = (label: string, key: 'adults' | 'children' | 'pets' | 'days' | 'iodine_people' | 'lead_days', min: number, max: number) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 }}>
      <Text style={{ flex: 1, color: th.ink, fontFamily: font.body, fontSize: 15 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Btn small label="−" onPress={() => void saveProfile({ ...p, [key]: Math.max(min, p[key] - 1) })} />
        <Text accessibilityLabel={`${label}: ${p[key]}`} style={{ minWidth: 34, textAlign: 'center', color: th.ink, fontFamily: font.semi, fontSize: 17 }}>{p[key]}</Text>
        <Btn small label="+" onPress={() => void saveProfile({ ...p, [key]: Math.min(max, p[key] + (key === 'lead_days' ? 5 : 1)) })} />
      </View>
    </View>
  );
  const toggle = (label: string, key: 'baby' | 'wood_stove') => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
      <Text style={{ flex: 1, color: th.ink, fontFamily: font.body, fontSize: 15 }}>{label}</Text>
      <Chip label={p[key] ? '✓' : '–'} on={p[key]} onPress={() => void saveProfile({ ...p, [key]: !p[key] })} />
    </View>
  );

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['overview', 'list', 'stock', 'plan'] as Tab[]).map((x) => <Chip key={x} label={t(`prep.tab.${x}` as 'prep.tab.list')} on={tab === x} onPress={() => setTab(x)} />)}
      </View>
      {offline ? <Muted>{t('prep.offline')}</Muted> : null}
      {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}

      {tab === 'overview' && (
        <>
          <Card gap={8}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 24, fontFamily: font.display }}>{ready.days >= p.days ? t('prep.headlineAll', { days: p.days }) : t('prep.headline', { n: ready.days, days: p.days })}</Text>
            <Bar pct={ready.percent} />
            <Muted>{t('prep.percent', { n: ready.percent })}{ready.weakest ? ` · ${t(`prep.weak.${ready.weakest}` as 'prep.weak.water')}` : ''}</Muted>
            {ready.percent === 100 ? <Muted>{t('prep.allGood')}</Muted> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PREP_CATS.filter((c) => ready.byCat[c]).map((c) => (
                <Pressable key={c} accessibilityRole="button" accessibilityLabel={`${catLabel(c, lang)} ${ready.byCat[c]!.pct}%`} onPress={() => setTab('list')}
                  style={{ width: '48%', gap: 4, backgroundColor: th.dark ? '#262C36' : '#ECEEF2', borderRadius: 12, padding: 10, minHeight: 48 }}>
                  <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 13 }}>{catLabel(c, lang)}</Text>
                  <Bar pct={ready.byCat[c]!.pct} h={6} />
                </Pressable>
              ))}
            </View>
          </Card>

          {ahead ? <View style={{ borderRadius: 16, padding: 14, backgroundColor: th.tint }}><Text style={{ color: th.tintInk, fontFamily: font.semi, fontSize: 14 }}>{t(`prep.ahead.${ahead.kind}` as 'prep.ahead.storm', { date: dateText(ahead.date) })}</Text></View> : null}

          <Card gap={6}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('prep.expiring')}</Text>
            {expiring.length === 0 ? <Muted>{t('prep.noneExpiring')}</Muted> : (
              <>
                <Muted>{tn('prep.expiringN', expiring.length, { days: p.lead_days })}</Muted>
                {expiring.slice(0, 5).map((s) => <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, color: th.ink, fontFamily: font.semi, fontSize: 15 }}>{s.name}</Text>{expiryPill(s)}</View>)}
                <View style={{ flexDirection: 'row' }}><Btn small label={t('prep.tab.stock')} onPress={() => setTab('stock')} /></View>
              </>
            )}
          </Card>

          <Card gap={4}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('prep.household')}</Text>
            <Muted>{t('prep.householdHelp')}</Muted>
            {num(t('prep.adults'), 'adults', 1, 12)}{num(t('prep.children'), 'children', 0, 12)}{num(t('prep.pets'), 'pets', 0, 20)}{num(t('prep.days'), 'days', 1, 21)}{num(t('prep.iodine'), 'iodine_people', 0, 20)}
            {toggle(t('prep.baby'), 'baby')}{toggle(t('prep.stove'), 'wood_stove')}{num(t('prep.lead'), 'lead_days', 1, 365)}
          </Card>

          <Card gap={8}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('prep.buyMissing')}</Text>
            <Muted>{t('prep.buyHelp')}</Muted>
            <Btn primary disabled={busy} label={t('prep.buyMissing')} onPress={() => void buy()} />
            <Btn disabled={busy} label={t('prep.review')} onPress={() => void run(async () => { await addReviewJob(householdId, t('prep.reviewTitle'), t('prep.reviewNotes')); toast({ text: t('prep.reviewDone') }); })} />
          </Card>

          <Card gap={8}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('prep.card')}</Text>
            <Muted>{t('prep.cardHelp')}</Muted>
            <View style={{ flexDirection: 'row' }}><Btn label={t('prep.share')} onPress={() => void Share.share({ message: cardText(lang, p, stock) })} /></View>
          </Card>
          <Muted>{t('prep.source')}</Muted>
        </>
      )}

      {tab === 'list' && PREP_CATS.map((c) => {
        const list = states.filter((s) => s.item.cat === c);
        if (list.length === 0) return null;
        return (
          <View key={c} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ color: th.muted, fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: font.semi, paddingHorizontal: 4, paddingTop: 8 }}>{catLabel(c, lang)}</Text>
            {list.map((s) => <ItemCard key={s.item.key} s={s} p={p} lang={lang} onAdd={() => setDraft(stockFor(s.item))} onTarget={(n) => void saveProfile({ ...p, overrides: n == null ? Object.fromEntries(Object.entries(p.overrides).filter(([k]) => k !== s.item.key)) : { ...p.overrides, [s.item.key]: n } })} />)}
          </View>
        );
      })}

      {tab === 'stock' && (
        <>
          <Btn primary label={t('prep.addCustom')} onPress={() => setDraft({ key: null, name: '', category: 'other', qty: 1, unit: null, expires_on: null, renew_months: null, location: null, notes: null })} />
          {stock.length === 0 ? <Muted>{t('prep.stock.empty')}</Muted> : null}
          {byExpiry(stock).map((s) => (
            <Card key={s.id} gap={6}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1, gap: 2 }}><Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{s.name}</Text><Muted>{`${s.qty} ${s.unit ?? ''}${s.location ? ` · ${s.location}` : ''}`}</Muted></View>
                {expiryPill(s)}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Btn small disabled={busy} label={t('prep.used')} onPress={() => void used(s)} />
                {s.renew_months ? <Btn small disabled={busy} label={t('prep.checked')} onPress={() => void checked(s)} /> : null}
                <Btn small label={t('prep.editStock')} onPress={() => setDraft({ ...s })} />
              </View>
            </Card>
          ))}
        </>
      )}

      {tab === 'plan' && <PlanTab p={p} lang={lang} onSave={saveProfile} />}

      {draft ? <StockModal draft={draft} today={today} lang={lang} onClose={() => setDraft(null)}
        onSave={async (d) => { await savePrepStock(householdId, d); setDraft(null); await load(); }}
        onDelete={draft.id ? () => Alert.alert(t('prep.deleteAsk'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('prep.delete'), style: 'destructive', onPress: async () => { try { await deletePrepStock(draft.id as string); setDraft(null); await load(); } catch (e) { Alert.alert(e instanceof Error ? e.message : String(e)); } } }]) : undefined} /> : null}
    </View>
  );
}

function ItemCard({ s, p, lang, onAdd, onTarget }: { s: ItemState; p: PrepProfile; lang: string; onAdd: () => void; onTarget: (n: number | null) => void }) {
  const th = useTheme();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(s.target));
  const tip = itemTip(s.item, lang);
  const own = p.overrides[s.item.key] != null;
  return (
    <Card gap={6}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ flex: 1, color: th.ink, fontSize: 16, fontFamily: font.semi }}>{itemName(s.item, lang)}</Text>
        {s.item.optional ? <Pill text={t('prep.optional')} /> : null}
      </View>
      <Muted>{`${s.done ? `✓ ${t('prep.done')}` : t('prep.missingN', { n: s.missing, unit: itemUnit(s.item, lang) })} · ${t('prep.have', { have: s.have, target: s.target, unit: itemUnit(s.item, lang) })}`}</Muted>
      <Bar pct={s.pct * 100} h={6} />
      {tip ? <Muted>{tip}</Muted> : null}
      {editing ? (
        <View style={{ gap: 8 }}>
          <Field value={val} keyboardType="decimal-pad" onChangeText={setVal} accessibilityLabel={t('prep.target')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Btn small primary label={t('common.save')} onPress={() => { const n = Number(val.replace(',', '.')); if (Number.isFinite(n) && n >= 0) { onTarget(n); setEditing(false); } }} />
            {own ? <Btn small label={t('prep.useRecommended')} onPress={() => { onTarget(null); setEditing(false); }} /> : null}
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Btn small primary label={t('prep.add')} onPress={onAdd} />
          <Btn small label={t('prep.target')} onPress={() => { setVal(String(s.target)); setEditing(true); }} />
        </View>
      )}
    </Card>
  );
}

function StockModal({ draft, today, lang, onClose, onSave, onDelete }: { draft: Draft; today: string; lang: string; onClose: () => void; onSave: (d: Draft) => Promise<void>; onDelete?: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Draft>(draft);
  const [qty, setQty] = useState(String(draft.qty));
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const item = PREP_ITEMS.find((i) => i.key === d.key);
  async function save() {
    const n = Number(qty.replace(',', '.'));
    if (!d.name.trim()) return Alert.alert(t('prep.nameErr'));
    if (!Number.isFinite(n) || n < 0) return Alert.alert(t('prep.qtyErr'));
    let expires = d.expires_on;
    if (month.trim()) { expires = parseMonthDate(month); if (!expires) return Alert.alert(t('prep.dateErr')); }
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), qty: n, expires_on: expires }); } catch (e) { Alert.alert(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Sheet title={d.id ? t('prep.editStock') : t('prep.newStock')} onClose={onClose}>
      <Lbl>{t('prep.name')}</Lbl><Field value={d.name} maxLength={80} onChangeText={(v) => set('name', v)} accessibilityLabel={t('prep.name')} />
      <Lbl>{t('prep.qty')}</Lbl><Field value={qty} keyboardType="decimal-pad" onChangeText={setQty} accessibilityLabel={t('prep.qty')} />
      <Lbl>{t('prep.unit')}</Lbl><Field value={d.unit ?? ''} onChangeText={(v) => set('unit', v || null)} accessibilityLabel={t('prep.unit')} />
      <DateField label={t('prep.expires')} value={d.expires_on} onChange={(v) => { set('expires_on', v); setMonth(''); }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[6, 12, 24, 60].map((n) => <Chip key={n} label={n < 12 ? t('prep.months', { n }) : t('prep.years', { n: n / 12 })} onPress={() => { set('expires_on', addMonths(today, n)); setMonth(''); }} />)}
        {item?.shelfMonths ? <Chip label={itemName(item, lang)} onPress={() => { set('expires_on', suggestedExpiry(item, today)); setMonth(''); }} /> : null}
      </View>
      <Field value={month} placeholder="03/2027" keyboardType="numbers-and-punctuation" onChangeText={setMonth} accessibilityLabel={t('prep.expiresHelp')} />
      <Muted>{t('prep.expiresHelp')}</Muted>
      <Select<number | null> label={t('prep.renew')} value={d.renew_months} options={[{ value: null, label: t('prep.renewNone') }, ...[1, 3, 6, 12, 24].map((n) => ({ value: n as number | null, label: String(n) }))]} onChange={(v) => set('renew_months', v)} />
      <Lbl>{t('prep.location')}</Lbl><Field value={d.location ?? ''} onChangeText={(v) => set('location', v || null)} accessibilityLabel={t('prep.location')} />
      <Lbl>{t('prep.notes')}</Lbl><Field multiline value={d.notes ?? ''} onChangeText={(v) => set('notes', v || null)} accessibilityLabel={t('prep.notes')} />
      <Btn primary disabled={busy} label={t('common.save')} onPress={() => void save()} />
      {onDelete ? <Btn danger label={t('prep.delete')} onPress={onDelete} /> : null}
    </Sheet>
  );
}

function PlanTab({ p, lang, onSave }: { p: PrepProfile; lang: string; onSave: (p: PrepProfile) => Promise<void> }) {
  const th = useTheme();
  const { t } = useI18n();
  const [meeting, setMeeting] = useState(p.meeting_place ?? '');
  const [outside, setOutside] = useState(p.outside_contact ?? '');
  const [notes, setNotes] = useState(p.notes ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const h = (s: string) => <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{s}</Text>;
  return (
    <>
      <Card gap={6}>
        {h(t('prep.plan.title'))}
        <Lbl>{t('prep.meeting')}</Lbl><Field value={meeting} onChangeText={setMeeting} onEndEditing={() => void onSave({ ...p, meeting_place: meeting.trim() || null })} accessibilityLabel={t('prep.meeting')} />
        <Lbl>{t('prep.outside')}</Lbl><Field value={outside} onChangeText={setOutside} onEndEditing={() => void onSave({ ...p, outside_contact: outside.trim() || null })} accessibilityLabel={t('prep.outside')} />
        <Lbl>{t('prep.notesPlan')}</Lbl><Field multiline value={notes} onChangeText={setNotes} onEndEditing={() => void onSave({ ...p, notes: notes.trim() || null })} accessibilityLabel={t('prep.notesPlan')} />
      </Card>
      <Card gap={6}>
        {h(t('prep.numbers'))}
        {EMERGENCY_NUMBERS.map((e) => (
          <View key={e.number} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 }}>
            <Text style={{ flex: 1, color: th.ink, fontFamily: font.body, fontSize: 15 }}><Text style={{ fontFamily: font.semi }}>{formatNumber(e.number)}</Text>  {lang === 'nb' ? e.nb : e.en}</Text>
            <Btn small label={t('prep.call')} onPress={() => void Linking.openURL(`tel:${e.number}`).catch(() => {})} />
          </View>
        ))}
      </Card>
      <Card gap={4}>
        {h(t('prep.guides'))}
        {['power', 'water', 'evac', 'iodine', 'storm'].map((g) => (
          <View key={g} style={{ gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === g }} onPress={() => setOpen(open === g ? null : g)} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: th.accentText, fontFamily: font.semi, fontSize: 15 }}>{open === g ? '▾ ' : '▸ '}{t(`prep.g.${g}.t` as 'prep.g.power.t')}</Text>
            </Pressable>
            {open === g ? <Text style={{ color: th.ink, fontFamily: font.body, fontSize: 15, lineHeight: 21 }}>{t(`prep.g.${g}.b` as 'prep.g.power.b')}</Text> : null}
          </View>
        ))}
        <Muted>{t('prep.source')}</Muted>
      </Card>
    </>
  );
}

