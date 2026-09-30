import { useState } from 'react';
import { SafeAreaView, ScrollView, Text } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Btn, Field, Muted, Title, styles } from '@/lib/ui';

export default function Login() {
  const t = useTheme();
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
    else if (mode === 'up' && !res.data.session) setMsg('Check your email to confirm the account, then sign in.');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={[styles.screen, { paddingTop: 80 }]} keyboardShouldPersistTaps="handled">
        <Title>Home Memory</Title>
        <Muted>To-dos that remind you in the right place, and a calendar for the house.</Muted>
        <Field placeholder="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <Field placeholder="Password" secureTextEntry autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChangeText={setPassword} />
        <Btn primary label={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} disabled={busy || !email || password.length < 8} />
        {msg && <Text style={{ color: t.danger }}>{msg}</Text>}
        <Btn label={mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'} onPress={() => setMode(mode === 'in' ? 'up' : 'in')} />
        <Muted>Password must be at least 8 characters.</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}
