// Supabase Edge Function (Deno): instant new-mail alerts for the Post mail app. Microsoft calls it when mail arrives; it decides whether the mail
// deserves an alert and sends a Web Push to the "Post alerts" home-screen web app. The Post app calls it (header x-alerts-key) to register, change or stop.
// Secrets: POST_ALERTS_KEY (any long random text), ALERTS_ENC_KEY (32 random bytes, base64url), MS_CLIENT_ID, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (optional).
// Deploy with "Verify JWT" OFF: Microsoft and the schedule cannot send a Supabase login. The webhook is protected by a secret clientState per mailbox, the rest by POST_ALERTS_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush } from '../notify-partner/logic.ts';
import { alertLifecycle, alertParseLifecycle, alertParseNotifications, alertProcess, alertRegister, alertRenewAll, alertSameSecret, alertSeen, alertSettingsPatch, alertTest, alertUnregister, alertValidationToken, type AlertDeps, type AlertStore, type AlertStored } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-alerts-key',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Microsoft wants an answer within 3 seconds, so the real work continues after we have replied.
function later(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch((e) => console.error('post-alerts', e instanceof Error ? e.message : e)));
  else p.catch((e) => console.error('post-alerts', e instanceof Error ? e.message : e));
}

Deno.serve(async (req) => {
  // Microsoft proves it owns the subscription by sending ?validationToken=...: echo it back as plain text.
  const validation = alertValidationToken(req.url);
  if (validation) return new Response(validation, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const key = Deno.env.get('POST_ALERTS_KEY');
  const encKey = Deno.env.get('ALERTS_ENC_KEY');
  const clientId = Deno.env.get('MS_CLIENT_ID');
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!key || !encKey || !clientId || !vapidPublic || !vapidPrivate) return json({ error: 'not_configured' }, 503);
  const vapid = { publicKey: vapidPublic, privateKey: vapidPrivate, subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com' };

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const accounts = () => admin.from('post_alert_accounts');
  const store: AlertStore = {
    accountBySubscription: async (id) => ((await accounts().select('*').eq('subscription_id', id).maybeSingle()).data as AlertStored | null) ?? null,
    allAccounts: async () => ((await accounts().select('*')).data ?? []) as AlertStored[],
    markSeen: async (accountId, messageId) => {
      const { data } = await admin.from('post_alert_seen').upsert({ account_id: accountId, message_id: messageId }, { onConflict: 'account_id,message_id', ignoreDuplicates: true }).select('message_id');
      return (data ?? []).length > 0;
    },
    update: async (id, patch) => { await accounts().update(patch).eq('id', id); },
    upsertAccount: async (row) => {
      const { data, error } = await accounts().upsert({ ...row, subscription_id: null, subscription_expires_at: null }, { onConflict: 'email' }).select('*').single();
      if (error) throw new Error(error.message);
      return data as AlertStored;
    },
    deleteAccount: async (id) => { await accounts().delete().eq('id', id); },
    devices: async () => ((await admin.from('post_alert_devices').select('id, endpoint, p256dh, auth, lang, badge')).data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string; lang: string; badge: number }[],
    removeDevices: async (ids) => { await admin.from('post_alert_devices').delete().in('id', ids); },
    setBadge: async (id, badge) => { await admin.from('post_alert_devices').update({ badge }).eq('id', id); },
    resetBadge: async (endpoint) => ((await admin.from('post_alert_devices').update({ badge: 0 }).eq('endpoint', endpoint).select('id')).data ?? []).length > 0,
  };
  const deps: AlertDeps = {
    store, fetch, clientId, encKey, now: () => new Date(),
    notificationUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/post-alerts`,
    send: (sub, payload) => sendPush(sub, payload, vapid),
  };

  // From Microsoft: no x-alerts-key header, a body of notifications, authenticated by each mailbox's secret clientState.
  if (req.method === 'POST' && !req.headers.get('x-alerts-key')) {
    const body = await req.json().catch(() => null);
    const states = new Map((await store.allAccounts()).filter((a) => a.subscription_id).map((a) => [a.subscription_id!, a.client_state]));
    if (new URL(req.url).searchParams.get('lifecycle')) later(alertLifecycle(deps, alertParseLifecycle(body, states)));
    else later(alertProcess(deps, alertParseNotifications(body, states)));
    return new Response(null, { status: 202 });
  }

  // From the Post app, the alerts page or the schedule.
  if (!alertSameSecret(req.headers.get('x-alerts-key'), key)) return json({ error: 'unauthorized' }, 401);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }

  try {
    switch (body.op) {
      case 'register': return json(await alertRegister(deps, body as never));
      case 'update': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const patch = alertSettingsPatch(body);
        const { data } = await accounts().update(patch).eq('email', email).select('id');
        return (data ?? []).length ? json({ ok: true }) : json({ error: 'not_found' }, 404);
      }
      case 'unregister': return json({ removed: await alertUnregister(deps, String(body.email ?? '')) });
      case 'status': {
        const list = await store.allAccounts();
        const devices = await store.devices();
        return json({
          devices: devices.length,
          accounts: list.map((a) => ({ email: a.email, label: a.label, mode: a.mode, quiet: a.quiet, vips: a.vips.length, subscription_expires_at: a.subscription_expires_at, last_alert_at: (a as { last_alert_at?: string }).last_alert_at ?? null })),
        });
      }
      case 'seen': return json({ ok: await alertSeen(deps, String(body.endpoint ?? '')) });
      case 'vapid': return json({ publicKey: vapid.publicKey });
      case 'renew': return json({ results: await alertRenewAll(deps) });
      case 'test': return json({ sent: await alertTest(deps) });
      case 'pair': {
        const { endpoint, p256dh, auth, lang } = body;
        if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') return json({ error: 'bad_request' }, 400);
        await admin.from('post_alert_devices').upsert({ endpoint, p256dh, auth, lang: lang === 'nb' ? 'nb' : 'en' }, { onConflict: 'endpoint' });
        return json({ ok: true });
      }
      default: return json({ error: 'bad_request' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'failed' }, 400);
  }
});
