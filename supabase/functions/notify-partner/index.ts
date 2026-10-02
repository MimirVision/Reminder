// Supabase Edge Function (Deno): tells the other household members' phones that you added to-dos (Web Push).
// Called by the web app with the user's JWT right after adding. Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (required),
// VAPID_SUBJECT (optional, default mailto:admin@example.com). SUPABASE_SERVICE_ROLE_KEY is provided by Supabase.
// A schedule also calls it with {"mode":"due"} and the header x-cron-secret (secret CRON_SECRET) to send reminders at due times.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildDueMessage, buildMessage, dueNow, isGone, recipientsFor, sendPush, type DueMemory } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Reminders at the due time. Runs as the server (service role), so it is protected by a shared secret instead of a login.
async function sendDue(req: Request, vapid: { publicKey: string; privateKey: string; subject: string }) {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return json({ error: 'not_configured' }, 503);
  if (req.headers.get('x-cron-secret') !== secret) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const tz = Deno.env.get('HOME_TZ') ?? 'Europe/Oslo';
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const { data: rows } = await admin.from('memories').select('id, household_id, body, due_on, due_time, assignee_id')
    .eq('status', 'active').not('due_time', 'is', null).gte('due_on', day(-1)).lte('due_on', day(1));
  const due = dueNow((rows ?? []) as DueMemory[], new Date(), tz);
  if (due.length === 0) return json({ due: 0, sent: 0 });

  // Claim them first: only the ones inserted here are sent, so overlapping runs never announce twice.
  const { data: claimed } = await admin.from('due_pushes').upsert(due.map((m) => ({ memory_id: m.id })), { onConflict: 'memory_id', ignoreDuplicates: true }).select('memory_id');
  const fresh = due.filter((m) => (claimed ?? []).some((c) => c.memory_id === m.id));
  if (fresh.length === 0) return json({ due: due.length, sent: 0 });

  const { data: members } = await admin.from('household_members').select('household_id, user_id').in('household_id', [...new Set(fresh.map((m) => m.household_id))]);
  const byUser = new Map<string, string[]>();
  for (const m of fresh) {
    const ids = (members ?? []).filter((x) => x.household_id === m.household_id).map((x) => x.user_id);
    for (const u of recipientsFor(m, ids)) byUser.set(u, [...(byUser.get(u) ?? []), m.body]);
  }
  const { data: subs } = await admin.from('web_push_subscriptions').select('id, user_id, endpoint, p256dh, auth, lang').in('user_id', [...byUser.keys()]);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      const status = await sendPush(s, buildDueMessage(s.lang === 'nb' ? 'nb' : 'en', byUser.get(s.user_id) ?? []), vapid);
      if (status >= 200 && status < 300) sent++;
      else if (isGone(status)) gone.push(s.id);
    } catch (e) {
      console.error('due push failed', e instanceof Error ? e.message : e);
    }
  }));
  if (gone.length) await admin.from('web_push_subscriptions').delete().in('id', gone);
  return json({ due: fresh.length, sent, removed: gone.length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return json({ error: 'not_configured' }, 503);
  const vapid = { publicKey, privateKey, subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com' };

  const mode = await req.clone().json().then((b: { mode?: string }) => b?.mode).catch(() => undefined);
  if (mode === 'due') return await sendDue(req, vapid);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asCaller.auth.getUser();
  const me = who?.user?.id;
  if (!me) return json({ error: 'unauthorized' }, 401);

  let ids: string[];
  try {
    const body = await req.json();
    ids = Array.isArray(body.memory_ids) ? body.memory_ids.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [];
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (ids.length === 0) return json({ error: 'bad_request' }, 400);

  // Row level security decides what the caller may see; only their own fresh to-dos are announced.
  const { data: memories } = await asCaller.from('memories').select('id, household_id, body, author_id, created_at, assignee_id').in('id', ids);
  const fresh = (memories ?? []).filter((m) => m.author_id === me && Date.now() - new Date(m.created_at).getTime() < 10 * 60_000);
  if (fresh.length === 0) return json({ sent: 0, removed: 0 });
  const householdId = fresh[0].household_id;
  const mine = fresh.filter((m) => m.household_id === householdId);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: members } = await admin.from('household_members').select('user_id, display_name').eq('household_id', householdId);
  const others = (members ?? []).filter((m) => m.user_id !== me).map((m) => m.user_id);
  if (others.length === 0) return json({ sent: 0, removed: 0 });
  const name = (members ?? []).find((m) => m.user_id === me)?.display_name ?? '';
  const { data: subs } = await admin.from('web_push_subscriptions').select('id, user_id, endpoint, p256dh, auth, lang').in('user_id', others);

  let sent = 0;
  const gone: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    // Something given to the writer themselves is not for the partner; something given to this person says so.
    const relevant = mine.filter((m) => !m.assignee_id || m.assignee_id === s.user_id);
    if (relevant.length === 0) return;
    try {
      const forYou = relevant.every((m) => m.assignee_id === s.user_id);
      const status = await sendPush(s, buildMessage(s.lang === 'nb' ? 'nb' : 'en', name, relevant.map((m) => m.body), forYou), vapid);
      if (status >= 200 && status < 300) sent++;
      else if (isGone(status)) gone.push(s.id);
    } catch (e) {
      console.error('push failed', e instanceof Error ? e.message : e);
    }
  }));
  if (gone.length) await admin.from('web_push_subscriptions').delete().in('id', gone);
  return json({ sent, removed: gone.length });
});
