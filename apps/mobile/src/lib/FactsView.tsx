import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { addFact, deleteFact, listFacts } from './api';
import { useSession } from './session';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted, SectionLabel, styles } from './ui';
import { FACT_LABELS, groupFacts, type FactCategory } from '../core/facts.ts';
import type { HouseFact } from './types';

const SHOPS: [string, string][] = [['hardware', 'Hardware'], ['paint', 'Paint'], ['garden', 'Garden'], ['grocery', 'Grocery'], ['pharmacy', 'Pharmacy']];

// Things you need to look up in a shop or in an emergency. Emergency facts are shown first, big, and work offline.
export function FactsView() {
  const t = useTheme();
  const { household } = useSession();
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
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    }
  }

  const groups = groupFacts(facts);
  return (
    <View style={{ gap: 14 }}>
      <Muted>What size was it? Where is the shutoff? Save it once. Tag a fact with a shop and it shows up on that store's list.</Muted>
      {groups.length === 0 && <Muted>No facts yet. Start with where the water shutoff and fuse box are.</Muted>}
      {groups.map((g) => (
        <View key={g.category} style={{ gap: 10 }}>
          <SectionLabel>{g.category === 'emergency' ? 'Emergency card' : g.label}</SectionLabel>
          {g.items.map((f) => (
            <Card key={f.id} gap={6}>
              <Text style={{ color: t.ink, fontSize: g.category === 'emergency' ? 20 : 17, fontFamily: font.semi }}>{f.title}</Text>
              {f.value ? <Text selectable style={{ color: t.ink, fontSize: g.category === 'emergency' ? 18 : 16, lineHeight: 23, fontFamily: font.body }}>{f.value}</Text> : null}
              {f.surface_at.length > 0 && <Muted>Shown at: {f.surface_at.join(', ')}</Muted>}
              <View style={styles.row}>
                <Btn small danger label="Delete" onPress={() => Alert.alert('Delete this fact?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => { await deleteFact(f.id).catch(() => {}); await load(); } },
                ])} />
              </View>
            </Card>
          ))}
        </View>
      ))}
      {adding ? (
        <Card gap={10}>
          <Field placeholder="Title (e.g. Water shutoff, Bedroom paint)" value={title} onChangeText={setTitle} />
          <Field placeholder="Details (e.g. under the kitchen sink, left valve)" multiline value={value} onChangeText={setValue} />
          <SectionLabel>Type</SectionLabel>
          <View style={styles.row}>
            {(Object.keys(FACT_LABELS) as FactCategory[]).map((c) => <Btn key={c} small label={FACT_LABELS[c]} primary={category === c} onPress={() => setCategory(c)} />)}
          </View>
          <SectionLabel>Show on the list at</SectionLabel>
          <View style={styles.row}>
            {SHOPS.map(([id, label]) => (
              <Btn key={id} small label={label} primary={shops.includes(id)} onPress={() => setShops((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
            ))}
          </View>
          <Btn primary label="Save fact" onPress={save} disabled={!title.trim()} />
          <Btn label="Cancel" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Btn label="+ Add a fact" onPress={() => setAdding(true)} />
      )}
    </View>
  );
}
