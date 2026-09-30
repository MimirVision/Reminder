import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { addFact, deleteFact, listFacts } from './api';
import { useSession } from './session';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted, SectionLabel, styles } from './ui';
import * as ImagePicker from 'expo-image-picker';
import { groupFacts, type FactCategory } from '../core/facts.ts';
import { CATEGORIES, shopName } from '../shared/lib/labels';
import { useI18n } from './i18n';
import { readLabel } from './api';
import type { HouseFact } from './types';

const FACT_ORDER: FactCategory[] = ['emergency', 'measurement', 'paint', 'appliance', 'other'];

// Things you need to look up in a shop or in an emergency. Emergency facts are shown first, big, and work offline.
export function FactsView() {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const { household } = useSession();
  const [reading, setReading] = useState(false);
  const [facts, setFacts] = useState<HouseFact[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState<FactCategory>('other');
  const [shops, setShops] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (household) setFacts(await listFacts(household.id));
  }, [household]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!household || !title.trim()) return;
    try {
      await addFact({ household_id: household.id, title: title.trim(), value: value.trim(), category, surface_at: shops });
      setTitle(''); setValue(''); setCategory('other'); setShops([]); setAdding(false);
      await load();
    } catch (e) {
      Alert.alert(tr('common.error'), e instanceof Error ? e.message : String(e));
    }
  }

  async function fromPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted || !household) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (res.canceled) return;
    setReading(true);
    try {
      const f = await readLabel(household.id, res.assets[0].uri, lang);
      setTitle(f.title); setValue(f.value); setCategory(f.category); setShops(f.surface_at); setAdding(true);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      Alert.alert(tr('common.error'), m.startsWith('label:') ? tr(`label.err.${m.slice(6)}` as 'label.err.failed') : m);
    } finally { setReading(false); }
  }

  const groups = groupFacts(facts);
  return (
    <View style={{ gap: 14 }}>
      <Muted>{tr('facts.intro')}</Muted>
      {groups.length === 0 && <Muted>{tr('facts.empty')}</Muted>}
      {groups.map((g) => (
        <View key={g.category} style={{ gap: 10 }}>
          <SectionLabel>{g.category === 'emergency' ? tr('facts.emergencyCard') : tr(`facts.cat.${g.category}` as 'facts.cat.other')}</SectionLabel>
          {g.items.map((f) => (
            <Card key={f.id} gap={6}>
              <Text style={{ color: t.ink, fontSize: g.category === 'emergency' ? 20 : 17, fontFamily: font.semi }}>{f.title}</Text>
              {f.value ? <Text selectable style={{ color: t.ink, fontSize: g.category === 'emergency' ? 18 : 16, lineHeight: 23, fontFamily: font.body }}>{f.value}</Text> : null}
              {f.surface_at.length > 0 && <Muted>{tr('facts.shownAt', { shops: f.surface_at.map((x) => shopName(x, tr)).join(', ') })}</Muted>}
              <View style={styles.row}>
                <Btn small danger label={tr('common.delete')} onPress={() => Alert.alert(tr('facts.confirmDelete'), undefined, [
                  { text: tr('common.cancel'), style: 'cancel' },
                  { text: tr('common.delete'), style: 'destructive', onPress: async () => { await deleteFact(f.id).catch(() => {}); await load(); } },
                ])} />
              </View>
            </Card>
          ))}
        </View>
      ))}
      {adding ? (
        <Card gap={10}>
          <Field placeholder={tr('facts.titlePh')} value={title} onChangeText={setTitle} />
          <Field placeholder={tr('facts.valuePh')} multiline value={value} onChangeText={setValue} />
          <SectionLabel>{tr('facts.type')}</SectionLabel>
          <View style={styles.row}>
            {FACT_ORDER.map((c) => <Btn key={c} small label={tr(`facts.cat.${c}` as 'facts.cat.other')} primary={category === c} onPress={() => setCategory(c)} />)}
          </View>
          <SectionLabel>{tr('facts.showAt')}</SectionLabel>
          <View style={styles.row}>
            {CATEGORIES.map((id) => (
              <Btn key={id} small label={shopName(id, tr)} primary={shops.includes(id)} onPress={() => setShops((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
            ))}
          </View>
          <Btn primary label={tr('facts.save')} onPress={save} disabled={!title.trim()} />
          <Btn label={tr('common.cancel')} onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <View style={{ gap: 8 }}>
          <Btn label={tr('facts.add')} onPress={() => setAdding(true)} />
          <Btn label={reading ? tr('label.reading') : tr('label.button')} onPress={fromPhoto} disabled={reading} />
          <Muted>{tr('label.intro')}</Muted>
        </View>
      )}
    </View>
  );
}
