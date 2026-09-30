import { useState } from 'react';
import { SafeAreaView, ScrollView, Text } from 'react-native';
import { supabase } from '@/lib/supabase';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Btn, Field, Muted, Title, styles } from '@/lib/ui';

export default function Login() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const res =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (res.error) setMsg(res.error.message);
    else if (mode === 'up' && !res.data.session) setMsg(tr('auth.confirmEmail'));
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={[styles.screen, { paddingTop: 80 }]} keyboardShouldPersistTaps="handled">
        <Title>Home Memory</Title>
        <Muted>{tr('auth.tagline')}</Muted>
        <Field placeholder={tr('auth.email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <Field placeholder={tr('auth.password')} secureTextEntry autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChangeText={setPassword} />
        <Btn primary label={mode === 'in' ? tr('auth.signIn') : tr('auth.create')} onPress={submit} disabled={busy || !email || password.length < 8} />
        {msg && <Text style={{ color: t.danger }}>{msg}</Text>}
        <Btn label={mode === 'in' ? tr('auth.toCreate') : tr('auth.toSignIn')} onPress={() => setMode(mode === 'in' ? 'up' : 'in')} />
        <Muted>{tr('auth.passwordHint')}</Muted>
        <LanguageSwitch />
      </ScrollView>
    </SafeAreaView>
  );
}
