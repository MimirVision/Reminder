import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createHousehold, joinHousehold } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Btn, Field, Muted, Title, styles } from '@/lib/ui';

export default function Onboarding() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { reloadHousehold } = useSession();
  const [name, setName] = useState('');
  const [houseName, setHouseName] = useState(() => tr('onb.defaultHousehold'));
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
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg === 'invalid_invite' ? tr('onb.invalidCode') : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.screen, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
        <Title>{tr('onb.welcome')}</Title>
        <Field placeholder={tr('onb.yourName')} value={name} onChangeText={setName} />
        <Text style={{ color: t.fg, fontWeight: '600', marginTop: 12 }}>{tr('onb.newHousehold')}</Text>
        <Field placeholder={tr('onb.householdName')} value={houseName} onChangeText={setHouseName} />
        <Btn primary label={tr('onb.create')} disabled={busy || !houseName.trim()} onPress={() => run(() => createHousehold(houseName.trim(), name.trim()))} />
        <Text style={{ color: t.fg, fontWeight: '600', marginTop: 12 }}>{tr('onb.orJoin')}</Text>
        <Field placeholder={tr('onb.inviteCode')} autoCapitalize="none" value={code} onChangeText={setCode} />
        <Btn label={tr('onb.join')} disabled={busy || !code.trim()} onPress={() => run(() => joinHousehold(code.trim(), name.trim()))} />
        {err && <Text style={{ color: t.danger }}>{err}</Text>}
        <Muted>{tr('onb.inviteShown')}</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}
