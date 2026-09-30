import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createCaptureKey, deleteCaptureKey, listCaptureKeys, rotateInviteCode } from '@/lib/api';
import { GLASS_LEVELS, Glass, useGlass } from '@/lib/glass';
import { enableReminders, hasBackgroundAccess, refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { font, useTheme } from '@/lib/theme';
import { BAR_SPACE, Btn, Card, Muted, Title, styles } from '@/lib/ui';
import type { CaptureKey } from '@/lib/types';

export default function Settings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { household } = useSession();
  const { level, setLevel } = useGlass();
  const [enabled, setEnabled] = useState(false);
  const [watching, setWatching] = useState<number | null>(null);
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  const load = useCallback(async () => {
    setEnabled(await hasBackgroundAccess());
    setKeys(await listCaptureKeys().catch(() => []));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function turnOn() {
    const ok = await enableReminders();
    if (!ok) Alert.alert('Place reminders need "Always" location and notifications. Change it in iOS Settings > Home Memory.');
    await load();
    if (ok) setWatching((await refreshRegions()).watching);
  }

  const h = (s: string) => <Text style={{ color: t.ink, fontSize: 17, fontFamily: font.semi }}>{s}</Text>;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE - 60 }]}>
      <Title>Settings</Title>

      <Card>
        {h('Glass')}
        <Muted>How see-through the floating bars are.</Muted>
        <View style={styles.row}>
          {GLASS_LEVELS.map((g) => <Btn key={g.id} small label={g.label} primary={level === g.id} onPress={() => setLevel(g.id)} />)}
        </View>
        <Glass style={{ borderRadius: 22, padding: 14 }}>
          <Text style={{ color: t.ink, fontSize: 15, fontFamily: font.medium }}>Preview: this is how the bars look</Text>
        </Glass>
      </Card>

      <Card>
        {h('Place reminders')}
        <Muted>{enabled ? 'On. Choose "Always" for location so they work in the background.' : 'Off. Needs "Always" location and notifications.'}</Muted>
        {watching !== null && <Muted>Watching {watching} nearby place(s).</Muted>}
        <Btn primary label={enabled ? 'Refresh watched places' : 'Turn on place reminders'} onPress={turnOn} />
      </Card>

      <Card>
        {h('Quick add (Siri, Action button, share sheet)')}
        <Muted>Create a key, then build an iOS Shortcut that adds a to-do without opening the app. The recipe is in docs/CAPTURE.md.</Muted>
        {keys.map((k) => (
          <View key={k.id} style={styles.row}>
            <Text style={{ color: t.ink, flex: 1, fontFamily: font.body }}>{k.label}{k.last_used_at ? ` · used ${new Date(k.last_used_at).toLocaleDateString()}` : ''}</Text>
            <Btn small danger label="Revoke" onPress={async () => { await deleteCaptureKey(k.id); await load(); }} />
          </View>
        ))}
        <Btn
          label="Create key"
          onPress={async () => {
            if (!household) return;
            setNewKey(await createCaptureKey(household.id, 'iPhone Shortcut'));
            await load();
          }}
        />
        {newKey && (
          <View>
            <Muted>Copy this now. It is shown only once:</Muted>
            <Text selectable style={{ color: t.ink, fontFamily: 'Menlo', fontSize: 12 }}>{newKey}</Text>
          </View>
        )}
      </Card>

      <Card>
        {h('Household')}
        <Muted>{household?.name}</Muted>
        <Muted>Invite code for your partner:</Muted>
        <Text selectable style={{ color: t.ink, fontFamily: 'Menlo' }}>{invite ?? household?.invite_code}</Text>
        <Btn small label="New invite code" onPress={() => Alert.alert('Make a new invite code?', 'The old one stops working.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'New code', onPress: async () => { if (household) setInvite(await rotateInviteCode(household.id)); } },
        ])} />
      </Card>

      <Btn danger label="Sign out" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
