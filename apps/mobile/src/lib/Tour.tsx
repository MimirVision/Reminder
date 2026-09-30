import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { addPlace } from './api';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { uuid } from './id';
import { capture } from './outbox';
import { enableReminders } from './reminders';
import { readJson, writeJson } from './store';
import { font, useTheme } from './theme';
import { Btn, Field, Muted, styles } from './ui';
import { CATEGORIES, categoryName } from '../shared/lib/labels';

export const tourSeen = (householdId: string) => readJson<boolean>(`hm.tourDone.${householdId}`, false);

// Three quick steps for the first visit: one real to-do, the shops you use, and place reminders.
export function Tour({ householdId, onClose, onChanged }: { householdId: string; onClose: () => void; onChanged: () => void }) {
  const th = useTheme();
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [text, setText] = useState('');
  const [added, setAdded] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const finish = () => { writeJson(`hm.tourDone.${householdId}`, true); onClose(); };

  async function next() {
    setBusy(true); setErr(null);
    try {
      if (step === 1 && text.trim() && !added) {
        await capture({ id: uuid(), household_id: householdId, body: text.trim(), place_id: null, capture_lat: null, capture_lon: null, photoUris: [] });
        setAdded(true); onChanged();
      }
      if (step === 2 && picked.length) {
        for (const c of picked) await addPlace({ household_id: householdId, name: categoryName(c, t), kind: 'category', category: c, lat: null, lon: null, radius_m: 150 });
        setPicked([]); onChanged();
      }
      if (step === 3) return finish();
      setStep(step + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={finish}>
      <ScrollView style={{ backgroundColor: th.bg }} contentContainerStyle={[styles.screen, { paddingTop: 28 }]} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: th.ink, fontSize: 26, fontFamily: font.display, flex: 1 }}>{t('tour.title')}</Text>
          <Btn small label={t('tour.skip')} onPress={finish} />
        </View>
        <Muted>{t('tour.step', { n: step })}</Muted>
        <View style={{ flexDirection: 'row', gap: 6 }}>{[1, 2, 3].map((n) => <View key={n} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: n <= step ? th.accent : th.line }} />)}</View>
        <Text style={{ color: th.ink, fontSize: 20, fontFamily: font.display }}>{t(step === 3 ? 'tour.m3.title' : (`tour.${step}.title` as 'tour.1.title'))}</Text>
        <Muted>{t(step === 3 ? 'tour.m3.body' : (`tour.${step}.body` as 'tour.1.body'))}</Muted>
        {step === 1 && (added ? <Muted>{t('tour.added')}: {text}</Muted> : <Field autoFocus placeholder={t('tour.1.ph')} value={text} onChangeText={setText} onSubmitEditing={next} />)}
        {step === 2 && <View style={styles.row}>{CATEGORIES.map((c) => <Chip key={c} label={categoryName(c, t).replace(/ \(.*\)$/, '')} on={picked.includes(c)} onPress={() => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} />)}</View>}
        {step === 3 && <Btn label={t('tour.reminders')} onPress={() => void enableReminders().catch(() => false)} />}
        {err && <Text style={{ color: th.danger }}>{err}</Text>}
        <Btn primary label={step === 3 ? t('tour.finish') : t('tour.next')} onPress={next} disabled={busy} />
      </ScrollView>
    </Modal>
  );
}
