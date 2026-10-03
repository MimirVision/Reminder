import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeCount, noFilter, type Filter } from '../shared/lib/todoFilter';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import { Btn, SectionLabel, styles } from './ui';

// One place for every way to narrow the list: whose, how important, which tag. Changes apply at once.
export function FilterSheet({ visible, value, onChange, partnerName, tags, onClose }: {
  visible: boolean; value: Filter; onChange: (f: Filter) => void; partnerName: string | null; tags: { tag: string; count: number }[]; onClose: () => void;
}) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const set = (p: Partial<Filter>) => onChange({ ...value, ...p });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View style={{ backgroundColor: th.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, maxHeight: '80%' }}>
        <ScrollView contentContainerStyle={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: th.ink, fontFamily: font.display, fontSize: 22 }}>{t('filter.title')}</Text>
          {partnerName != null && (
            <>
              <SectionLabel>{t('filter.who')}</SectionLabel>
              <View style={styles.row}>
                {(['all', 'mine', 'theirs'] as const).map((id) => (
                  <Chip key={id} on={value.who === id} onPress={() => set({ who: id })} label={id === 'all' ? t('filter.all') : id === 'mine' ? t('filter.mine') : t('filter.theirs', { name: partnerName })} />
                ))}
              </View>
            </>
          )}
          <SectionLabel>{t('filter.priority')}</SectionLabel>
          <View style={styles.row}>
            {([0, 1, 2, 3] as const).map((p) => (
              <Chip key={p} on={value.minPriority === p} onPress={() => set({ minPriority: p })} label={p === 0 ? t('filter.priorityAny') : t('filter.priorityMin', { p: t(`prio.${p}` as 'prio.1') })} />
            ))}
          </View>
          {tags.length > 0 && (
            <>
              <SectionLabel>{t('filter.tag')}</SectionLabel>
              <View style={styles.row}>
                <Chip on={value.tag == null} onPress={() => set({ tag: null })} label={t('filter.tagAny')} />
                {tags.map((g) => <Chip key={g.tag} on={value.tag === g.tag} onPress={() => set({ tag: g.tag })} label={`#${g.tag}`} />)}
              </View>
            </>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Btn small label={t('filter.clear')} onPress={() => onChange(noFilter())} disabled={activeCount(value) === 0} />
            <Btn primary label={t('filter.done')} onPress={onClose} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
