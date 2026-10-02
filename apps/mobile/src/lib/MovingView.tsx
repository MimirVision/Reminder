import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { listMemories } from './api';
import { Chip } from './Chip';
import { uuid } from './id';
import { useI18n } from './i18n';
import { capture } from './outbox';
import { ensureNotifyPermission } from './reminders';
import { useSession } from './session';
import { font, useTheme } from './theme';
import { Btn, Card, Check, Field, Muted, SectionLabel, styles } from './ui';
import { buildMoveTodos, MOVE_GROUPS, MOVE_ITEMS } from '../shared/lib/moving';
import { todayISO } from '../shared/lib/when';

// Moving mode: tick what applies, give the moving day, and the checklist becomes ordinary to-dos with dates counted from it.
export function MovingView() {
  const th = useTheme();
  const { t, tn, lang } = useI18n();
  const { household } = useSession();
  const [day, setDay] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(MOVE_ITEMS.map((i) => i.key)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));

  const flip = (key: string) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  async function add() {
    if (!household) return;
    if (picked.size === 0) { setErr(t('move.empty')); return; }
    setBusy(true); setErr(null);
    try {
      const have = new Set((await listMemories(household.id, ['inbox', 'active']).catch(() => [])).map((m) => m.body.trim().toLowerCase()));
      const todos = buildMoveTodos([...picked], dayOk ? day : null, lang, todayISO());
      const fresh = todos.filter((x) => !have.has(x.body.trim().toLowerCase()));
      for (const x of fresh) {
        await capture({ id: uuid(), household_id: household.id, body: x.body, place_id: null, due_on: x.due_on, capture_lat: null, capture_lon: null, photoUris: [] });
      }
      if (fresh.some((x) => x.due_on)) void ensureNotifyPermission();
      setResult({ added: fresh.length, skipped: todos.length - fresh.length });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (result) {
    return (
      <Card>
        <Text style={{ color: th.ink, fontSize: 20, fontFamily: font.display }}>{t('move.title')}</Text>
        <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.body }}>{tn('move.added', result.added)}</Text>
        {result.skipped > 0 && <Muted>{t('move.skipped', { n: result.skipped })}</Muted>}
        <Btn label={t('common.done')} onPress={() => setResult(null)} />
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Muted>{t('move.intro')}</Muted>
      <Card>
        <SectionLabel>{t('move.day')}</SectionLabel>
        <Field placeholder="YYYY-MM-DD" value={day} onChangeText={setDay} keyboardType="numbers-and-punctuation" autoCapitalize="none" maxLength={10} />
        {!dayOk && <Muted>{t('move.noDay')}</Muted>}
      </Card>
      <View style={styles.row}>
        <Chip label={t('move.all')} onPress={() => setPicked(new Set(MOVE_ITEMS.map((i) => i.key)))} />
        <Chip label={t('move.none')} onPress={() => setPicked(new Set())} />
      </View>
      {MOVE_GROUPS.map((g) => (
        <View key={g} style={{ gap: 6 }}>
          <SectionLabel>{t(`move.group.${g}` as 'move.group.before')}</SectionLabel>
          <Card gap={4}>
            {MOVE_ITEMS.filter((i) => i.group === g).map((i) => (
              <Pressable key={i.key} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(i.key) }} onPress={() => flip(i.key)}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 8 }}>
                <Check done={picked.has(i.key)} onPress={() => flip(i.key)} />
                <Text style={{ flex: 1, color: th.ink, fontSize: 16, lineHeight: 22, fontFamily: font.body }}>{lang === 'nb' ? i.nb : i.en}</Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
      {err && <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text>}
      <Btn primary disabled={busy || picked.size === 0} label={busy ? t('sheet.saving') : tn('sheet.addN', picked.size)} onPress={() => void add()} />
    </View>
  );
}
