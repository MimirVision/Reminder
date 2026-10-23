// Reminders on the phone (Web Push), sent by the vakt-notify function: after a shift, on Sunday evening when next week
// has no shifts, and near the end of the month when next month has none. Each device is turned on once with a tap.
import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { useStore } from '../data/store';
import { supabase } from '../data/config';
import type { Settings } from '../lib/types';
import { Button, Card, Switch } from './ui';

type Server = { state: 'checking' } | { state: 'missing' } | { state: 'ready'; publicKey: string };

const b64uToBytes = (s: string) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
};
const toB64u = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const RULES: { key: keyof Settings['reminders']; title: string; text: string }[] = [
  { key: 'after_shift', title: 'Etter hver vakt', text: 'Hva vakta ga, og om tidene stemmer.' },
  { key: 'weekly', title: 'Søndag kveld', text: 'Hvis neste uke ikke har noen vakter ennå.' },
  { key: 'month', title: 'Slutten av måneden', text: 'Hvis neste måned ikke har noen vakter ennå.' },
];

export function Notifications() {
  const { settings, saveSettings, local, toast } = useStore();
  const [server, setServer] = useState<Server>({ state: 'checking' });
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (local) { setServer({ state: 'missing' }); return; }
    void supabase().functions.invoke('vakt-notify', { body: { op: 'status' } }).then(({ data, error }) => {
      setServer(!error && data?.publicKey ? { state: 'ready', publicKey: data.publicKey } : { state: 'missing' });
    });
    if (supported()) void navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((sub) => setOn(Boolean(sub)));
  }, [local]);

  const turnOn = async () => {
    if (server.state !== 'ready') return;
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { toast('Varsler er ikke tillatt. Slå dem på i Innstillinger for Vakt på telefonen.', { error: true }); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(server.publicKey) });
      const { error } = await supabase().from('vakt_push_devices').upsert(
        { endpoint: sub.endpoint, p256dh: toB64u(sub.getKey('p256dh')), auth: toB64u(sub.getKey('auth')) },
        { onConflict: 'owner_id,endpoint' },
      );
      if (error) throw error;
      setOn(true);
      toast('Varsler er på for denne enheten 🔔');
    } catch (e) {
      toast(`Fikk ikke slått på varsler: ${(e as Error).message}`, { error: true });
    } finally { setBusy(false); }
  };

  const turnOff = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase().from('vakt_push_devices').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
    setOn(false);
  };

  const test = async () => {
    const { data, error } = await supabase().functions.invoke('vakt-notify', { body: { op: 'test' } });
    toast(error ? 'Fikk ikke sendt' : data?.sent ? 'Sendt – sjekk telefonen' : 'Fant ingen enhet å sende til');
  };

  const rules = (
    <div className="divide-y divide-line">
      {RULES.map((r) => (
        <div key={r.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <span className="flex-1">
            <span className="block text-[15px] font-medium">{r.title}</span>
            <span className="block text-[12.5px] text-ink-3">{r.text}</span>
          </span>
          <Switch label={r.title} on={settings.reminders[r.key]} onChange={(v) => void saveSettings({ ...settings, reminders: { ...settings.reminders, [r.key]: v } })} />
        </div>
      ))}
    </div>
  );

  let device: React.ReactNode;
  if (local) device = <p className="text-[14px] text-ink-3">Påminnelser krever at du er logget inn.</p>;
  else if (server.state === 'checking') device = <p className="text-[14px] text-ink-3">Sjekker …</p>;
  else if (server.state === 'missing') device = <p className="text-[14px] text-ink-3">Varslingsserveren er ikke satt opp ennå (se apps/vakt/NOTIFICATIONS.md). Valgene under huskes til den er klar.</p>;
  else if (isIos() && !standalone()) device = <p className="text-[14px] text-ink-2">På iPhone og iPad virker varsler bare fra appen på Hjem-skjermen: legg Vakt til der, åpne den derfra og slå på varsler her.</p>;
  else if (!supported()) device = <p className="text-[14px] text-ink-3">Denne nettleseren støtter ikke varsler.</p>;
  else if (on) device = (
    <div className="flex gap-2">
      <Button variant="soft" className="flex-1" onClick={() => void test()}><BellRing className="size-5" /> Send en test</Button>
      <Button variant="ghost" onClick={() => void turnOff()}>Slå av her</Button>
    </div>
  );
  else device = <Button variant="primary" className="w-full" disabled={busy} onClick={() => void turnOn()}><Bell className="size-5" /> Slå på varsler på denne enheten</Button>;

  return (
    <section>
      <h2 className="px-1 text-[18px] font-bold">Påminnelser</h2>
      <p className="mb-3 px-1 text-[13px] text-ink-3">Et lite dytt på telefonen, så du aldri glemmer å legge inn vakter.</p>
      <Card className="space-y-4">
        {device}
        {rules}
      </Card>
    </section>
  );
}
