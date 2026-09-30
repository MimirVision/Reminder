import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { listDoneSince } from './api';
import { Avatar } from './Avatar';
import { useI18n } from './i18n';
import { readJson, writeJson } from './store';
import { font, useTheme } from './theme';
import type { Household, Member } from './types';
import { Muted, styles } from './ui';

const weekId = (d = new Date()) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

// "This week: 12 things done. Anna 7, Per 5." Quiet until there is something to be proud of.
export function RecapCard({ household, members, refreshKey }: { household: Household; members: Member[]; refreshKey: number }) {
  const th = useTheme();
  const { t, tn } = useI18n();
  const key = `hm.recapHidden.${household.id}`;
  const [done, setDone] = useState<Awaited<ReturnType<typeof listDoneSince>>>([]);
  const [hidden, setHidden] = useState(() => readJson<string | null>(key, null) === weekId());

  useEffect(() => { listDoneSince(household.id).then(setDone).catch(() => {}); }, [household.id, refreshKey]);
  const perPerson = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of done) { const who = d.done_by ?? d.author_id; m.set(who, (m.get(who) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [done]);

  if (hidden || done.length < 3) return null;
  return (
    <View style={{ borderRadius: 20, padding: 14, gap: 8, backgroundColor: th.dark ? '#1B2B24' : '#E9F3EC' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{t('recap.title')} <Text style={{ color: th.muted, fontFamily: font.body, fontSize: 14 }}>{tn('recap.done', done.length)}</Text></Text>
        <Pressable onPress={() => { writeJson(key, weekId()); setHidden(true); }} hitSlop={8}><Muted>{t('recap.hide')}</Muted></Pressable>
      </View>
      {members.length > 1 && (
        <View style={styles.row}>
          {perPerson.map(([id, n]) => {
            const name = members.find((m) => m.user_id === id)?.display_name ?? '';
            return (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: th.line, paddingVertical: 3, paddingHorizontal: 8 }}>
                <Avatar id={id} name={name} size={18} />
                <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 13 }}>{t('recap.by', { name: name || t('common.partner'), n })}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
