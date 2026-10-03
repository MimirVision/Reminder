import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { shareExport } from '@/lib/exportData';
import { createCaptureKey, deleteCaptureKey, deleteMyAccount, listCaptureKeys, rotateInviteCode } from '@/lib/api';
import { GLASS_LEVELS, Glass, useGlass } from '@/lib/glass';
import { Select } from '@/lib/Select';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import { enableReminders, ensureNotifyPermission, hasBackgroundAccess, notifyStatus, readBriefing, refreshRegions, replanNotifications, sendTestNotification, writeBriefing, type NotifyStatus } from '@/lib/reminders';
import { readJson, writeJson } from '@/lib/store';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { font, setThemePref, useTheme, useThemePref } from '@/lib/theme';
import { BAR_SPACE, Btn, Card, Field, Muted, Title, styles } from '@/lib/ui';
import type { CaptureKey } from '@/lib/types';

export default function Settings() {
  const th = useTheme();
  const themePref = useThemePref();
  const { t, tn, locale, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const { household } = useSession();
  const { level, setLevel } = useGlass();
  const [enabled, setEnabled] = useState(false);
  const [notif, setNotif] = useState<NotifyStatus>('undetermined');
  const [watching, setWatching] = useState<number | null>(null);
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [acctBusy, setAcctBusy] = useState(false);
  const [brief, setBrief] = useState(readBriefing);
  const [recap, setRecap] = useState(() => readJson<boolean>('hm.recap', false));
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const load = useCallback(async () => {
    setEnabled(await hasBackgroundAccess());
    setNotif(await notifyStatus());
    setKeys(await listCaptureKeys().catch(() => []));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function turnOn() {
    try {
      const ok = await enableReminders();
      if (!ok) Alert.alert(t('set.alwaysNeeded'));
      await load();
      if (ok) setWatching((await refreshRegions()).watching);
    } catch {
      Alert.alert(t('set.notHereTitle'), t('set.notHereBody'));
    }
  }

  const h = (s: string) => <Text style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{s}</Text>;

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={{ backgroundColor: th.bg }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE - 60 }]}>
      <Title>{t('set.title')}</Title>

      <Card>
        {h(t('set.language'))}
        <LanguageSwitch />
        {h(t('set.appearance'))}
        <View style={styles.row}>
          {(['system', 'light', 'dark'] as const).map((p) => <Btn key={p} small label={t(`theme.${p}` as 'theme.system')} primary={themePref === p} onPress={() => setThemePref(p)} />)}
        </View>
      </Card>

      <Card>
        {h(t('glass.title'))}
        <Muted>{t('glass.help')}</Muted>
        <View style={styles.row}>
          {GLASS_LEVELS.map((g) => <Btn key={g.id} small label={t(g.key)} primary={level === g.id} onPress={() => setLevel(g.id)} />)}
        </View>
        <Glass style={{ borderRadius: 22, padding: 14 }}>
          <Text style={{ color: th.ink, fontSize: 15, fontFamily: font.medium }}>{t('glass.preview')}</Text>
        </Glass>
      </Card>

      <Card>
        {h(t('set.notif'))}
        <Muted>{notif === 'granted' ? t('set.notifOn') : notif === 'denied' ? t('set.notifDenied') : t('set.notifOff')}</Muted>
        {notif === 'undetermined' && <Btn primary label={t('set.notifTurnOn')} onPress={async () => { await ensureNotifyPermission(); await load(); }} />}
        {notif === 'denied' && <Btn primary label={t('set.openSettings')} onPress={() => void Linking.openSettings()} />}
        {notif === 'granted' && <Btn label={t('set.notifTest')} onPress={async () => { Alert.alert((await sendTestNotification()) ? t('set.notifTestSent') : t('set.notifDenied')); }} />}
      </Card>

      <Card>
        {h(t('set.todoList'))}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{t('set.recap')}</Text>
            <Muted>{t('set.recapBody')}</Muted>
          </View>
          <Switch value={recap} accessibilityLabel={t('set.recap')} onValueChange={(v) => { setRecap(v); writeJson('hm.recap', v); }} />
        </View>
      </Card>

      <Card>
        {h(t('set.briefing'))}
        <Muted>{t('set.briefingBody')}</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          <Text style={{ color: th.muted, fontFamily: font.body, fontSize: 15 }}>{brief.on ? t('set.briefingTime') : t('set.briefingOff')}</Text>
          <Switch value={brief.on} accessibilityLabel={t('set.briefing')} onValueChange={async (on) => {
            if (on && !(await ensureNotifyPermission())) { Alert.alert(t('set.notifDenied')); return; }
            const next = { ...brief, on }; setBrief(next); writeBriefing(next); if (household) void replanNotifications(household.id);
          }} />
        </View>
        {brief.on && (
          <Select<string> label={t('set.briefingTime')} title={t('set.briefing')} value={brief.time}
            options={['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '10:00'].map((v) => ({ value: v, label: v }))}
            onChange={(time) => { const next = { ...brief, time }; setBrief(next); writeBriefing(next); if (household) void replanNotifications(household.id); }} />
        )}
      </Card>

      <Card>
        {h(t('set.reminders'))}
        <Muted>{enabled ? t('set.remindersOn') : t('set.remindersOff')}</Muted>
        {watching !== null && <Muted>{tn('set.watching', watching)}</Muted>}
        <Btn primary label={enabled ? t('set.refresh') : t('set.turnOn')} onPress={turnOn} />
        {!enabled && <Muted>{t('set.alwaysHint')}</Muted>}
        {!enabled && <Btn small label={t('set.openLocation')} onPress={() => void Linking.openSettings()} />}
      </Card>

      <Card>
        {h(t('quick.title'))}
        <Muted>{t('quick.intro')}</Muted>
        {keys.map((k) => (
          <View key={k.id} style={styles.row}>
            <Text style={{ color: th.ink, flex: 1, fontFamily: font.body }}>{k.label}{k.last_used_at ? ` · ${t('rem.lastUsed', { date: new Date(k.last_used_at).toLocaleDateString(locale) })}` : ''}</Text>
            <Btn small danger label={t('common.revoke')} onPress={async () => { await deleteCaptureKey(k.id); await load(); }} />
          </View>
        ))}
        <Btn label={t('quick.create')} onPress={async () => { if (!household) return; setNewKey(await createCaptureKey(household.id, t('quick.defaultLabel'))); await load(); }} />
        {newKey && (
          <View>
            <Muted>{t('quick.copyNow')}</Muted>
            <Text selectable style={{ color: th.ink, fontFamily: 'Menlo', fontSize: 12 }}>{newKey}</Text>
          </View>
        )}
      </Card>

      <Card>
        {h(t('hh.title'))}
        <Muted>{household?.name}</Muted>
        <Muted>{t('hh.invite')}</Muted>
        <Text selectable style={{ color: th.ink, fontFamily: 'Menlo' }}>{invite ?? household?.invite_code}</Text>
        <Btn small label={t('hh.newCode')} onPress={() => Alert.alert(t('hh.confirmNew'), t('set.newCodeBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('set.newCode'), onPress: async () => { if (household) setInvite(await rotateInviteCode(household.id)); } },
        ])} />
      </Card>

      <Card>
        {h(t('data.title'))}
        <Muted>{t('data.intro')}</Muted>
        <Btn disabled={exportBusy || !household} label={t('data.export')} onPress={() => {
          if (!household) return;
          setExportBusy(true);
          setExportMsg(t('data.starting'));
          shareExport(household.id, household.name, setExportMsg, t, lang)
            .catch((e) => setExportMsg(t('data.failed', { msg: e instanceof Error ? e.message : String(e) })))
            .finally(() => setExportBusy(false));
        }} />
        {exportMsg ? <Muted>{exportMsg}</Muted> : null}
      </Card>

      <Card>
        {h(t('acct.title'))}
        {deleting ? (
          <>
            <Muted>{t('acct.deleteIntro')}</Muted>
            <Muted>{t('acct.typeToConfirm')}</Muted>
            <Field value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} />
            <Btn danger disabled={acctBusy || confirmText.trim() !== t('acct.confirmWord')} label={acctBusy ? t('acct.deleting') : t('acct.deleteConfirmBtn')}
              onPress={async () => {
                setAcctBusy(true);
                try { await deleteMyAccount(household?.id ?? null); } catch (e) { Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); setAcctBusy(false); }
              }} />
            <Btn label={t('common.cancel')} onPress={() => { setDeleting(false); setConfirmText(''); }} />
          </>
        ) : <Btn danger label={t('acct.delete')} onPress={() => setDeleting(true)} />}
      </Card>

      <Btn danger label={t('auth.signOut')} onPress={() => supabase.auth.signOut()} />
      <Muted>{t('set.version')}: {Constants.expoConfig?.version ?? '?'}</Muted>
    </ScrollView>
  );
}
