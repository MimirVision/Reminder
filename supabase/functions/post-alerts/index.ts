// Supabase Edge Function (Deno): instant new-mail alerts for the Post mail app. Microsoft calls it when mail arrives; it decides whether the mail
// deserves an alert and sends a Web Push to the Post web app. The Post app signs in through it (Microsoft sign-in, no shared key to type) and then
// proves which mailbox it belongs to with a session secret (header x-post-session).
// Setup: `select post_setup('<Application (client) ID>', 'you@outlook.com')` in the SQL editor stores your Microsoft client ID and the address that may
// sign in. Nothing else has to be set. Supabase secrets still work and win when present: MS_CLIENT_ID, POST_ALLOWED_EMAILS, ALERTS_ENC_KEY (otherwise derived
// from the service role key), VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (otherwise made once and kept in the database), POST_ALERTS_KEY.
// Deploy with "Verify JWT" OFF: Microsoft and the schedule cannot send a Supabase login. The webhook is protected by a secret clientState per mailbox.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush } from '../notify-partner/logic.ts';
import { ALERT_SMART, alertParseTaught, alertResolveConfig, alertRulesDigest, alertStatusRow, alertTaughtPatch, alertFindBySession, alertSigninFinish, alertSigninForget, alertSigninPoll, alertSigninStart, alertLifecycle, alertMintToken, alertPublicConfig, alertParseLifecycle, alertParseNotifications, alertProcess, alertRegister, alertRenewAll, alertSameSecret, alertSeen, alertSettingsPatch, alertTest, alertUnregister, alertValidationToken, type AlertConfigStore, type AlertDeps, type AlertStore, type AlertStored, type AlertTaught } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-alerts-key, x-post-session',
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

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const functionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/post-alerts`;
  const configStore: AlertConfigStore = {
    load: async () => {
      // What the phones taught the server is kept in this table too (one row per mailbox, "taught:<id>"): not settings, so not read here.
      // Should the database refuse that filter, everything is read and those rows are left out below: the settings must always load.
      let read = await admin.from('post_config').select('key, value').not('key', 'like', 'taught:%');
      if (read.error) read = await admin.from('post_config').select('key, value');
      if (read.error) throw new Error(read.error.message);
      return Object.fromEntries(((read.data ?? []) as { key: string; value: string }[]).filter((r) => !r.key.startsWith('taught:')).map((r) => [r.key, r.value]));
    },
    putIfMissing: async (k, v) => { await admin.from('post_config').upsert({ key: k, value: v }, { onConflict: 'key', ignoreDuplicates: true }); },
    put: async (k, v) => { await admin.from('post_config').upsert({ key: k, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' }); },
  };
  const cfg = await alertResolveConfig((k) => Deno.env.get(k), configStore, functionUrl);
  if (!cfg.clientId || !cfg.encKey) {
    return json({ error: 'not_configured', message: 'Post\u2019s server has no Microsoft client ID yet. In the Supabase SQL editor run: select post_setup(\'<client id>\', \'you@outlook.com\');' }, 503);
  }
  const vapid = cfg.vapid ? { ...cfg.vapid, subject: Deno.env.get('VAPID_SUBJECT') ?? `mailto:${cfg.allowedEmails[0] ?? 'admin@example.com'}` } : null;
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
    deleteAccount: async (id) => { await accounts().delete().eq('id', id); await admin.from('post_config').delete().eq('key', `taught:${id}`); },
    getTaught: async (id): Promise<AlertTaught> => {
      try { return alertParseTaught(((await admin.from('post_config').select('value').eq('key', `taught:${id}`).maybeSingle()).data as { value: string } | null)?.value); } catch { return alertParseTaught(null); }
    },
    setTaught: async (id, taught) => {
      const { error } = await admin.from('post_config').upsert({ key: `taught:${id}`, value: JSON.stringify(taught), updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    devices: async () => ((await admin.from('post_alert_devices').select('id, endpoint, p256dh, auth, lang, badge')).data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string; lang: string; badge: number }[],
    removeDevices: async (ids) => { await admin.from('post_alert_devices').delete().in('id', ids); },
    setBadge: async (id, badge) => { await admin.from('post_alert_devices').update({ badge }).eq('id', id); },
    putSignin: async (handle, enc) => { await admin.from('post_signins').upsert({ handle, result_enc: enc, created_at: new Date().toISOString() }, { onConflict: 'handle' }); },
    takeSignin: async (handle) => {
      const { data } = await admin.from('post_signins').delete().eq('handle', handle).select('result_enc');
      return ((data ?? [])[0] as { result_enc: string } | undefined)?.result_enc ?? null;
    },
    pruneSignins: async (beforeIso) => { await admin.from('post_signins').delete().lt('created_at', beforeIso); },
    resetBadge: async (endpoint) => ((await admin.from('post_alert_devices').update({ badge: 0 }).eq('endpoint', endpoint).select('id')).data ?? []).length > 0,
  };
  const deps: AlertDeps = {
    store, fetch, clientId: cfg.clientId, encKey: cfg.encKey, now: () => new Date(),
    allowedEmails: cfg.allowedEmails,
    notificationUrl: functionUrl,
    send: async (sub, payload) => { if (!vapid) throw new Error('push is not set up'); return await sendPush(sub, payload, vapid); },
    log: (line) => console.log('post-alerts:', line),
  };

  let body: Record<string, any> | null = null;
  if (req.method === 'POST') body = await req.json().catch(() => null);

  // From Microsoft: a body of notifications (no "op"), authenticated by each mailbox's secret clientState.
  if (req.method === 'POST' && body && typeof body.op !== 'string') {
    const states = new Map((await store.allAccounts()).filter((a) => a.subscription_id).map((a) => [a.subscription_id!, a.client_state]));
    if (new URL(req.url).searchParams.get('lifecycle')) later(alertLifecycle(deps, alertParseLifecycle(body, states)));
    else later(alertProcess(deps, alertParseNotifications(body, states)));
    return new Response(null, { status: 202 });
  }
  if (!body) return json({ error: 'bad_request' }, 400);

  try {
    // Open to everyone (they reveal nothing and cannot do anything without a Microsoft sign-in the allowed list accepts).
    switch (body.op) {
      case 'config': return json(alertPublicConfig(deps));
      case 'vapid': return vapid ? json({ publicKey: vapid.publicKey }) : json({ error: 'push_not_configured' }, 503);
      case 'signin_start': return json(await alertSigninStart(deps, { redirectUri: String(body.redirectUri ?? ''), hint: typeof body.hint === 'string' ? body.hint : undefined }));
      case 'signin_finish': return json(await alertSigninFinish(deps, { code: String(body.code ?? ''), state: String(body.state ?? ''), label: typeof body.label === 'string' ? body.label : undefined }));
      case 'signin_poll': return json(await alertSigninPoll(deps, String(body.handle ?? '')));
      case 'signin_forget': await alertSigninForget(deps, String(body.handle ?? '')); return json({ ok: true });
    }

    // Everything else: either a session from a signed-in phone or computer (its own mailbox only), or the admin key (the schedule).
    const sent = req.headers.get('x-alerts-key');
    const admin_ok = !!sent && cfg.adminKeys.some((k) => alertSameSecret(sent, k));
    const me = admin_ok ? null : await alertFindBySession(store, req.headers.get('x-post-session'));
    if (!admin_ok && !me) return json({ error: 'unauthorized' }, 401);
    const emailOf = () => (me ? me.email : String(body!.email ?? '').trim().toLowerCase());

    switch (body.op) {
      case 'token': return json(await alertMintToken(deps, emailOf()));
      case 'update': {
        const patch = alertSettingsPatch(body);
        const { data } = await accounts().update(patch).eq('email', emailOf()).select('id');
        return (data ?? []).length ? json({ ok: true }) : json({ error: 'not_found' }, 404);
      }
      case 'unregister': return json({ removed: await alertUnregister(deps, emailOf()) });
      case 'status': {
        const devices = await store.devices();
        const list = me ? [me] : await store.allAccounts();
        // Opening Post is also a good moment to renew alerts that are about to lapse (does nothing when none is due).
        if (me) later(alertRenewAll(deps));
        return json({
          smart: ALERT_SMART, // this copy of the function can follow the Primary tab
          devices: devices.length,
          accounts: await Promise.all(list.map(async (a) => alertStatusRow(a, await store.getTaught(a.id)))),
        });
      }
      // What only the phone knows (the senders it moved to another tab, and what else counts besides Primary mail), so that alerts follow the Primary tab.
      case 'taught': {
        const mine = me ?? (await store.allAccounts()).find((x) => x.email === emailOf());
        if (!mine) return json({ error: 'not_found' }, 404);
        const next = alertTaughtPatch(await store.getTaught(mine.id), body);
        await store.setTaught(mine.id, next);
        return json({ ok: true, extra: next.extra, rules_digest: alertRulesDigest(next) });
      }
      case 'seen': return json({ ok: await alertSeen(deps, String(body.endpoint ?? '')) });
      case 'test': return json({ sent: await alertTest(deps) });
      case 'pair': {
        const { endpoint, p256dh, auth, lang } = body;
        if (!vapid) return json({ error: 'push_not_configured' }, 503);
        if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') return json({ error: 'bad_request' }, 400);
        await admin.from('post_alert_devices').upsert({ endpoint, p256dh, auth, lang: lang === 'nb' ? 'nb' : 'en' }, { onConflict: 'endpoint' });
        return json({ ok: true });
      }
      // Admin only: used by the schedule and by hand.
      case 'register': return admin_ok ? json(await alertRegister(deps, body as never)) : json({ error: 'unauthorized' }, 401);
      case 'renew': return admin_ok ? json({ results: await alertRenewAll(deps) }) : json({ error: 'unauthorized' }, 401);
      default: return json({ error: 'bad_request' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'failed' }, 400);
  }
});
