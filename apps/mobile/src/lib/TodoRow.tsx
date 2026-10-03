import type { ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { progress, toggleItem } from '../shared/lib/checklist';
import type { ChecklistItem } from '../shared/lib/types';
import { PRIO_COLOR } from './TodoDetails';
import { useI18n } from './i18n';
import { SwipeRow } from './SwipeRow';
import { font, useTheme } from './theme';
import type { Memory } from './types';
import { Check, Icon, Muted, styles } from './ui';

export type Who = { id: string; name: string | null } | null;

// One to-do: tick to finish, tap the text to edit, swipe right to finish or left to delete. Date, repeat and place are small chips.
export function TodoRow({ m, photos, done, due, dueLate, place, forName, author, doneBy, byline, onToggle, onEdit, onDelete, onReschedule, onChecklist, reorder, children }: {
  m: Memory; photos?: string[]; done?: boolean; due?: string; dueLate?: boolean; place?: string; forName?: string; author?: Who; doneBy?: string | null; byline?: string;
  onToggle: () => void; onEdit: () => void; onDelete?: () => void; onReschedule?: () => void; onChecklist?: (items: ChecklistItem[]) => void; reorder?: { up?: () => void; down?: () => void }; children?: ReactNode;
}) {
  const th = useTheme();
  const { t } = useI18n();
  const steps = m.checklist ?? [];
  const prog = progress(steps);
  const prio = m.priority ?? 0;
  const chip = (text: string, icon: 'calendar' | 'repeat' | 'mappin' | 'pin' | 'person' | 'flag' | 'list.bullet', warm?: boolean, tint?: string, onPress?: () => void) => (
    <Pressable key={text} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, backgroundColor: warm ? th.tint : 'transparent', borderWidth: warm ? 0 : 1, borderColor: th.line }}>
      <Icon name={icon} size={12} color={tint ?? (warm ? th.tintInk : th.muted)} />
      <Text style={{ color: tint ?? (warm ? th.tintInk : th.muted), fontSize: 13, fontFamily: font.semi }}>{text}</Text>
    </Pressable>
  );
  const row = (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 12, opacity: m.pending ? 0.7 : 1 }}>
      <Check done={done} onPress={onToggle} ring={prio ? PRIO_COLOR[prio] : undefined} />
      <View style={{ flex: 1, gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={onEdit}>
          <Text style={{ color: done ? th.muted : th.ink, fontSize: 17, lineHeight: 24, fontFamily: font.medium, textDecorationLine: done ? 'line-through' : 'none' }}>{m.body || t('todo.photo')}</Text>
        </Pressable>
        {(due || place || m.repeat_rule || doneBy || byline || forName || m.pinned || prio > 0 || prog.total > 0 || (m.tags?.length ?? 0) > 0) && (
          <View style={styles.row}>
            {due ? chip(due, 'calendar', true, undefined, onReschedule && !done ? onReschedule : undefined) : null}
            {prio > 0 && !done ? chip(t(`prio.short.${prio}` as 'prio.short.1'), 'flag', false, PRIO_COLOR[prio]) : null}
            {prog.total > 0 ? chip(t('check.progress', { done: prog.done, total: prog.total }), 'list.bullet') : null}
            {m.repeat_rule ? chip(t(`repeat.short.${m.repeat_rule}` as 'repeat.short.daily'), 'repeat') : null}
            {m.pinned && !done ? chip(t('row.pinned'), 'pin') : null}
            {forName ? chip(forName, 'person') : null}
            {place ? chip(place, 'mappin') : null}
            {!done ? (m.tags ?? []).map((g) => <Text key={g} style={{ color: th.muted, fontSize: 13, fontFamily: font.semi, paddingVertical: 3 }}>#{g}</Text>) : null}
            {doneBy ? <Muted>{t('row.doneBy', { name: doneBy })}</Muted> : null}
            {byline ? <Muted>{byline}</Muted> : null}
          </View>
        )}
        {m.notes && !done ? <Text numberOfLines={1} style={{ color: th.muted, fontSize: 14, fontFamily: font.body }}>{m.notes.split('\n')[0]}</Text> : null}
        {steps.length > 0 && !done && (
          <View style={{ gap: 6 }}>
            {steps.map((i) => (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Check small done={i.done} onPress={() => { if (!m.pending) onChecklist?.(toggleItem(steps, i.id)); }} />
                <Text style={{ flex: 1, color: i.done ? th.muted : th.ink, fontSize: 15, fontFamily: font.body, textDecorationLine: i.done ? 'line-through' : 'none' }}>{i.text}</Text>
              </View>
            ))}
          </View>
        )}
        {photos && photos.length > 0 && <View style={styles.row}>{photos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 120, height: 78, borderRadius: 12 }} />)}</View>}
        {children}
      </View>
      {reorder && (
        <View style={{ alignSelf: 'center', gap: 4 }}>
          {([['up', reorder.up, 'chevron.up'], ['down', reorder.down, 'chevron.down']] as const).map(([k, fn, ic]) => (
            <Pressable key={k} disabled={!fn} accessibilityRole="button" accessibilityLabel={t(`reorder.${k}` as 'reorder.up', { title: (m.body || '').split('\n')[0] })} hitSlop={6} onPress={fn}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: th.dark ? '#262C36' : '#ECEEF2', opacity: fn ? 1 : 0.3 }}>
              <Icon name={ic} size={15} color={th.ink} />
            </Pressable>
          ))}
        </View>
      )}
      {author && <Avatar id={author.id} name={author.name} />}
    </View>
  );
  return onDelete && !done && !reorder ? <SwipeRow onDone={onToggle} onDelete={onDelete}>{row}</SwipeRow> : row;
}
