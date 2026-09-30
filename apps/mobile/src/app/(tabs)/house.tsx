import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, Switch, Text, View } from 'react-native';
import { completeTask, listTaskEvents, listTasks, retireTask, seedHouseTemplate } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Btn, Card, Field, Muted, styles } from '@/lib/ui';
import { groupTasks, scheduleLabel } from '../../core/maintenance.ts';
import type { HouseProfile, MaintenanceEvent, MaintenanceTask } from '@/lib/types';

const PROFILE_LABELS: [keyof HouseProfile, string][] = [
  ['has_garden', 'Garden'],
  ['has_wood_stove', 'Wood stove / chimney'],
  ['has_heat_pump', 'Heat pump'],
  ['has_balanced_ventilation', 'Balanced ventilation (heat recovery)'],
  ['has_basement', 'Basement'],
  ['has_wooden_facade', 'Wooden facade'],
  ['has_septic', 'Private septic tank'],
  ['has_well', 'Private well'],
];

const today = () => new Date().toISOString().slice(0, 10);

export default function House() {
  const t = useTheme();
  const { household } = useSession();
  const [tasks, setTasks] = useState<MaintenanceTask[] | null>(null);
  const [profile, setProfile] = useState<HouseProfile>({
    has_garden: true, has_wood_stove: false, has_heat_pump: false, has_balanced_ventilation: false,
    has_septic: false, has_well: false, has_basement: false, has_wooden_facade: false,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<MaintenanceEvent[]>([]);
  const [showLater, setShowLater] = useState(false);

  const load = useCallback(async () => {
    if (household) setTasks(await listTasks(household.id).catch(() => []));
  }, [household]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupTasks(tasks ?? [], today()), [tasks]);

  async function open(task: MaintenanceTask) {
    setOpenId(task.id === openId ? null : task.id);
    setCost('');
    setNote('');
    setHistory(await listTaskEvents(task.id).catch(() => []));
  }

  async function done(task: MaintenanceTask) {
    const c = cost.trim() ? Number(cost.replace(',', '.')) : null;
    if (c !== null && Number.isNaN(c)) return Alert.alert('Cost must be a number');
    await completeTask(task.id, { cost: c, note });
    setOpenId(null);
    await load();
  }

  if (tasks === null) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;

  if (tasks.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={{ color: t.fg, fontSize: 22, fontWeight: '700' }}>Set up your house</Text>
          <Muted>
            Pick what applies and I will add a starter maintenance calendar for a Norwegian house. It is a starting point
            you can edit, not professional advice. Check your kommune's rules for things like chimney sweeping and septic tanks.
          </Muted>
          <Card>
            {PROFILE_LABELS.map(([key, label]) => (
              <View key={key} style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={{ color: t.fg }}>{label}</Text>
                <Switch value={profile[key]} onValueChange={(v) => setProfile((p) => ({ ...p, [key]: v }))} />
              </View>
            ))}
          </Card>
          <Btn
            primary
            label="Create my maintenance calendar"
            onPress={async () => {
              if (!household) return;
              try {
                await seedHouseTemplate(household.id, profile);
                await load();
              } catch (e) {
                Alert.alert('Error', e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const section = (title: string, list: MaintenanceTask[]) =>
    list.length === 0 ? null : (
      <View style={{ gap: 8 }}>
        <Text style={{ color: t.fg, fontSize: 18, fontWeight: '700' }}>{title}</Text>
        {list.map((task) => (
          <Card key={task.id}>
            <Text style={{ color: t.fg, fontSize: 16, fontWeight: '600' }}>{task.title}</Text>
            <Muted>
              {scheduleLabel(task)}
              {task.last_done_at ? ` · last done ${task.last_done_at}` : ' · not done yet'}
            </Muted>
            <View style={styles.row}>
              <Btn label={openId === task.id ? 'Close' : 'Details / Done'} onPress={() => open(task)} />
            </View>
            {openId === task.id && (
              <View style={{ gap: 8 }}>
                {task.notes ? <Text style={{ color: t.fg }}>{task.notes}</Text> : null}
                <Field placeholder="Cost in NOK (optional)" keyboardType="decimal-pad" value={cost} onChangeText={setCost} />
                <Field placeholder="Note (optional)" value={note} onChangeText={setNote} />
                <Btn primary label="Mark as done" onPress={() => done(task)} />
                <Btn label="Remove from my calendar" danger onPress={() => retireTask(task.id).then(load)} />
                {history.length > 0 && <Text style={{ color: t.muted, marginTop: 4 }}>History</Text>}
                {history.map((h) => (
                  <Muted key={h.id}>{h.done_at}{h.cost_nok != null ? ` · ${h.cost_nok} kr` : ''}{h.note ? ` · ${h.note}` : ''}</Muted>
                ))}
              </View>
            )}
          </Card>
        ))}
      </View>
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.screen}>
        {groups.due.length === 0 && groups.soon.length === 0 && <Muted>Nothing due. Enjoy the quiet.</Muted>}
        {section('Due now', groups.due)}
        {section('Coming up', groups.soon)}
        {groups.later.length > 0 && (
          <Btn label={showLater ? 'Hide later' : `Later (${groups.later.length})`} onPress={() => setShowLater(!showLater)} />
        )}
        {showLater && section('Later', groups.later)}
      </ScrollView>
    </SafeAreaView>
  );
}
