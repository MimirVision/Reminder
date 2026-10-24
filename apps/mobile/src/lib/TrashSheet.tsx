import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMemories, restoreMemoryRow } from './api';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import type { Memory } from './types';
import { Btn, Muted } from './ui';
import { daysSince, newestFirst } from '../shared/lib/trash';

// Recently deleted: to-dos deleted in the last 30 days, each with a Restore button.
export function TrashSheet({ visible, householdId, onClose, onRestored }: { visible: boolean; householdId: string; onClose: () => void; onRestored: () => void }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { t, tn } = useI18n();
  const [items, setItems] = useState<Memory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setItems(null);
    listMemories(householdId, ['dismissed']).then((l) => setItems(newestFirst(l))).catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setItems([]); });
  }, [visible, householdId]);

  const restore = async (m: Memory) => {
    setItems((cur) => (cur ?? []).filter((x) => x.id !== m.id));
    try { await restoreMemoryRow(m.id, m); onRestored(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontFamily: font.display, fontSize: 26 }}>{t('trash.title')}</Text>
            <Btn small label={t('common.close')} onPress={onClose} />
          </View>
          <Muted>{t('trash.keep')}</Muted>
          {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}
          {items === null && <Muted>{t('common.loading')}</Muted>}
          {items?.length === 0 && !err && <Muted>{t('trash.empty')}</Muted>}
          {(items ?? []).map((m) => {
            const d = daysSince(m.updated_at);
            return (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: th.card, borderRadius: 16, padding: 14 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={2} style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{(m.body || t('todo.photo')).split('\n')[0]}</Text>
                  <Muted>{d === 0 ? t('trash.today') : tn('trash.ago', d)}</Muted>
                </View>
                <Btn small primary label={t('trash.restore')} onPress={() => void restore(m)} />
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
