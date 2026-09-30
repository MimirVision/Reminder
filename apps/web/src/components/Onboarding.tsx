import { FormEvent, useState } from 'react';
import { createHousehold, joinHousehold } from '../lib/api';
import { clearStoredInvite, storedInvite } from '../lib/invite';
import { useI18n } from '../i18n';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [houseName, setHouseName] = useState(t('onb.defaultHousehold'));
  const [code, setCode] = useState(storedInvite);
  const invited = code !== '' && code === storedInvite();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg === 'invalid_invite' ? t('onb.invalidCode') : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>{t('onb.welcome')}</h1>
      {invited && <p className="muted nomargin">{t('onb.invited')}</p>}
      <input placeholder={t('onb.yourName')} value={name} onChange={(e) => setName(e.target.value)} />
      <h2 className="gap">{t('onb.newHousehold')}</h2>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => createHousehold(houseName, name)); }}>
        <input placeholder={t('onb.householdName')} required value={houseName} onChange={(e) => setHouseName(e.target.value)} />
        <button className="btn primary" disabled={busy}>{t('onb.create')}</button>
      </form>
      <h2 className="gap">{t('onb.orJoin')}</h2>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run(async () => { await joinHousehold(code, name); clearStoredInvite(); }); }}>
        <input placeholder={t('onb.inviteCode')} required value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" disabled={busy}>{t('onb.join')}</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
    </main>
  );
}
