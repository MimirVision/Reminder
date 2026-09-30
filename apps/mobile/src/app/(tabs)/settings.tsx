import { useCallback, useEffect, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { createCaptureKey, deleteCaptureKey, listCaptureKeys } from '@/lib/api';
import { enableReminders, hasBackgroundAccess, refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Btn, Card, Muted, styles } from '@/lib/ui';
import type { CaptureKey } from '@/lib/types';

export default function Settings() {
  const t = useTheme();
  const { household } = useSession();
  const [enabled, setEnabled] = useState(false);
  const [watching, setWatching] = useState<number | null>(null);
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.screen}>
        <Card>
          <Text style={{ color: t.fg, fontWeight: '700' }}>Place reminders</Text>
          <Muted>{enabled ? 'On. Choose "Always" for location so they work in the background.' : 'Off. Needs "Always" location and notifications.'}</Muted>
          {watching !== null && <Muted>Watching {watching} nearby place(s).</Muted>}
          <Btn primary label={enabled ? 'Refresh watched places' : 'Turn on place reminders'} onPress={turnOn} />
        </Card>

        <Card>
          <Text style={{ color: t.fg, fontWeight: '700' }}>Quick capture (Siri, Action button, share sheet)</Text>
          <Muted>
            Create a capture key, then build an iOS Shortcut that sends text to your inbox without opening the app.
            The recipe is in docs/CAPTURE.md.
          </Muted>
          {keys.map((k) => (
            <View key={k.id} style={styles.row}>
              <Text style={{ color: t.fg, flex: 1 }}>{k.label}{k.last_used_at ? ` · used ${new Date(k.last_used_at).toLocaleDateString()}` : ''}</Text>
              <Btn danger label="Revoke" onPress={async () => { await deleteCaptureKey(k.id); await load(); }} />
            </View>
          ))}
          <Btn
            label="Create capture key"
            onPress={async () => {
              if (!household) return;
              setNewKey(await createCaptureKey(household.id, 'iPhone Shortcut'));
              await load();
            }}
          />
          {newKey && (
            <View>
              <Muted>Copy this now. It is shown only once:</Muted>
              <Text selectable style={{ color: t.fg, fontFamily: 'Menlo', fontSize: 12 }}>{newKey}</Text>
            </View>
          )}
        </Card>

        <Card>
          <Text style={{ color: t.fg, fontWeight: '700' }}>Household</Text>
          <Muted>{household?.name}</Muted>
          <Muted>Invite code for your partner:</Muted>
          <Text selectable style={{ color: t.fg, fontFamily: 'Menlo' }}>{household?.invite_code}</Text>
        </Card>

        <Btn danger label="Sign out" onPress={() => supabase.auth.signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
