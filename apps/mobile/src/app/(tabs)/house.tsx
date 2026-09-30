import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completeTask, listTaskEvents, listTasks, retireTask, seedHouseTemplate } from '@/lib/api';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { BAR_SPACE, Btn, Card, Check, Field, Muted, SectionLabel, Title, styles } from '@/lib/ui';
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

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const today = () => new Date().toISOString().slice(0, 10);

function Ribbon({ task }: { task: MaintenanceTask }) {
  const t = useTheme();
  if (task.schedule !== 'seasonal' || !task.window_start_month || !task.window_end_month) return null;
  const s = task.window_start_month;
  const e = task.window_end_month;
  const now = new Date().getMonth() + 1;
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {MONTHS.map((m, idx) => {
        const i = idx + 1;
        const inWin = s <= e ? i >= s && i <= e : i >= s || i <= e;
        return (
          <View key={idx} style={{ flex: 1, height: 26, borderRadius: 13, backgroundColor: inWin ? t.accent : t.dark ? '#262C36' : '#ECEEF2', alignItems: 'center', justifyContent: 'center', borderWidth: i === now ? 2 : 0, borderColor: t.ink }}>
            <Text style={{ fontSize: 11, color: inWin ? '#FFFFFF' : t.muted, fontFamily: font.semi }}>{m}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function House() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
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
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (household) setTasks(await listTasks(household.id).catch(() => []));
  }, [household]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupTasks(tasks ?? [], today()), [tasks]);
  const pad = { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE - 60 };

  async function toggle(task: MaintenanceTask) {
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

  if (tasks === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  if (tasks.length === 0) {
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[styles.screen, pad]}>
        <Title>House</Title>
        <Muted>
          Pick what applies and a starter maintenance calendar for a Norwegian house is added. It is a starting point you
          can edit, not professional advice. Check your kommune's rules for chimney sweeping and septic tanks.
        </Muted>
        <Card>
          {PROFILE_LABELS.map(([key, label]) => (
            <View key={key} style={[styles.row, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
              <Text style={{ color: t.ink, fontSize: 16, fontFamily: font.body, flex: 1 }}>{label}</Text>
              <Switch value={profile[key]} onValueChange={(v) => setProfile((p) => ({ ...p, [key]: v }))} trackColor={{ true: t.accent }} />
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
    );
  }

  const section = (title: string, list: MaintenanceTask[]) =>
    list.length === 0 ? null : (
      <View style={{ gap: 10 }}>
        <SectionLabel>{title}</SectionLabel>
        {list.map((task) => (
          <Card key={task.id} gap={12}>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
              <Check onPress={() => toggle(task)} />
              <Pressable style={{ flex: 1, gap: 2 }} onPress={() => toggle(task)}>
                <Text style={{ color: t.ink, fontSize: 18, lineHeight: 24, fontFamily: font.semi }}>{task.title}</Text>
                <Muted>{scheduleLabel(task)}{task.last_done_at ? ` · last done ${task.last_done_at}` : ' · not done yet'}</Muted>
              </Pressable>
            </View>
            <Ribbon task={task} />
            {openId === task.id && (
              <View style={{ gap: 10 }}>
                {task.notes ? <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21, fontFamily: font.body }}>{task.notes}</Text> : null}
                <Field placeholder="Cost in NOK (optional)" keyboardType="decimal-pad" value={cost} onChangeText={setCost} />
                <Field placeholder="Note (optional)" value={note} onChangeText={setNote} />
                <Btn primary label="Mark as done" onPress={() => done(task)} />
                <Btn danger label="Remove from my calendar" onPress={() => retireTask(task.id).then(load)} />
                {history.length > 0 && <SectionLabel>History</SectionLabel>}
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
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[styles.screen, pad]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Title>House</Title>
      {groups.due.length === 0 && groups.soon.length === 0 && <Muted>Nothing due. Enjoy the quiet.</Muted>}
      {section('Due now', groups.due)}
      {section('Coming up', groups.soon)}
      {groups.later.length > 0 && <Btn label={showLater ? 'Hide later' : `Later (${groups.later.length})`} onPress={() => setShowLater(!showLater)} />}
      {showLater && section('Later', groups.later)}
    </ScrollView>
  );
}
