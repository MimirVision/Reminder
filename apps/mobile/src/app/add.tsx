import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { getMemory, listPlaces, resolveWhere, softDelete, statusFor, updateMemory, updateMemoryFields, type Where } from '@/lib/api';
import { uuid } from '@/lib/id';
import { useI18n } from '@/lib/i18n';
import { capture } from '@/lib/outbox';
import { ensureNotifyPermission } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { useToast } from '@/lib/Toast';
import { Btn, Field, Muted, SectionLabel, styles } from '@/lib/ui';
import { WherePicker } from '@/lib/WherePicker';
import { WhenPicker, type Due } from '@/lib/WhenPicker';
import { findExistingPlace } from '../shared/lib/placeSearch';
import type { Memory, Place } from '@/lib/types';

// Add a to-do, or edit one (?id=...): text, where (search a shop, a kind of shop or an address), when (date, time, repeat) and photos.
export default function Add() {
  const th = useTheme();
  const router = useRouter();
  const { t, tn } = useI18n();
  const toast = useToast();
  const { household } = useSession();
  const params = useLocalSearchParams<{ placeId?: string; id?: string; text?: string }>();
  const editId = params.id;
  const [memory, setMemory] = useState<Memory | null>(null);
  const [body, setBody] = useState(params.text ?? '');
  const [where, setWhere] = useState<Where>(params.placeId ? { kind: 'place', placeId: params.placeId } : { kind: 'none' });
  const [due, setDue] = useState<Due>({ due_on: null, due_time: null, repeat_rule: null });
  const [places, setPlaces] = useState<Place[]>([]);
  const [uris, setUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (household) listPlaces(household.id).then(setPlaces).catch(() => {});
  }, [household]);

  useEffect(() => {
    if (!editId) return;
    getMemory(editId).then((m) => {
      if (!m) return;
      setMemory(m);
      setBody(m.body);
      setWhere(m.place_id ? { kind: 'place', placeId: m.place_id } : { kind: 'none' });
      setDue({ due_on: m.due_on ?? null, due_time: m.due_time ?? null, repeat_rule: m.repeat_rule ?? null });
    }).catch(() => setErr(t('offline.needsNet')));
  }, [editId, t]);

  async function pick(camera: boolean) {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true });
    if (!res.canceled) setUris((u) => [...u, ...res.assets.map((a) => a.uri)]);
  }

  async function save() {
    if (!household) return;
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!editId && lines.length === 0 && uris.length === 0) { setErr(t('sheet.needText')); return; }
    setSaving(true);
    setErr(null);
    try {
      const placeId = await resolveWhere(household.id, where, places, findExistingPlace);
      if (due.due_on) void ensureNotifyPermission();
      if (editId) {
        await updateMemoryFields(editId, { body: body.trim(), place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule });
        toast({ text: t('toast.saved') });
        router.back();
        return;
      }
      let lat: number | null = null;
      let lon: number | null = null;
      try {
        if ((await Location.getForegroundPermissionsAsync()).granted) {
          const pos = await Location.getLastKnownPositionAsync();
          lat = pos?.coords.latitude ?? null;
          lon = pos?.coords.longitude ?? null;
        }
      } catch { /* the location stamp is optional */ }
      // One to-do per line, so a pasted list becomes several.
      const bodies = lines.length > 0 ? lines : [''];
      for (const [i, b] of bodies.entries()) {
        await capture({
          id: uuid(), household_id: household.id, body: b, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule,
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

  return (
    <ScrollView contentContainerStyle={[styles.screen, { paddingTop: 24, paddingBottom: 60 }]} keyboardShouldPersistTaps="handled" style={{ backgroundColor: th.bg }}>
      <Text style={{ color: th.ink, fontSize: 28, fontFamily: font.display }}>{editId ? t('sheet.edit') : t('sheet.new')}</Text>
      <Field placeholder={t('sheet.placeholder')} multiline autoFocus={!editId} value={body} onChangeText={setBody} />
      <SectionLabel>{t('sheet.where')}</SectionLabel>
      <WherePicker places={places} value={where} onChange={setWhere} />
      <SectionLabel>{t('sheet.when')}</SectionLabel>
      <WhenPicker value={due} onChange={setDue} />
      {!editId && (
        <View style={styles.row}>
          <Btn small label={t('photo.take')} onPress={() => pick(true)} />
          <Btn small label={t('photo.choose')} onPress={() => pick(false)} />
          {uris.length > 0 && <Muted>{tn('sheet.photos', uris.length)}</Muted>}
        </View>
      )}
      <Muted>{t('sheet.hint')}</Muted>
      {err && <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text>}
      <Btn primary label={saving ? t('sheet.saving') : editId ? t('sheet.save') : t('sheet.add')} onPress={save} disabled={saving} />
      {editId && <Btn danger label={t('sheet.delete')} onPress={remove} />}
      <Btn label={t('common.cancel')} onPress={() => router.back()} />
    </ScrollView>
  );
}
