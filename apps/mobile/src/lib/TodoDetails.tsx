import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { addMany, removeItem, toggleItem } from '../shared/lib/checklist';
import { addTags, removeTag } from '../shared/lib/tags';
import { REMIND_CHOICES, type Details } from '../shared/lib/details';
import type { Priority } from '../shared/lib/types';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { Select } from './Select';
import { font, useTheme } from './theme';
import { Btn, Check, Field, Icon, SectionLabel, styles } from './ui';

export const PRIO_COLOR: Record<number, string> = { 1: '#3B82F6', 2: '#E08A00', 3: '#D6341F' };

// Priority, "remind me before", a checklist and notes: what makes a to-do more than a line of text.
export function TodoDetails({ value, onChange, hasDate }: { value: Details; onChange: (d: Details) => void; hasDate: boolean }) {
  const th = useTheme();
  const { t } = useI18n();
  const [step, setStep] = useState('');
  const [tag, setTag] = useState('');
  const putTag = () => { if (tag.trim()) { onChange({ ...value, tags: addTags(value.tags, tag) }); setTag(''); } };
  const addStep = () => { if (step.trim()) { onChange({ ...value, checklist: addMany(value.checklist, step) }); setStep(''); } };

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{t('prio.label')}</SectionLabel>
      <View style={styles.row}>
        {([0, 1, 2, 3] as Priority[]).map((p) => (
          <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: value.priority === p }} onPress={() => onChange({ ...value, priority: p })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: value.priority === p ? (PRIO_COLOR[p] ?? th.accent) : th.line, backgroundColor: value.priority === p ? (PRIO_COLOR[p] ?? th.accent) : th.card }}>
            {p > 0 && <Icon name="flag.fill" size={13} color={value.priority === p ? '#FFFFFF' : PRIO_COLOR[p]} />}
            <Text style={{ color: value.priority === p ? '#FFFFFF' : th.ink, fontFamily: font.semi, fontSize: 14 }}>{t(`prio.${p}` as 'prio.0')}</Text>
          </Pressable>
        ))}
      </View>

      {hasDate && (
        <Select<number | null> label={t('remind.label')} title={t('remind.label')} value={value.remind_before}
          options={[{ value: null, label: t('remind.0') }, ...REMIND_CHOICES.filter((m) => m > 0).map((m) => ({ value: m as number | null, label: t(`remind.${m}` as 'remind.5') }))]}
          onChange={(v) => onChange({ ...value, remind_before: v })} />
      )}

      <SectionLabel>{t('check.label')}</SectionLabel>
      {value.checklist.map((i) => (
        <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Check done={i.done} onPress={() => onChange({ ...value, checklist: toggleItem(value.checklist, i.id) })} />
          <Text style={{ flex: 1, color: i.done ? th.muted : th.ink, fontSize: 16, fontFamily: font.body, textDecorationLine: i.done ? 'line-through' : 'none' }}>{i.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('check.remove', { text: i.text })} hitSlop={10} onPress={() => onChange({ ...value, checklist: removeItem(value.checklist, i.id) })}>
            <Icon name="xmark" size={14} color={th.muted} />
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Field style={{ flex: 1 }} placeholder={t('check.placeholder')} value={step} onChangeText={setStep} onSubmitEditing={addStep} returnKeyType="done" blurOnSubmit={false} />
        <Btn small label={t('check.add')} onPress={addStep} disabled={!step.trim()} />
      </View>

      <SectionLabel>{t('tags.label')}</SectionLabel>
      {value.tags.length > 0 && (
        <View style={styles.row}>
          {value.tags.map((g) => (
            <Pressable key={g} accessibilityRole="button" accessibilityLabel={t('tags.remove', { tag: g })} onPress={() => onChange({ ...value, tags: removeTag(value.tags, g) })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: th.card, borderWidth: 1, borderColor: th.line }}>
              <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 14 }}>#{g}</Text>
              <Icon name="xmark" size={11} color={th.muted} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Field style={{ flex: 1 }} placeholder={t('tags.placeholder')} value={tag} onChangeText={setTag} onSubmitEditing={putTag} autoCapitalize="none" returnKeyType="done" blurOnSubmit={false} />
        <Btn small label={t('tags.add')} onPress={putTag} disabled={!tag.trim()} />
      </View>

      <SectionLabel>{t('notes.label')}</SectionLabel>
      <Field multiline placeholder={t('notes.placeholder')} value={value.notes} onChangeText={(notes) => onChange({ ...value, notes })} style={{ minHeight: 70 }} />
    </View>
  );
}
