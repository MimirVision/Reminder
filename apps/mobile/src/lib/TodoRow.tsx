import type { ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { useI18n } from './i18n';
import { SwipeRow } from './SwipeRow';
import { font, useTheme } from './theme';
import type { Memory } from './types';
import { Check, Icon, Muted, styles } from './ui';

export type Who = { id: string; name: string | null } | null;

// One to-do: tick to finish, tap the text to edit, swipe right to finish or left to delete. Date, repeat and place are small chips.
export function TodoRow({ m, photos, done, due, dueLate, place, author, doneBy, byline, onToggle, onEdit, onDelete, children }: {
  m: Memory; photos?: string[]; done?: boolean; due?: string; dueLate?: boolean; place?: string; author?: Who; doneBy?: string | null; byline?: string;
  onToggle: () => void; onEdit: () => void; onDelete?: () => void; children?: ReactNode;
}) {
  const th = useTheme();
  const { t } = useI18n();
  const chip = (text: string, icon: 'calendar' | 'repeat' | 'mappin', warm?: boolean) => (
    <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, backgroundColor: warm ? th.tint : 'transparent', borderWidth: warm ? 0 : 1, borderColor: th.line }}>
      <Icon name={icon} size={12} color={warm ? th.tintInk : th.muted} />
      <Text style={{ color: warm ? th.tintInk : th.muted, fontSize: 13, fontFamily: font.semi }}>{text}</Text>
    </View>
  );
  const row = (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 12, opacity: m.pending ? 0.7 : 1 }}>
      <Check done={done} onPress={onToggle} />
      <View style={{ flex: 1, gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={onEdit}>
          <Text style={{ color: done ? th.muted : th.ink, fontSize: 17, lineHeight: 24, fontFamily: font.medium, textDecorationLine: done ? 'line-through' : 'none' }}>{m.body || t('todo.photo')}</Text>
        </Pressable>
        {(due || place || m.repeat_rule || doneBy || byline) && (
          <View style={styles.row}>
            {due ? chip(due, 'calendar', true) : null}
            {m.repeat_rule ? chip(t(`repeat.short.${m.repeat_rule}` as 'repeat.short.daily'), 'repeat') : null}
            {place ? chip(place, 'mappin') : null}
            {doneBy ? <Muted>{t('row.doneBy', { name: doneBy })}</Muted> : null}
            {byline ? <Muted>{byline}</Muted> : null}
          </View>
        )}
        {photos && photos.length > 0 && <View style={styles.row}>{photos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 120, height: 78, borderRadius: 12 }} />)}</View>}
        {children}
      </View>
      {author && <Avatar id={author.id} name={author.name} />}
    </View>
  );
  return onDelete && !done ? <SwipeRow onDone={onToggle} onDelete={onDelete}>{row}</SwipeRow> : row;
}
