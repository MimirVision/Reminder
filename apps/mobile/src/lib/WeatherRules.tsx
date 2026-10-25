import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteWeatherRule, listPlaces, saveWeatherRule } from './api';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { weatherState, WEATHER_PLACE_KEY, type WeatherState } from './reminders';
import { Select } from './Select';
import { readJson, writeJson } from './store';
import { font, useTheme } from './theme';
import type { PlaceRow } from '../core/types.ts';
import { Btn, Card, Field, Muted } from './ui';
import { SCENARIOS, SCENARIO_DEFAULT, ruleSummary, starterRule, thresholdOf, type Frequency, type Lead, type RuleDraft, type WeatherRule } from '../shared/lib/weather';

const TIMES = ['06:00', '07:00', '07:30', '08:00', '09:00', '12:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

// Settings card: the household's weather rules, a template picker to start from, and the place the forecast is for.
export function WeatherRules({ householdId, onChanged }: { householdId: string; onChanged: () => void }) {
  const th = useTheme();
  const { t } = useI18n();
  const [w, setW] = useState<WeatherState | null>(null);
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await listPlaces(householdId);
      setPlaces(p.filter((x) => x.kind === 'fixed' && x.lat != null));
      setW(await weatherState(householdId, p));
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const changed = async () => { await load(); onChanged(); };
  const toggle = async (r: WeatherRule) => { try { await saveWeatherRule(householdId, { ...r, enabled: !r.enabled }); await changed(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const addFromTemplate = () => {
    ActionSheetPick(SCENARIOS.map((s) => t(`weather.s.${s}` as 'weather.s.rain')), t('weather.template'), t('common.cancel'), th.dark, (i) => setDraft(starterRule(t, SCENARIOS[i])));
  };

  return (
    <Card>
      <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('weather.title')}</Text>
      <Muted>{t('weather.intro')}</Muted>
      {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}
      {w && w.rules.length === 0 && !err ? <Muted>{t('weather.empty')}</Muted> : null}
      {(w?.rules ?? []).map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t('weather.edit')}: ${r.name}`} onPress={() => setDraft(r)} style={{ flex: 1, minHeight: 44, justifyContent: 'center', gap: 2 }}>
            <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{r.name}</Text>
            <Muted>{ruleSummary(t, r)}</Muted>
          </Pressable>
          <Switch value={r.enabled} accessibilityLabel={`${t('weather.enabled')}: ${r.name}`} onValueChange={() => void toggle(r)} />
        </View>
      ))}
      <Btn label={t('weather.add')} onPress={addFromTemplate} />
      {places.length === 0 ? <Muted>{t('weather.noPlace')}</Muted> : (
        <Select<string> label={t('weather.forecast', { place: '' }).trim()} title={t('weather.forecast', { place: '' }).trim()} value={w?.placeId ?? places[0].id}
          options={places.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => { writeJson(WEATHER_PLACE_KEY, id); void changed(); }} />
      )}
      {draft ? <RuleModal draft={draft} onClose={() => setDraft(null)}
        onSave={async (d) => { await saveWeatherRule(householdId, d); setDraft(null); await changed(); }}
        onDelete={draft.id ? () => Alert.alert(t('weather.deleteAsk'), undefined, [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('weather.delete'), style: 'destructive', onPress: async () => { try { await deleteWeatherRule(draft.id as string); setDraft(null); await changed(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } } },
        ]) : undefined} /> : null}
    </Card>
  );
}

function ActionSheetPick(labels: string[], title: string, cancel: string, dark: boolean, pick: (i: number) => void) {
  ActionSheetIOS.showActionSheetWithOptions({ title, options: [...labels, cancel], cancelButtonIndex: labels.length, userInterfaceStyle: dark ? 'dark' : 'light' }, (i) => { if (i < labels.length) pick(i); });
}

function RuleModal({ draft, onClose, onSave, onDelete }: { draft: RuleDraft; onClose: () => void; onSave: (d: RuleDraft) => Promise<void>; onDelete?: () => void }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [d, setD] = useState<RuleDraft>(draft);
  const [items, setItems] = useState(draft.items.join('\n'));
  const [thr, setThr] = useState(String(thresholdOf(draft) ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const label = (s: string) => <Text style={{ color: th.muted, fontFamily: font.semi, fontSize: 14, marginTop: 6 }}>{s}</Text>;

  async function save() {
    const list = items.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!d.name.trim() || list.length === 0) { setErr(t('weather.items')); return; }
    const n = Number(thr.replace(',', '.'));
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), items: list, threshold: d.scenario === 'storm' || thr.trim() === '' || !Number.isFinite(n) ? null : n }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: insets.bottom + 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontFamily: font.display, fontSize: 26 }}>{d.id ? t('weather.edit') : t('weather.new')}</Text>
            <Btn small label={t('common.close')} onPress={onClose} />
          </View>
          {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}
          {label(t('weather.name'))}
          <Field value={d.name} maxLength={60} onChangeText={(v) => set('name', v)} accessibilityLabel={t('weather.name')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {SCENARIOS.map((s) => <Chip key={s} label={t(`weather.s.${s}` as 'weather.s.rain')} on={d.scenario === s} onPress={() => { set('scenario', s); setThr(String(SCENARIO_DEFAULT[s].threshold ?? '')); }} />)}
          </View>
          {d.scenario !== 'storm' && <>{label(t(`weather.thr.${d.scenario}` as 'weather.thr.rain'))}<Field value={thr} keyboardType="numbers-and-punctuation" onChangeText={setThr} accessibilityLabel={t(`weather.thr.${d.scenario}` as 'weather.thr.rain')} /></>}
          {label(t('weather.items'))}
          <Field multiline value={items} onChangeText={setItems} accessibilityLabel={t('weather.items')} />
          {label(t('weather.lead'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['evening_before', 'same_morning'] as Lead[]).map((l) => <Chip key={l} label={t(`weather.lead.${l}` as 'weather.lead.same_morning')} on={d.lead === l} onPress={() => set('lead', l)} />)}
          </View>
          <Select<string> label={t('weather.at')} value={d.at_time} options={[...new Set([...TIMES, d.at_time])].sort().map((v) => ({ value: v, label: v }))} onChange={(v) => set('at_time', v)} />
          {label(t('weather.freq'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['spell', 'every'] as Frequency[]).map((f) => <Chip key={f} label={t(`weather.freq.${f}` as 'weather.freq.spell')} on={d.frequency === f} onPress={() => set('frequency', f)} />)}
          </View>
          {d.frequency === 'spell' && <Select<number> label={t('weather.gap')} value={d.dry_gap} options={[1, 2, 3, 4, 5, 7].map((n) => ({ value: n, label: String(n) }))} onChange={(n) => set('dry_gap', n)} />}
          {label(t('weather.quiet'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => <Chip key={wd} label={t(`weather.dow.${wd}` as 'weather.dow.0')} on={d.quiet_days.includes(wd)} onPress={() => set('quiet_days', d.quiet_days.includes(wd) ? d.quiet_days.filter((x) => x !== wd) : [...d.quiet_days, wd])} />)}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginTop: 6 }}>
            <Text style={{ flex: 1, color: th.ink, fontFamily: font.body, fontSize: 16 }}>{t('weather.followUp')}</Text>
            <Switch value={d.follow_up} accessibilityLabel={t('weather.followUp')} onValueChange={(v) => set('follow_up', v)} />
          </View>
          <Btn primary disabled={busy} label={t('weather.save')} onPress={() => void save()} />
          {onDelete ? <Btn danger label={t('weather.delete')} onPress={onDelete} /> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
