// Supabase Edge Function (Deno): turns free text into a list of to-dos (the "Smart add" in the add sheet). Called with the user's JWT.
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional, default claude-opus-5-5).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseTasksWith, SCHEMA, type PlaceInfo } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'not_configured' }, 503);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });

  let body: { household_id?: string; text?: string; lang?: string; today?: string; partner?: string; probe?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  // The app asks once whether the AI reader is set up, so it only offers the button when it will work.
  if (body.probe === true) return json({ ok: true });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!body.household_id || !text || !/^\d{4}-\d{2}-\d{2}$/.test(body.today ?? '')) return json({ error: 'bad_request' }, 400);
  const today = body.today as string;

  // Row level security: only a member can read the household's places.
  const { data: places, error } = await db.from('places').select('id, name, kind, category').eq('household_id', body.household_id);
  if (error) return json({ error: 'not_found' }, 404);

  const { data: allowed } = await db.rpc('ai_take', { p_fn: 'parse-tasks', p_limit: 60 });
  if (allowed === false) return json({ error: 'limit' }, 429);

  const client = new Anthropic({ apiKey });
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${today}T00:00:00Z`));
  try {
    const tasks = await parseTasksWith(
      text,
      { today, weekday, lang: body.lang === 'nb' ? 'nb' : 'en', partner: typeof body.partner === 'string' ? body.partner.slice(0, 60) : null, places: (places ?? []) as PlaceInfo[] },
      async (system, user) => {
        const res = await client.messages.create({
          model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        });
        if (res.stop_reason !== 'end_turn') return null;
        const block = res.content.find((b) => b.type === 'text');
        return block && block.type === 'text' ? block.text : null;
      },
    );
    return json({ tasks });
  } catch (e) {
    console.error('parse-tasks failed', e instanceof Error ? e.message : e);
    return json({ error: 'model_error' }, 502);
  }
});
