import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as BackgroundTask from 'expo-background-task';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { WebView } from 'react-native-webview';
import { discoverKnown, validateEmail } from '../core/discover';
import { explainLoginFailure } from '../core/errors';
import { ImapClient, ImapError } from '../core/imap';
import { decodeWords, parseAddress } from '../core/mime';
import { CheckCard, useCheck, type CheckState } from '../lib/Check';
import { readLog } from '../lib/log';
import { rnConnector } from '../lib/rnSocket';
import { registerBackgroundCheck } from '../lib/tasks';
import { useTheme } from '../lib/theme';

const GOOGLE = {
  clientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  discovery: { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth', tokenEndpoint: 'https://oauth2.googleapis.com/token' },
  scopes: ['https://mail.google.com/', 'email'],
};
const MS = {
  clientId: process.env.EXPO_PUBLIC_MS_CLIENT_ID ?? '',
  discovery: {
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  },
  scopes: ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'],
};
const ALERTS_KEY = 'post.alerts';
const GOOGLE_KEY = 'post.google';
const MS_KEY = 'post.microsoft';
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const ms = (t0: number) => `${Date.now() - t0} ms`;
const days = (t: number) => ((Date.now() - t) / 86400000).toFixed(1);

async function readInbox(c: ImapClient, say: (l: string) => void, host: string) {
  const boxes = await c.list();
  say(`${boxes.length} folders: ${boxes.slice(0, 6).map((b) => (b.specialUse ? `${b.name} [${b.specialUse}]` : b.name)).join(', ')}`);
  const sel = await c.select('INBOX');
  say(`INBOX: ${sel.exists} messages, uidvalidity ${sel.uidValidity}, next uid ${sel.uidNext}`);
  if (sel.exists > 0) {
    const t0 = Date.now();
    const rows = await c.fetchHeaders(`${Math.max(1, sel.exists - 9)}:*`);
    say(`read ${rows.length} newest headers in ${ms(t0)}`);
    for (const r of rows.slice(-5).reverse()) say(`${r.flags.includes('\\Seen') ? ' ' : '*'} ${parseAddress(r.headers.from ?? '').name || r.headers.from} | ${decodeWords(r.headers.subject ?? '')}`);
  }
  say(`host ${host}`);
}

export default function Spike() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const results = useRef<Record<string, CheckState>>({});
  const record = useCallback((name: string, s: CheckState) => {
    results.current[name] = s;
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mail, runMail] = useCheck('Mail login (IMAP over TLS)', record);
  const [alertUrl, setAlertUrl] = useState('');
  const [alertKey, setAlertKey] = useState('');
  const [alerts, runAlerts] = useCheck('Instant alerts', record);
  const [ms365, runMs] = useCheck('Microsoft sign-in', record);
  const [msAge, runMsAge] = useCheck('Microsoft token still valid', record);
  const [google, runGoogle] = useCheck('Google sign-in', record);
  const [googleAge, runGoogleAge] = useCheck('Google token still valid', record);
  const [fts, runFts] = useCheck('Search index (FTS5)', record);
  const [web, runWeb] = useCheck('Mail view (images blocked)', record);
  const [tls, runTls] = useCheck('Secure connection', record);
  const [runtime, runRuntime] = useCheck('Phone runtime', record);
  const [keychain, runKeychain] = useCheck('Keychain', record);
  const [bg, runBg] = useCheck('Background refresh', record);
  const [showWeb, setShowWeb] = useState(false);
  const [, bump] = useState(0);
  const webDone = useRef<{ ok: () => void; fail: (e: Error) => void } | null>(null);
  const [copied, setCopied] = useState(false);

  const input = {
    height: 48, borderRadius: 14, backgroundColor: t.bg, color: t.ink, paddingHorizontal: 14, fontSize: 16, marginTop: 10,
  } as const;

  const checkMail = () =>
    runMail(async (say) => {
      const v = validateEmail(email);
      if (!v.ok) throw new Error(v.reason);
      const d = discoverKnown(v.domain);
      if (!d) throw new Error('This spike only knows Gmail, iCloud and Outlook addresses.');
      say(`${d.label}: ${d.imap.host}:${d.imap.port}`);
      let t0 = Date.now();
      const c = await ImapClient.connect(rnConnector, { host: d.imap.host, port: d.imap.port, tls: true, timeoutMs: 15000 });
      say(`connected + TLS in ${ms(t0)}`);
      try {
        await c.capability();
        say(`capabilities: ${c.caps.slice(0, 8).join(' ')}…`);
        t0 = Date.now();
        try {
          await c.login(v.email, password.replace(/\s/g, ''));
        } catch (e) {
          if (e instanceof ImapError && e.code === 'auth') {
            const x = explainLoginFailure(d.imap.host, e.message, e.serverCode);
            throw new Error(`${x.title}. ${x.fix}`);
          }
          throw e;
        }
        say(`logged in in ${ms(t0)}`);
        await readInbox(c, say, d.imap.host);
      } finally {
        await c.logout();
      }
    });

  const graph = async (token: string, path: string) => {
    const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Microsoft Graph ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return (await r.json()) as Record<string, any>;
  };

  const alertCall = async (body: Record<string, unknown>) => {
    const res = await fetch(alertUrl.trim(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-alerts-key': alertKey.trim() }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(res.status === 401 ? 'The alerts key was not accepted.' : res.status === 503 ? 'The server is missing secrets (see docs/POST.md).' : `Server said ${res.status}: ${j.error ?? ''}`);
    return j;
  };

  // Turns on instant alerts for the signed-in Outlook account: a second, read-only sign-in whose token lives (encrypted) on your own Supabase.
  const checkAlerts = () =>
    runAlerts(async (say) => {
      if (!MS.clientId) {
        say('Needs the Microsoft sign-in set up first (EXPO_PUBLIC_MS_CLIENT_ID).');
        return 'skip';
      }
      if (!/^https:\/\//.test(alertUrl.trim()) || !alertKey.trim()) throw new Error('Fill in the server address and the alerts key.');
      const v = await alertCall({ op: 'vapid' });
      say(`server reachable, alerts key accepted (${String(v.publicKey).slice(0, 8)}…)`);
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'postmail', path: 'auth' });
      const scopes = ['offline_access', 'User.Read', 'Mail.Read'];
      const req = new AuthSession.AuthRequest({ clientId: MS.clientId, scopes, redirectUri, usePKCE: true, extraParams: { prompt: 'select_account' } });
      const res = await req.promptAsync(MS.discovery);
      if (res.type !== 'success') throw new Error(`Sign-in ${res.type}${res.type === 'error' ? `: ${res.error?.message ?? ''}` : ''}`);
      const tok = await AuthSession.exchangeCodeAsync(
        { clientId: MS.clientId, code: res.params.code, redirectUri, extraParams: { code_verifier: req.codeVerifier ?? '', scope: scopes.join(' ') } },
        MS.discovery,
      );
      if (!tok.refreshToken) throw new Error('Microsoft did not give a refresh token.');
      const me = await graph(tok.accessToken, '/me?$select=displayName,mail,userPrincipalName');
      const email = String(me.mail ?? me.userPrincipalName);
      say(`read-only sign-in as ${email}`);
      await SecureStore.setItemAsync(ALERTS_KEY, JSON.stringify({ url: alertUrl.trim(), key: alertKey.trim() }), KEYCHAIN);
      const r = await alertCall({ op: 'register', email, label: email.includes('outlook') || email.includes('hotmail') ? 'Personal' : 'Work', refreshToken: tok.refreshToken, mode: 'people' });
      say(`Microsoft will now tell your server when mail arrives for ${r.email}. Watch valid until ${new Date(r.expires).toLocaleString()}`);
      const st = await alertCall({ op: 'status' });
      say(`phones registered for alerts: ${st.devices}${st.devices ? '' : ' (open the Post alerts page on this phone, see docs/POST.md)'}`);
      if (st.devices) {
        const t = await alertCall({ op: 'test' });
        say(`test alert sent to ${t.sent} phone(s). Lock the phone: it should appear within seconds.`);
      }
      say('Now send yourself an email from another address, with this app closed and the phone locked, and note how long the alert takes.');
    });

  const checkMs = () =>
    runMs(async (say) => {
      if (!MS.clientId) {
        say('No Microsoft client id was built in (EXPO_PUBLIC_MS_CLIENT_ID).');
        return 'skip';
      }
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'postmail', path: 'auth' });
      say(`return address: ${redirectUri}`);
      const req = new AuthSession.AuthRequest({ clientId: MS.clientId, scopes: MS.scopes, redirectUri, usePKCE: true, extraParams: { prompt: 'select_account' } });
      const res = await req.promptAsync(MS.discovery);
      if (res.type !== 'success') throw new Error(`Sign-in ${res.type}${res.type === 'error' ? `: ${res.error?.message ?? ''}` : ''}`);
      say('Microsoft sign-in sheet returned a code');
      const tok = await AuthSession.exchangeCodeAsync(
        { clientId: MS.clientId, code: res.params.code, redirectUri, extraParams: { code_verifier: req.codeVerifier ?? '', scope: MS.scopes.join(' ') } },
        MS.discovery,
      );
      say(`access token: yes. refresh token: ${tok.refreshToken ? 'YES' : 'NO'}`);
      const me = await graph(tok.accessToken, '/me?$select=displayName,mail,userPrincipalName');
      say(`signed in as ${me.mail ?? me.userPrincipalName} (${me.displayName})`);
      const t0 = Date.now();
      const inbox = await graph(tok.accessToken, '/me/mailFolders/inbox?$select=totalItemCount,unreadItemCount');
      say(`inbox: ${inbox.totalItemCount} messages, ${inbox.unreadItemCount} unread`);
      const list = await graph(tok.accessToken, '/me/mailFolders/inbox/messages?$top=5&$select=subject,from,receivedDateTime,isRead,inferenceClassification');
      say(`read the newest 5 in ${ms(t0)}`);
      for (const m of (list.value ?? []) as { subject?: string; from?: { emailAddress?: { name?: string } }; isRead?: boolean; inferenceClassification?: string }[])
        say(`${m.isRead ? ' ' : '*'} ${m.from?.emailAddress?.name ?? '?'} | ${m.subject ?? ''} | ${m.inferenceClassification ?? ''}`);
      const folders = await graph(tok.accessToken, '/me/mailFolders?$top=20&$select=displayName,totalItemCount');
      say(`folders: ${(folders.value as { displayName: string }[]).map((f) => f.displayName).join(', ')}`);
      if (tok.refreshToken) await SecureStore.setItemAsync(MS_KEY, JSON.stringify({ refreshToken: tok.refreshToken, email: me.mail ?? me.userPrincipalName, obtainedAt: Date.now() }), KEYCHAIN);
      else throw new Error('No refresh token came back, so it could not stay signed in.');
    });

  const checkMsAge = () =>
    runMsAge(async (say) => {
      const raw = await SecureStore.getItemAsync(MS_KEY, KEYCHAIN);
      if (!raw) {
        say('No stored Microsoft sign-in yet. Run "Microsoft sign-in" first, then come back after a week.');
        return 'skip';
      }
      const saved = JSON.parse(raw) as { refreshToken: string; email: string; obtainedAt: number };
      say(`signed in ${days(saved.obtainedAt)} days ago as ${saved.email}`);
      const tok = await AuthSession.refreshAsync({ clientId: MS.clientId, refreshToken: saved.refreshToken, scopes: MS.scopes }, MS.discovery);
      say('refresh token still accepted by Microsoft');
      const inbox = await graph(tok.accessToken, '/me/mailFolders/inbox?$select=unreadItemCount');
      say(`inbox read with the refreshed token: ${inbox.unreadItemCount} unread`);
      if (tok.refreshToken) await SecureStore.setItemAsync(MS_KEY, JSON.stringify({ ...saved, refreshToken: tok.refreshToken }), KEYCHAIN);
    });

  const checkGoogle = () =>
    runGoogle(async (say) => {
      if (!GOOGLE.clientId) {
        say('No Google client id was built in (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID).');
        return 'skip';
      }
      const redirectUri = `com.googleusercontent.apps.${GOOGLE.clientId.replace('.apps.googleusercontent.com', '')}:/oauthredirect`;
      const req = new AuthSession.AuthRequest({
        clientId: GOOGLE.clientId, scopes: GOOGLE.scopes, redirectUri, usePKCE: true,
        extraParams: { access_type: 'offline', prompt: 'consent' },
      });
      const res = await req.promptAsync(GOOGLE.discovery);
      if (res.type !== 'success') throw new Error(`Sign-in ${res.type}${res.type === 'error' ? `: ${res.error?.message ?? ''}` : ''}`);
      say('Google sign-in sheet returned a code');
      const tok = await AuthSession.exchangeCodeAsync(
        { clientId: GOOGLE.clientId, code: res.params.code, redirectUri, extraParams: { code_verifier: req.codeVerifier ?? '' } },
        GOOGLE.discovery,
      );
      say(`access token: yes. refresh token: ${tok.refreshToken ? 'YES' : 'NO'}. scope: ${tok.scope ?? '?'}`);
      const info = (await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.accessToken}` } })).json()) as { email?: string };
      if (!info.email) throw new Error('Google did not tell us the email address.');
      say(`signed in as ${info.email}`);
      if (tok.refreshToken) await SecureStore.setItemAsync(GOOGLE_KEY, JSON.stringify({ refreshToken: tok.refreshToken, email: info.email, obtainedAt: Date.now() }), KEYCHAIN);
      const c = await ImapClient.connect(rnConnector, { host: 'imap.gmail.com', port: 993, tls: true, timeoutMs: 15000 });
      try {
        await c.authXoauth2(info.email, tok.accessToken);
        say('IMAP login with the Google token: OK (no password typed)');
        await readInbox(c, say, 'imap.gmail.com');
      } finally {
        await c.logout();
      }
      // The same token also works for Gmail's own API, which is the sturdier way to read Gmail. Both are measured.
      const t0 = Date.now();
      const api = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10', { headers: { Authorization: `Bearer ${tok.accessToken}` } });
      if (api.ok) {
        const j = (await api.json()) as { resultSizeEstimate?: number; messages?: unknown[] };
        say(`Gmail API: OK in ${ms(t0)}, ${j.messages?.length ?? 0} messages listed`);
      } else {
        say(`Gmail API: ${api.status}. If this is 403, enable the Gmail API for the project (docs/MAIL.md).`);
      }
      if (!tok.refreshToken) throw new Error('No refresh token came back, so it could not stay signed in.');
    });

  const checkGoogleAge = () =>
    runGoogleAge(async (say) => {
      const raw = await SecureStore.getItemAsync(GOOGLE_KEY, KEYCHAIN);
      if (!raw) {
        say('No stored Google sign-in yet. Run "Google sign-in" first, then come back after 7 or more days.');
        return 'skip';
      }
      const saved = JSON.parse(raw) as { refreshToken: string; email: string; obtainedAt: number };
      say(`signed in ${days(saved.obtainedAt)} days ago as ${saved.email}`);
      const tok = await AuthSession.refreshAsync({ clientId: GOOGLE.clientId, refreshToken: saved.refreshToken }, GOOGLE.discovery);
      say('refresh token still accepted by Google');
      const c = await ImapClient.connect(rnConnector, { host: 'imap.gmail.com', port: 993, tls: true, timeoutMs: 15000 });
      try {
        await c.authXoauth2(saved.email, tok.accessToken);
        say('IMAP login with the refreshed token: OK');
      } finally {
        await c.logout();
      }
    });

  const checkFts = () =>
    runFts(async (say) => {
      const db = await SQLite.openDatabaseAsync(':memory:');
      try {
        await db.execAsync("CREATE VIRTUAL TABLE m USING fts5(subject, body, tokenize='unicode61 remove_diacritics 2')");
        await db.runAsync('INSERT INTO m(subject, body) VALUES (?, ?), (?, ?), (?, ?)', 'Strømregning for september', 'Fakturaen er klar.', 'Møte torsdag kl. 10?', 'Passer det for deg?', 'Re: Hytta i påska', 'Vi trenger mer ved');
        say('FTS5 table created');
        for (const q of ['septem*', 'strøm*', 'strom*', 'mote*', 'møte', 'paska*', 'hytta']) {
          const rows = await db.getAllAsync<{ subject: string }>('SELECT subject FROM m WHERE m MATCH ? ORDER BY bm25(m)', q);
          say(`"${q}" -> ${rows.length ? rows.map((r) => r.subject).join(' / ') : 'no match'}`);
        }
        const snip = await db.getFirstAsync<{ s: string }>("SELECT snippet(m, 1, '[', ']', '…', 6) AS s FROM m WHERE m MATCH 'klar'");
        say(`snippet(): ${snip?.s ?? 'none'}`);
      } finally {
        await db.closeAsync();
      }
    });

  const checkTls = () =>
    runTls(async (say) => {
      // A mail app that accepts a forged certificate would hand your password to anyone on the same Wi-Fi.
      try {
        const ok = await rnConnector({ host: 'badssl.com', port: 443, tls: true, timeoutMs: 10000 });
        ok.close();
        say('badssl.com (valid certificate): connected, as it should');
      } catch (e) {
        throw new Error(`Could not reach badssl.com to run this test (${e instanceof Error ? e.message : e}). Check the internet connection.`);
      }
      let accepted = 0;
      for (const host of ['expired.badssl.com', 'wrong.host.badssl.com', 'self-signed.badssl.com', 'untrusted-root.badssl.com']) {
        try {
          const sock = await rnConnector({ host, port: 443, tls: true, timeoutMs: 10000 });
          sock.close();
          accepted++;
          say(`${host}: ACCEPTED (bad)`);
        } catch (e) {
          say(`${host}: refused, as it should be`);
        }
      }
      if (accepted) throw new Error(`The app accepted ${accepted} forged certificate(s). Do not enter a password until this is fixed.`);
    });

  const checkRuntime = () =>
    runRuntime(async (say) => {
      const g = globalThis as Record<string, unknown>;
      const has = (n: string) => (typeof g[n] !== 'undefined' ? 'yes' : 'NO');
      say(`engine: ${(g.HermesInternal as { getRuntimeProperties?: () => Record<string, string> } | undefined)?.getRuntimeProperties?.()['OSS Release Version'] ?? 'unknown'}, iOS ${Platform.Version}`);
      say(['TextDecoder', 'TextEncoder', 'structuredClone', 'AbortController', 'URL', 'URLSearchParams', 'Blob', 'FileReader', 'crypto', 'Buffer'].map((n) => `${n}: ${has(n)}`).join('  '));
      say(`crypto.subtle: ${(g.crypto as { subtle?: unknown } | undefined)?.subtle ? 'yes' : 'NO'}  Intl: ${typeof Intl !== 'undefined' ? 'yes' : 'NO'}`);
      say(`nb-NO date: ${new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}`);
    });

  const checkWeb = () =>
    runWeb(async (say) => {
      const done = new Promise<void>((ok, fail) => {
        webDone.current = { ok, fail };
        setTimeout(() => fail(new Error('The page did not finish loading in 8 seconds.')), 8000);
      });
      setShowWeb(true);
      await done;
      say('HTML rendered with JavaScript off and a policy that blocks all remote images');
      say('Look at the box: the tracking image must NOT show, the text must.');
    });

  const checkKeychain = () =>
    runKeychain(async (say) => {
      const value = `secret-${Date.now()}`;
      await SecureStore.setItemAsync('post.test', value, KEYCHAIN);
      const back = await SecureStore.getItemAsync('post.test', KEYCHAIN);
      if (back !== value) throw new Error('Read back a different value.');
      await SecureStore.deleteItemAsync('post.test', KEYCHAIN);
      say('saved, read back and deleted (readable after first unlock, so background tasks can use it)');
    });

  const checkBg = () =>
    runBg(async (say) => {
      const status = await BackgroundTask.getStatusAsync();
      say(`background status: ${status === BackgroundTask.BackgroundTaskStatus.Available ? 'available' : 'restricted'}`);
      await registerBackgroundCheck();
      say('registered. iOS decides when it runs. Use the phone normally for a day, then open this screen and read the log below.');
      bump((n) => n + 1);
    });

  const bgLog = readLog().filter((l) => l.tag === 'background').slice(-8).reverse();

  const copyReport = async () => {
    const lines = [`Post spike ${Constants.expoConfig?.version} on iOS ${Platform.Version}`, ''];
    for (const [name, s] of Object.entries(results.current)) lines.push(`## ${name}: ${s.status}`, ...s.lines.map((l) => `  ${l}`));
    lines.push('', '## Background runs', ...readLog().filter((l) => l.tag === 'background').map((l) => `  ${new Date(l.t).toISOString()}`));
    await Clipboard.setStringAsync(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={{ color: t.ink, fontSize: 32, fontWeight: '800', letterSpacing: -0.6 }}>Post</Text>
      <Text style={{ color: t.muted, fontSize: 14, marginTop: 4, marginBottom: 16, lineHeight: 20 }}>
        Build check {Constants.expoConfig?.version}. Run each check on this phone, then tap Copy report at the bottom and send it to me.
      </Text>

      <CheckCard title="Mail login (IMAP over TLS)" why="Can the app talk to your mail server directly? Use a Gmail or iCloud address with an app password." state={mail} onRun={checkMail}>
        <TextInput value={email} onChangeText={setEmail} placeholder="you@gmail.com" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={input} />
        <TextInput value={password} onChangeText={setPassword} placeholder="App password" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={input} />
      </CheckCard>

      <CheckCard title="Instant alerts" why="The make-or-break test: Microsoft tells your own server the moment mail arrives and your phone rings. Needs the Post alerts page on the Home Screen first (docs/POST.md)." state={alerts} onRun={checkAlerts} runLabel="Turn on alerts for my Outlook">
        <TextInput value={alertUrl} onChangeText={setAlertUrl} placeholder="https://….supabase.co/functions/v1/post-alerts" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} />
        <TextInput value={alertKey} onChangeText={setAlertKey} placeholder="Alerts key" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={input} />
      </CheckCard>
      <CheckCard
        title="Microsoft sign-in"
        why={MS.clientId ? 'One-tap Outlook, no password. Reads your inbox through Microsoft Graph. This is the main account path.' : 'Not built in: add the repository secret EXPO_PUBLIC_MS_CLIENT_ID and build again (see docs/MAIL.md).'}
        state={ms365}
        onRun={checkMs}
        runLabel="Sign in with Microsoft"
      />
      <CheckCard title="Microsoft token still valid" why="Run it a week or more after signing in. Microsoft sign-ins should last 90 days when used, so this should keep working." state={msAge} onRun={checkMsAge} />
      <CheckCard
        title="Google sign-in"
        why={GOOGLE.clientId ? 'One-tap Gmail without an app password. Needs a refresh token, so you stay signed in.' : 'Not built in: add the repository secret EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and build again (see docs/MAIL.md).'}
        state={google}
        onRun={checkGoogle}
        runLabel="Sign in with Google"
      />
      <CheckCard title="Google token still valid" why="The key test: run this 8 or more days after signing in. If it works, Gmail never asks you to sign in again." state={googleAge} onRun={checkGoogleAge} />
      <CheckCard title="Search index (FTS5)" why="Instant offline search. Also shows whether æ ø å searches work the way you expect." state={fts} onRun={checkFts} />
      <CheckCard title="Mail view (images blocked)" why="Shows an email as a web page, with tracking images blocked." state={web} onRun={checkWeb}>
        {showWeb ? (
          <View style={{ height: 150, marginTop: 10, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: t.line }}>
            <WebView
              originWhitelist={['about:*']}
              javaScriptEnabled={false}
              source={{
                html: `<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><body style="font:16px -apple-system;padding:12px"><p>Hei! Strømregning og påska.</p><img src="https://www.gstatic.com/webp/gallery/1.jpg" width="120"><p>If you can see a photo above, remote images are NOT blocked.</p></body>`,
              }}
              onLoadEnd={() => webDone.current?.ok()}
              onError={(e) => webDone.current?.fail(new Error(e.nativeEvent.description))}
            />
          </View>
        ) : null}
      </CheckCard>
      <CheckCard title="Secure connection" why="Does the app refuse forged certificates? If it does not, a stranger on café Wi-Fi could steal a mail password. Must pass." state={tls} onRun={checkTls} />
      <CheckCard title="Phone runtime" why="Which modern features this phone's engine has. Decides which ready-made libraries I can use." state={runtime} onRun={checkRuntime} />
      <CheckCard title="Keychain" why="Passwords and sign-in tokens are kept in the iPhone's secure storage." state={keychain} onRun={checkKeychain} />
      <CheckCard title="Background refresh" why="Can the app wake itself now and then to look for new mail? iOS decides how often, so we measure." state={bg} onRun={checkBg} runLabel="Register">
        <View style={{ marginTop: 10, gap: 2 }}>
          <Text style={{ color: t.muted, fontSize: 12.5 }}>{bgLog.length ? 'Recent runs:' : 'No runs yet.'}</Text>
          {bgLog.map((l) => (
            <Text key={l.t} style={{ color: t.ink, fontSize: 12.5, fontFamily: 'Menlo' }}>{new Date(l.t).toLocaleString()}</Text>
          ))}
        </View>
      </CheckCard>

      <Pressable onPress={copyReport} accessibilityRole="button" style={{ height: 52, borderRadius: 26, backgroundColor: t.ink, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
        <Text style={{ color: t.bg, fontWeight: '700', fontSize: 16 }}>{copied ? 'Copied. Paste it to me.' : 'Copy report'}</Text>
      </Pressable>
    </ScrollView>
  );
}
