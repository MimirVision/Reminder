import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completeTask, listTaskEvents, listTasks, retireTask, seedHouseTemplate } from '@/lib/api';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { AddTaskForm } from '@/lib/AddTaskForm';
import { FactsView } from '@/lib/FactsView';
import { MovingView } from '@/lib/MovingView';
import { BAR_SPACE, Btn, Card, Check, Field, Muted, SectionLabel, Title, styles } from '@/lib/ui';
import { groupTasks } from '../../core/maintenance.ts';
import { scheduleLabel, taskNotes, taskTitle } from '../../shared/lib/labels';
import { useI18n } from '@/lib/i18n';
import { useToast } from '@/lib/Toast';
import type { HouseProfile, MaintenanceEvent, MaintenanceTask } from '@/lib/types';

const PROFILE: (keyof HouseProfile)[] = ['has_garden', 'has_wood_stove', 'has_heat_pump', 'has_balanced_ventilation', 'has_basement', 'has_wooden_facade', 'has_septic', 'has_well'];
const today = () => new Date().toISOString().slice(0, 10);

function Ribbon({ task }: { task: MaintenanceTask }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  if (task.schedule !== 'seasonal' || !task.window_start_month || !task.window_end_month) return null;
  const s = task.window_start_month;
  const e = task.window_end_month;
  const now = new Date().getMonth() + 1;
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {tr('ribbon.months').split('').map((m, idx) => {
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
  const { t: tr, lang } = useI18n();
  const toast = useToast();
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
  const [mode, setMode] = useState<'calendar' | 'facts' | 'moving'>('calendar');
  const [addingTask, setAddingTask] = useState(false);

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
    if (c !== null && Number.isNaN(c)) return Alert.alert(tr('house.costNumber'));
    await completeTask(task.id, { cost: c, note });
    toast({ text: tr('toast.done') });
    setOpenId(null);
    await load();
  }

  if (tasks === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const toggle2 = (
    <View style={styles.row}>
      {(['calendar', 'facts', 'moving'] as const).map((m) => <Btn key={m} small label={tr(`house.${m}` as 'house.calendar')} primary={mode === m} onPress={() => setMode(m)} />)}
    </View>
  );

  if (mode === 'moving') {
    return (
      <ScrollView automaticallyAdjustKeyboardInsets style={{ backgroundColor: t.bg }} contentContainerStyle={[styles.screen, pad]} keyboardShouldPersistTaps="handled">
        <Title>{tr('house.title')}</Title>
        {toggle2}
        <MovingView />
      </ScrollView>
    );
  }

  if (mode === 'facts') {
    return (
      <ScrollView automaticallyAdjustKeyboardInsets style={{ backgroundColor: t.bg }} contentContainerStyle={[styles.screen, pad]} keyboardShouldPersistTaps="handled">
        <Title>{tr('house.title')}</Title>
        {toggle2}
        <FactsView />
      </ScrollView>
    );
  }

  if (tasks.length === 0) {
    return (
      <ScrollView automaticallyAdjustKeyboardInsets style={{ backgroundColor: t.bg }} contentContainerStyle={[styles.screen, pad]}>
        <Title>{tr('house.title')}</Title>
        {toggle2}
        <Muted>{tr('house.intro')}</Muted>
        <Card>
          {PROFILE.map((key) => (
            <View key={key} style={[styles.row, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
              <Text style={{ color: t.ink, fontSize: 16, fontFamily: font.body, flex: 1 }}>{tr(`prof.${key}` as 'prof.has_garden')}</Text>
              <Switch value={profile[key]} onValueChange={(v) => setProfile((p) => ({ ...p, [key]: v }))} trackColor={{ true: t.accent }} />
            </View>
          ))}
        </Card>
        <Btn
          primary
          label={tr('house.create')}
          onPress={async () => {
            if (!household) return;
            try {
              await seedHouseTemplate(household.id, profile);
              await load();
            } catch (e) {
              Alert.alert(tr('common.error'), e instanceof Error ? e.message : String(e));
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
                <Text style={{ color: t.ink, fontSize: 18, lineHeight: 24, fontFamily: font.semi }}>{taskTitle(task, lang)}</Text>
                <Muted>{scheduleLabel(task, tr)} · {task.last_done_at ? tr('house.lastDone', { date: task.last_done_at }) : tr('house.notDone')}</Muted>
              </Pressable>
            </View>
            <Ribbon task={task} />
            {openId === task.id && (
              <View style={{ gap: 10 }}>
                {taskNotes(task, lang) ? <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21, fontFamily: font.body }}>{taskNotes(task, lang)}</Text> : null}
                <Field placeholder={tr('house.cost')} keyboardType="decimal-pad" value={cost} onChangeText={setCost} />
                <Field placeholder={tr('house.note')} value={note} onChangeText={setNote} />
                <Btn primary label={tr('house.markDone')} onPress={() => done(task)} />
                <Btn danger label={tr('house.remove')} onPress={() => retireTask(task.id).then(load)} />
                {history.length > 0 && <SectionLabel>{tr('house.history')}</SectionLabel>}
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
    <ScrollView automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[styles.screen, pad]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Title>{tr('house.title')}</Title>
      {toggle2}
      {addingTask ? <AddTaskForm onDone={() => { setAddingTask(false); void load(); }} /> : <Btn label={tr('house.addOwn')} onPress={() => setAddingTask(true)} />}
      {groups.due.length === 0 && groups.soon.length === 0 && <Muted>{tr('house.nothingDue')}</Muted>}
      {section(tr('house.due'), groups.due)}
      {section(tr('house.soon'), groups.soon)}
      {groups.later.length > 0 && <Btn label={showLater ? tr('house.hideLater') : tr('house.laterN', { n: groups.later.length })} onPress={() => setShowLater(!showLater)} />}
      {showLater && section(tr('house.later'), groups.later)}
    </ScrollView>
  );
}
