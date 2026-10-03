import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { getMemory, listMembers, listPlaces, parseTasksAI, resolveWhere, softDelete, statusFor, updateMemory, updateMemoryFields, type Where } from '@/lib/api';
import { Chip } from '@/lib/Chip';
import { TodoDetails } from '@/lib/TodoDetails';
import { uuid } from '@/lib/id';
import { useI18n } from '@/lib/i18n';
import { capture } from '@/lib/outbox';
import { ensureNotifyPermission } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { useToast } from '@/lib/Toast';
import { Btn, Card, Field, Icon, Muted, SectionLabel, styles } from '@/lib/ui';
import { WherePicker } from '@/lib/WherePicker';
import { WhenPicker, type Due } from '@/lib/WhenPicker';
import { categoryName, placeLabel } from '../shared/lib/labels';
import { findExistingPlace } from '../shared/lib/placeSearch';
import { isInteresting, parseTasks, type ParsedTask } from '../shared/lib/quickAdd';
import { changedFields, detailsOf, newFields, type Details } from '../shared/lib/details';
import { dueLabel } from '../shared/lib/when';
import type { Member, Memory, Place } from '@/lib/types';

// Add a to-do, or edit one (?id=...): text, where (search a shop, a kind of shop or an address), when (date, time, repeat), who it is for and photos.
// Free text is understood on the phone ("buy milk, eggs at kiwi tomorrow before 18"); "Sort with AI" handles harder text.
export default function Add() {
  const th = useTheme();
  const router = useRouter();
  const { t, tn, lang, locale } = useI18n();
  const toast = useToast();
  const { household, session } = useSession();
  const userId = session?.user.id ?? '';
  const params = useLocalSearchParams<{ placeId?: string; id?: string; text?: string; date?: string }>();
  const editId = params.id;
  const [memory, setMemory] = useState<Memory | null>(null);
  const [body, setBody] = useState(params.text ?? '');
  const [where, setWhere] = useState<Where>(params.placeId ? { kind: 'place', placeId: params.placeId } : { kind: 'none' });
  const [due, setDue] = useState<Due>({ due_on: params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null, due_time: null, repeat_rule: null });
  const [places, setPlaces] = useState<Place[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [forId, setForId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [details, setDetails] = useState<Details>(() => detailsOf(null));
  const [showMore, setShowMore] = useState(false);
  const [uris, setUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [smart, setSmart] = useState(true);
  const [ai, setAi] = useState<{ text: string; tasks: ParsedTask[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [dropped, setDropped] = useState<number[]>([]);
  const partner = members.find((m) => m.user_id !== userId) ?? null;

  useEffect(() => {
    if (!household) return;
    listPlaces(household.id).then(setPlaces).catch(() => {});
    listMembers(household.id).then(setMembers).catch(() => {});
  }, [household]);

  useEffect(() => {
    if (!editId) return;
    getMemory(editId).then((m) => {
      if (!m) return;
      setMemory(m);
      setBody(m.body);
      setWhere(m.place_id ? { kind: 'place', placeId: m.place_id } : { kind: 'none' });
      setDue({ due_on: m.due_on ?? null, due_time: m.due_time ?? null, repeat_rule: m.repeat_rule ?? null });
      setForId(m.assignee_id ?? null);
      setPinned(!!m.pinned);
      setDetails(detailsOf(m));
      setShowMore(!!m.notes || (m.checklist?.length ?? 0) > 0 || !!m.priority || m.remind_before != null || (m.tags?.length ?? 0) > 0);
    }).catch(() => setErr(t('offline.needsNet')));
  }, [editId, t]);

  // What the text means (new to-dos only). The AI's answer replaces the on-phone reader until the text changes.
  const plan = useMemo<ParsedTask[] | null>(() => {
    if (editId || !smart || !body.trim()) return null;
    const tasks = ai && ai.text === body ? ai.tasks : parseTasks(body, { places, partnerName: partner?.display_name });
    return isInteresting(tasks) ? tasks : null;
  }, [editId, smart, body, ai, places, partner?.display_name]);
  useEffect(() => { setDropped([]); setAiNote(null); }, [body]);
  const kept = plan ? plan.filter((_, i) => !dropped.includes(i)) : null;

  async function sortWithAI() {
    if (!household) return;
    setAiBusy(true);
    setAiNote(null);
    const r = await parseTasksAI(household.id, body, lang, partner?.display_name ?? null).catch(() => ({ tasks: null, error: 'failed' as const }));
    setAiBusy(false);
    if (r.tasks && r.tasks.length > 0) { setAi({ text: body, tasks: r.tasks }); setDropped([]); return; }
    setAiNote(t(r.error === 'unavailable' ? 'smart.unavailable' : r.error === 'limit' ? 'smart.limit' : 'smart.failed'));
  }

  const idFor = (who: ParsedTask['assignee']): string | null => (who === 'me' ? userId || null : who === 'partner' ? partner?.user_id ?? null : null);
  const placeText = (task: ParsedTask) => {
    const p = task.placeId ? places.find((x) => x.id === task.placeId) : null;
    return p ? placeLabel(p, t) : task.category ? categoryName(task.category, t) : '';
  };

  async function pick(camera: boolean) {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true });
    if (!res.canceled) setUris((u) => [...u, ...res.assets.map((a) => a.uri)]);
  }

  async function lastKnown() {
    try {
      if ((await Location.getForegroundPermissionsAsync()).granted) {
        const pos = await Location.getLastKnownPositionAsync();
        return { lat: pos?.coords.latitude ?? null, lon: pos?.coords.longitude ?? null };
      }
    } catch { /* the location stamp is optional */ }
    return { lat: null, lon: null };
  }

  async function save() {
    if (!household) return;
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!editId && !(kept && kept.length > 0) && lines.length === 0 && uris.length === 0) { setErr(t('sheet.needText')); return; }
    setSaving(true);
    setErr(null);
    try {
      if (editId) {
        const placeId = await resolveWhere(household.id, where, places, findExistingPlace);
        if (due.due_on) void ensureNotifyPermission();
        const extra = { ...(members.length > 1 && forId !== (memory?.assignee_id ?? null) ? { assignee_id: forId } : {}), ...(pinned !== !!memory?.pinned ? { pinned } : {}), ...changedFields(details, detailsOf(memory), !!due.due_on) };
        await updateMemoryFields(editId, { body: body.trim(), place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule, ...extra });
        toast({ text: t('toast.saved') });
        router.back();
        return;
      }
      const { lat, lon } = await lastKnown();
      if (kept && kept.length > 0) {
        // Each understood to-do gets its own place, day, time and person; what is chosen in the form fills the gaps.
        const made = new Map<string, string | null>(); // a kind of shop created once for several to-dos
        let sheetPlace: string | null | undefined;
        let anyDate = !!due.due_on;
        for (const [i, task] of kept.entries()) {
          let placeId = task.placeId;
          if (!placeId && task.category) {
            if (!made.has(task.category)) made.set(task.category, await resolveWhere(household.id, { kind: 'category', category: task.category, name: categoryName(task.category, t) }, places, findExistingPlace));
            placeId = made.get(task.category) ?? null;
          }
          if (!placeId) {
            if (sheetPlace === undefined) sheetPlace = await resolveWhere(household.id, where, places, findExistingPlace);
            placeId = sheetPlace;
          }
          const dated = !!task.due_on;
          if (dated) anyDate = true;
          const assignee = task.assignee ? idFor(task.assignee) : forId;
          await capture({
            id: uuid(), household_id: household.id, body: task.title, place_id: placeId,
            due_on: dated ? task.due_on : due.due_on, due_time: dated ? task.due_time : due.due_time, repeat_rule: dated ? task.repeat_rule : due.repeat_rule,
            ...(assignee ? { assignee_id: assignee } : {}), ...(pinned ? { pinned } : {}),
            // Notes and a checklist belong to one to-do; priority and the reminder go to each.
            ...newFields({ ...(kept.length === 1 ? details : { ...details, notes: '', checklist: [] }), priority: task.priority || details.priority, tags: [...new Set([...details.tags, ...task.tags])] }, dated || !!due.due_on),
            capture_lat: lat, capture_lon: lon, photoUris: i === 0 ? uris : [],
          });
        }
        if (anyDate) void ensureNotifyPermission();
        toast({ text: tn('toast.added', kept.length) });
        router.back();
        return;
      }
      const placeId = await resolveWhere(household.id, where, places, findExistingPlace);
      if (due.due_on) void ensureNotifyPermission();
      // One to-do per line, so a pasted list becomes several.
      const bodies = lines.length > 0 ? lines : [''];
      for (const [i, b] of bodies.entries()) {
        await capture({
          id: uuid(), household_id: household.id, body: b, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule,
          ...(forId ? { assignee_id: forId } : {}), ...(pinned ? { pinned } : {}),
          ...newFields(bodies.length === 1 ? details : { ...details, notes: '', checklist: [] }, !!due.due_on),
          capture_lat: lat, capture_lon: lon, photoUris: i === 0 ? uris : [],
        });
      }
      toast({ text: tn('toast.added', bodies.length) });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(/fetch|network/i.test(msg) ? t('offline.needsNet') : msg);
      setSaving(false);
    }
  }

  async function remove() {
    if (!memory) return;
    try {
      await softDelete(memory.id);
      toast({ text: t('toast.deleted'), undo: () => void updateMemory(memory.id, { status: statusFor(memory) }).catch(() => {}) });
      router.back();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const aiShown = !!ai && ai.text === body;
  const label = saving ? t('sheet.saving') : editId ? t('sheet.save') : kept && kept.length > 0 ? tn('sheet.addN', kept.length) : t('sheet.add');

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.screen, { paddingTop: 24, paddingBottom: 60 }]} keyboardShouldPersistTaps="handled" style={{ backgroundColor: th.bg }}>
      <Text style={{ color: th.ink, fontSize: 28, fontFamily: font.display }}>{editId ? t('sheet.edit') : t('sheet.new')}</Text>
      <Field placeholder={t('sheet.placeholder')} multiline autoFocus={!editId} value={body} onChangeText={setBody} />

      {plan && kept && (
        <Card gap={10}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: th.muted, fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: font.semi }}>{aiShown ? t('smart.aiDone') : t('smart.title')}</Text>
            {!aiShown && <Btn small label={aiBusy ? t('smart.aiBusy') : t('smart.ai')} onPress={() => void sortWithAI()} disabled={aiBusy} />}
          </View>
          {plan.map((task, i) => dropped.includes(i) ? null : (
            <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{task.title}</Text>
                <View style={styles.row}>
                  {(task.due_on || task.due_time) ? <Muted>{task.due_on ? dueLabel({ due_on: task.due_on, due_time: task.due_time }, t, locale) : task.due_time}</Muted> : null}
                  {task.repeat_rule ? <Muted>{t(`repeat.short.${task.repeat_rule}` as 'repeat.short.daily')}</Muted> : null}
                  {(task.placeId || task.category) ? <Muted>{task.leaving ? t('smart.leaving', { place: placeText(task) }) : placeText(task)}</Muted> : null}
                  {task.priority > 0 ? <Muted>{t(`prio.short.${task.priority}` as 'prio.short.1')}</Muted> : null}
                  {task.assignee && task.assignee !== 'both' ? <Muted>{t('row.for', { name: task.assignee === 'me' ? t('assign.me') : partner?.display_name || t('common.partner') })}</Muted> : null}
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t('smart.remove', { title: task.title })} hitSlop={10} onPress={() => setDropped((d) => [...d, i])}>
                <Icon name="xmark" size={16} color={th.muted} />
              </Pressable>
            </View>
          ))}
          {plan.some((x, i) => x.leaving && !dropped.includes(i)) && <Muted>{t('smart.leaveNote')}</Muted>}
          {aiNote ? <Muted>{aiNote}</Muted> : null}
          <Pressable accessibilityRole="button" onPress={() => setSmart(false)}><Text style={{ color: th.accentText, fontFamily: font.semi, fontSize: 14 }}>{t('smart.plain')}</Text></Pressable>
        </Card>
      )}
      {!editId && !smart && <Pressable accessibilityRole="button" onPress={() => setSmart(true)}><Text style={{ color: th.accentText, fontFamily: font.semi, fontSize: 14 }}>{t('smart.smart')}</Text></Pressable>}

      <SectionLabel>{t('sheet.where')}</SectionLabel>
      <WherePicker places={places} value={where} onChange={setWhere} />
      <SectionLabel>{t('sheet.when')}</SectionLabel>
      <WhenPicker value={due} onChange={setDue} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showMore }} onPress={() => setShowMore(!showMore)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="list.bullet" size={15} color={th.accentText} />
        <Text style={{ color: th.accentText, fontFamily: font.semi, fontSize: 14 }}>{showMore ? t('todo.detailLess') : `${t('todo.detail')}: ${t('prio.label').toLowerCase()}, ${t('check.label').toLowerCase()}, ${t('notes.label').toLowerCase()}`}</Text>
      </Pressable>
      {showMore && <TodoDetails value={details} onChange={setDetails} hasDate={!!due.due_on} />}
      {members.length > 1 && partner && (
        <>
          <SectionLabel>{t('assign.label')}</SectionLabel>
          <View style={styles.row}>
            <Chip label={t('assign.anyone')} on={forId === null} onPress={() => setForId(null)} />
            <Chip label={t('assign.me')} on={forId === userId} onPress={() => setForId(userId)} />
            <Chip label={partner.display_name || t('common.partner')} on={forId === partner.user_id} onPress={() => setForId(partner.user_id)} />
          </View>
        </>
      )}
      <View style={styles.row}>
        <Chip icon="pin" label={pinned ? t('pin.on') : t('pin.label')} on={pinned} onPress={() => setPinned(!pinned)} />
      </View>
      {!editId && (
        <View style={styles.row}>
          <Btn small label={t('photo.take')} onPress={() => pick(true)} />
          <Btn small label={t('photo.choose')} onPress={() => pick(false)} />
          {uris.length > 0 && <Muted>{tn('sheet.photos', uris.length)}</Muted>}
        </View>
      )}
      <Muted>{t('sheet.hint')}</Muted>
      {err && <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text>}
      <Btn primary label={label} onPress={save} disabled={saving} />
      {editId && <Btn danger label={t('sheet.delete')} onPress={remove} />}
      <Btn label={t('common.cancel')} onPress={() => router.back()} />
    </ScrollView>
  );
}
