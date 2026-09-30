import { useState } from 'react';
import { SafeAreaView, ScrollView, Text } from 'react-native';
import { createHousehold, joinHousehold } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Btn, Field, Muted, styles } from '@/lib/ui';

export default function Onboarding() {
  const t = useTheme();
  const { reloadHousehold } = useSession();
  const [name, setName] = useState('');
  const [houseName, setHouseName] = useState('Home');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await reloadHousehold();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={[styles.screen, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.fg, fontSize: 26, fontWeight: '700' }}>Welcome</Text>
        <Field placeholder="Your name" value={name} onChangeText={setName} />
        <Text style={{ color: t.fg, fontWeight: '600', marginTop: 12 }}>Start a new household</Text>
        <Field placeholder="Household name" value={houseName} onChangeText={setHouseName} />
        <Btn primary label="Create" disabled={busy || !houseName.trim()} onPress={() => run(() => createHousehold(houseName.trim(), name.trim()))} />
        <Text style={{ color: t.fg, fontWeight: '600', marginTop: 12 }}>…or join your partner</Text>
        <Field placeholder="Invite code" autoCapitalize="none" value={code} onChangeText={setCode} />
        <Btn label="Join" disabled={busy || !code.trim()} onPress={() => run(() => joinHousehold(code.trim(), name.trim()))} />
        {err && <Text style={{ color: t.danger }}>{err}</Text>}
        <Muted>The invite code is shown under Settings on the first device.</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}
