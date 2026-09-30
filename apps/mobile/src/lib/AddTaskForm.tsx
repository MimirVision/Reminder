import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { addTask } from './api';
import { useSession } from './session';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted, SectionLabel, styles } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INTERVALS: [number, string][] = [[1, 'Monthly'], [3, '3 months'], [6, '6 months'], [12, 'Yearly'], [24, '2 years'], [60, '5 years']];

// Add your own recurring task ("oil the terrace every year", "clean the gutters every autumn").
export function AddTaskForm({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const { household } = useSession();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [kind, setKind] = useState<'interval' | 'seasonal'>('interval');
  const [months, setMonths] = useState(12);
  const [ws, setWs] = useState(9);
  const [we, setWe] = useState(10);
  const [lastDone, setLastDone] = useState('');

  async function save() {
    if (!household || !title.trim()) return;
    if (lastDone && !/^\d{4}-\d{2}-\d{2}$/.test(lastDone)) return Alert.alert('Use the date format 2026-09-30, or leave it empty.');
    try {
      await addTask({
        householdId: household.id, title: title.trim(), notes, schedule: kind,
        intervalMonths: kind === 'interval' ? months : undefined,
        windowStart: kind === 'seasonal' ? ws : undefined, windowEnd: kind === 'seasonal' ? we : undefined,
        lastDone: lastDone || null,
      });
      onDone();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    }
  }

  const monthRow = (value: number, set: (m: number) => void) => (
    <View style={styles.row}>{MONTHS.map((m, i) => <Btn key={m} small label={m} primary={value === i + 1} onPress={() => set(i + 1)} />)}</View>
  );

  return (
    <Card gap={10}>
      <Text style={{ color: t.ink, fontSize: 18, fontFamily: font.semi }}>New recurring task</Text>
      <Field placeholder="What needs doing? (e.g. Oil the terrace)" value={title} onChangeText={setTitle} />
      <Field placeholder="Notes (optional)" value={notes} onChangeText={setNotes} />
      <SectionLabel>How often</SectionLabel>
      <View style={styles.row}>
        <Btn small label="Every so often" primary={kind === 'interval'} onPress={() => setKind('interval')} />
        <Btn small label="Same time each year" primary={kind === 'seasonal'} onPress={() => setKind('seasonal')} />
      </View>
      {kind === 'interval' ? (
        <View style={styles.row}>{INTERVALS.map(([n, label]) => <Btn key={n} small label={label} primary={months === n} onPress={() => setMonths(n)} />)}</View>
      ) : (
        <View style={{ gap: 8 }}>
          <Muted>From</Muted>{monthRow(ws, setWs)}
          <Muted>Until</Muted>{monthRow(we, setWe)}
        </View>
      )}
      <Field placeholder="Last done (optional, 2026-09-30)" value={lastDone} onChangeText={setLastDone} autoCapitalize="none" />
      <Btn primary label="Add task" onPress={save} disabled={!title.trim()} />
      <Btn label="Cancel" onPress={onDone} />
    </Card>
  );
}
