import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { addTask } from './api';
import { useI18n } from './i18n';
import { useSession } from './session';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted, SectionLabel, styles } from './ui';

const INTERVALS = [1, 3, 6, 12, 24, 60];

// Add your own recurring task ("oil the terrace every year", "clean the gutters every autumn").
export function AddTaskForm({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
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
    if (lastDone && !/^\d{4}-\d{2}-\d{2}$/.test(lastDone)) return Alert.alert(tr('task.dateFormat'));
    try {
      await addTask({
        householdId: household.id, title: title.trim(), notes, schedule: kind,
        intervalMonths: kind === 'interval' ? months : undefined,
        windowStart: kind === 'seasonal' ? ws : undefined, windowEnd: kind === 'seasonal' ? we : undefined,
        lastDone: lastDone || null,
      });
      onDone();
    } catch (e) {
      Alert.alert(tr('common.error'), e instanceof Error ? e.message : String(e));
    }
  }

  const monthRow = (value: number, set: (m: number) => void) => (
    <View style={styles.row}>{Array.from({ length: 12 }, (_, i) => <Btn key={i} small label={tr(`month.${i + 1}` as 'month.1')} primary={value === i + 1} onPress={() => set(i + 1)} />)}</View>
  );

  return (
    <Card gap={10}>
      <Text style={{ color: t.ink, fontSize: 18, fontFamily: font.semi }}>{tr('task.new')}</Text>
      <Field placeholder={tr('task.titlePh')} value={title} onChangeText={setTitle} />
      <Field placeholder={tr('task.notesPh')} value={notes} onChangeText={setNotes} />
      <SectionLabel>{tr('task.howOften')}</SectionLabel>
      <View style={styles.row}>
        <Btn small label={tr('task.interval')} primary={kind === 'interval'} onPress={() => setKind('interval')} />
        <Btn small label={tr('task.seasonal')} primary={kind === 'seasonal'} onPress={() => setKind('seasonal')} />
      </View>
      {kind === 'interval' ? (
        <View style={styles.row}>{INTERVALS.map((n) => <Btn key={n} small label={tr(`task.i${n}` as 'task.i1')} primary={months === n} onPress={() => setMonths(n)} />)}</View>
      ) : (
        <View style={{ gap: 8 }}>
          <Muted>{tr('task.from')}</Muted>{monthRow(ws, setWs)}
          <Muted>{tr('task.until')}</Muted>{monthRow(we, setWe)}
        </View>
      )}
      <Field placeholder={tr('task.lastDone') + ' 2026-09-30'} value={lastDone} onChangeText={setLastDone} autoCapitalize="none" />
      <Btn primary label={tr('task.add')} onPress={save} disabled={!title.trim()} />
      <Btn label={tr('common.cancel')} onPress={onDone} />
    </Card>
  );
}
