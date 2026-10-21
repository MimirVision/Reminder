// Supabase Edge Function (Deno): Ledger's notifications on your phone and PC, also with Ledger closed (Web Push).
// A schedule calls it every 5 minutes with {"mode":"due"} and the header x-cron-secret; the app calls it with your login for
// {"op":"status"} (the public key, and when the schedule last ran) and {"op":"test"}. Secrets: VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, LEDGER_CRON_SECRET (or CRON_SECRET), VAPID_SUBJECT (optional). Only Ledger's ledger_* tables are read.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { messagesForClaimed, planRun, TEST_MESSAGE, ttlFor, windowDates, type RunRows } from './plan.ts';
import { isGone, isPushEndpoint, sendPush } from './push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Vapid = { publicKey: string; privateKey: string; subject: string };
type Device = { id: string; workspace_id: string; endpoint: string; p256dh: string; auth: string };

/** Reads every row of a query, 1000 at a time. */
async function all(q: () => { range(a: number, b: number): PromiseLike<{ data: unknown[] | null; error: unknown }> }): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 1000) return out;
  }
}

/** Sends one message to some devices; forgets devices the push service says are gone. */
async function deliver(admin: SupabaseClient, devices: Device[], message: unknown, vapid: Vapid, ttl: number) {
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(devices.map(async (d) => {
    if (!isPushEndpoint(d.endpoint)) return;
    try {
      const status = await sendPush(d, message, vapid, ttl);
      if (status >= 200 && status < 300) sent++;
      else if (isGone(status)) gone.push(d.id);
      else console.error('push refused', status);
    } catch (e) {
      console.error('push failed', e instanceof Error ? e.message : e);
    }
  }));
  if (gone.length) await admin.from('ledger_push_devices').delete().in('id', gone);
  return { sent, removed: gone.length };
}

// The scheduled run. Runs as the server (service role), so it is protected by a shared secret instead of a login.
async function runDue(req: Request, vapid: Vapid) {
  const secret = Deno.env.get('LEDGER_CRON_SECRET') ?? Deno.env.get('CRON_SECRET');
  if (!secret) return json({ error: 'not_configured' }, 503);
  if (req.headers.get('x-cron-secret') !== secret) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = Date.now();
  await admin.from('ledger_notify_status').upsert({ id: true, last_run: new Date(now).toISOString() });

  const devices = (await all(() => admin.from('ledger_push_devices').select('id, workspace_id, endpoint, p256dh, auth').order('id'))) as Device[];
  if (devices.length === 0) return json({ due: 0, sent: 0 });
  const ids = [...new Set(devices.map((d) => d.workspace_id))];
  const w = windowDates(now);
  const [workspaces, occurrences, meetings, schedules, clients] = await Promise.all([
    all(() => admin.from('ledger_workspaces').select('id, timezone, settings').in('id', ids).order('id')),
    all(() => admin.from('ledger_occurrences').select('id, workspace_id, client_id, schedule_id, title, due_date, status, notify_days')
      .in('workspace_id', ids).in('status', ['todo', 'in_progress', 'waiting']).gte('due_date', w.from).lte('due_date', w.tasksTo).order('id')),
    all(() => admin.from('ledger_meetings').select('id, workspace_id, client_id, title, meeting_date, start_time, end_time, location, notify_minutes')
      .in('workspace_id', ids).gte('meeting_date', w.from).lte('meeting_date', w.meetingsTo).order('id')),
    all(() => admin.from('ledger_schedules').select('id, workspace_id, notify_days').in('workspace_id', ids).not('notify_days', 'is', null).order('id')),
    all(() => admin.from('ledger_clients').select('id, workspace_id, name').in('workspace_id', ids).order('id')),
  ]);
  const plans = planRun({ workspaces, occurrences, meetings, schedules, clients } as RunRows, now);

  let due = 0, sent = 0, removed = 0;
  for (const plan of plans) {
    due += plan.reminders.length;
    // Claim first: only the keys inserted here are sent, so overlapping runs never announce the same thing twice.
    const { data: claimed, error } = await admin.from('ledger_push_sent')
      .upsert(plan.reminders.map((r) => ({ workspace_id: plan.workspaceId, key: r.key })), { onConflict: 'workspace_id,key', ignoreDuplicates: true })
      .select('key');
    if (error) { console.error('claim failed', error.message); continue; }
    const mine = devices.filter((d) => d.workspace_id === plan.workspaceId);
    for (const m of messagesForClaimed(plan, new Set((claimed ?? []).map((c) => String(c.key))))) {
      const { keys: _keys, ...payload } = m;
      const r = await deliver(admin, mine, payload, vapid, ttlFor(m, now, plan.reminders));
      sent += r.sent; removed += r.removed;
    }
  }
  // The log only has to outlive the reminders it covers.
  if (new Date(now).getUTCHours() === 3 && new Date(now).getUTCMinutes() < 5) {
    await admin.from('ledger_push_sent').delete().lt('sent_at', new Date(now - 90 * 86_400_000).toISOString());
  }
  return json({ due, sent, removed });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return json({ error: 'not_configured' }, 503);
  const vapid = { publicKey, privateKey, subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com' };

  let body: { mode?: string; op?: string; endpoint?: string };
  try { body = await req.clone().json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (body?.mode === 'due') return await runDue(req, vapid);

  // Everything else is for a signed-in person, and row level security decides what they may see.
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user?.id) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (body?.op === 'status') {
    const { data } = await admin.from('ledger_notify_status').select('last_run').maybeSingle();
    return json({ publicKey, lastRun: data?.last_run ?? null });
  }
  if (body?.op === 'test') {
    let q = asCaller.from('ledger_push_devices').select('id, workspace_id, endpoint, p256dh, auth');
    if (typeof body.endpoint === 'string') q = q.eq('endpoint', body.endpoint);
    const { data: devices, error } = await q;
    if (error) return json({ error: 'not_installed' }, 500);
    if (!devices?.length) return json({ sent: 0, removed: 0, devices: 0 });
    return json({ ...(await deliver(admin, devices as Device[], TEST_MESSAGE, vapid, 600)), devices: devices.length });
  }
  return json({ error: 'bad_request' }, 400);
});
