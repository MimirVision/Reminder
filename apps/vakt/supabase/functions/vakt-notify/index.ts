// Supabase Edge Function (Deno): Vakt's reminders on the phone, also with the app closed (Web Push).
// A schedule calls it every 15 minutes with {"mode":"due"} and the header x-cron-secret; the app calls it with the
// person's login for {"op":"status"} (the public key) and {"op":"test"}. Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAKT_CRON_SECRET (or CRON_SECRET), VAPID_SUBJECT (optional). Only Vakt's vakt_* tables are read.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { planOwner, shiftsFrom, TEST_MESSAGE, type OwnerRows } from './plan.ts';
import type { Employer, Shift, Supplement } from '../../../src/lib/types.ts';
import { isGone, isPushEndpoint, sendPush } from './push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Vapid = { publicKey: string; privateKey: string; subject: string };
type Device = { id: string; owner_id: string; endpoint: string; p256dh: string; auth: string };

async function deliver(admin: SupabaseClient, devices: Device[], message: unknown, vapid: Vapid) {
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(devices.map(async (d) => {
    if (!isPushEndpoint(d.endpoint)) return;
    try {
      const status = await sendPush(d, message, vapid, 6 * 3600);
      if (status >= 200 && status < 300) sent++;
      else if (isGone(status)) gone.push(d.id);
      else console.error('push refused', status);
    } catch (e) {
      console.error('push failed', e instanceof Error ? e.message : e);
    }
  }));
  if (gone.length) await admin.from('vakt_push_devices').delete().in('id', gone);
  return sent;
}

async function runDue(req: Request, vapid: Vapid) {
  const secret = Deno.env.get('VAKT_CRON_SECRET') ?? Deno.env.get('CRON_SECRET');
  if (!secret) return json({ error: 'not_configured' }, 503);
  if (req.headers.get('x-cron-secret') !== secret) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = Date.now();
  await admin.from('vakt_notify_status').upsert({ id: true, last_run: new Date(now).toISOString() });

  const { data: devices, error } = await admin.from('vakt_push_devices').select('id, owner_id, endpoint, p256dh, auth');
  if (error) return json({ error: 'not_installed' }, 500);
  if (!devices?.length) return json({ due: 0, sent: 0 });
  const owners: string[] = [...new Set((devices as Device[]).map((d) => d.owner_id))];
  const [profiles, employers, supplements, shifts] = await Promise.all([
    admin.from('vakt_profiles').select('owner_id, settings').in('owner_id', owners),
    admin.from('vakt_employers').select('*').in('owner_id', owners),
    admin.from('vakt_supplements').select('*').in('owner_id', owners),
    admin.from('vakt_shifts').select('*').in('owner_id', owners).gte('date', shiftsFrom(now)).order('date'),
  ]);
  type Row = Record<string, unknown> & { owner_id: string };
  const of = (rows: unknown[] | null, id: string) => ((rows ?? []) as Row[]).filter((r) => r.owner_id === id);

  let due = 0, sent = 0;
  for (const ownerId of owners) {
    const rows: OwnerRows = {
      ownerId,
      settings: (of(profiles.data, ownerId)[0]?.settings ?? null) as Record<string, unknown> | null,
      employers: of(employers.data, ownerId) as unknown as Employer[],
      supplements: of(supplements.data, ownerId).map((x) => ({ ...x, amount: Number(x.amount), min_per_hour: x.min_per_hour === null ? null : Number(x.min_per_hour) })) as unknown as Supplement[],
      shifts: of(shifts.data, ownerId) as unknown as Shift[],
    };
    const messages = planOwner(rows, now);
    due += messages.length;
    if (!messages.length) continue;
    // Claim first: only keys inserted now are sent, so overlapping runs never send the same reminder twice.
    const { data: claimed } = await admin.from('vakt_push_sent')
      .upsert(messages.map((m) => ({ owner_id: ownerId, key: m.key })), { onConflict: 'owner_id,key', ignoreDuplicates: true })
      .select('key');
    const mine = (devices as Device[]).filter((d) => d.owner_id === ownerId);
    const won = new Set(((claimed ?? []) as { key: string }[]).map((c) => c.key));
    for (const m of messages.filter((x) => won.has(x.key))) {
      const { key: _key, ...payload } = m;
      sent += await deliver(admin, mine, payload, vapid);
    }
  }
  await admin.from('vakt_push_sent').delete().lt('sent_at', new Date(now - 60 * 86_400_000).toISOString());
  return json({ due, sent });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return json({ error: 'not_configured' }, 503);
  const vapid = { publicKey, privateKey, subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com' };

  let body: { mode?: string; op?: string };
  try { body = await req.clone().json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (body?.mode === 'due') return await runDue(req, vapid);

  // Everything else is for a signed-in person; row level security decides what they may see.
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user?.id) return json({ error: 'unauthorized' }, 401);

  if (body?.op === 'status') {
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data } = await admin.from('vakt_notify_status').select('last_run').maybeSingle();
    return json({ publicKey, lastRun: data?.last_run ?? null });
  }
  if (body?.op === 'test') {
    const { data: devices, error } = await asCaller.from('vakt_push_devices').select('id, owner_id, endpoint, p256dh, auth');
    if (error) return json({ error: 'not_installed' }, 500);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    return json({ sent: await deliver(admin, (devices ?? []) as Device[], TEST_MESSAGE, vapid), devices: devices?.length ?? 0 });
  }
  return json({ error: 'bad_request' }, 400);
});
