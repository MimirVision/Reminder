// Supabase Edge Function (Deno): suggests a place for a to-do. Called by the apps with the user's JWT.
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional, default claude-opus-5-5).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SCHEMA, suggestFor, type PlaceInfo } from './logic.ts';

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
  // Everything is read and written as the caller, so row level security decides what they may touch.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });

  let memoryId: string | undefined;
  try {
    memoryId = (await req.json()).memory_id;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!memoryId) return json({ error: 'bad_request' }, 400);

  const { data: memory, error } = await db
    .from('memories')
    .select('id, household_id, body, place_id, suggestion, suggested_at')
    .eq('id', memoryId)
    .maybeSingle();
  if (error || !memory) return json({ error: 'not_found' }, 404);
  if (memory.suggested_at || memory.place_id) return json({ suggestion: memory.suggestion ?? null });

  const { data: places } = await db.from('places').select('id, name, kind, category').eq('household_id', memory.household_id);

  const client = new Anthropic({ apiKey });
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
  let suggestion = null;
  try {
    suggestion = await suggestFor(memory.body, (places ?? []) as PlaceInfo[], async (system, user) => {
      const res = await client.messages.create({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: user }],
        // Small classification: low effort is enough. Structured output guarantees parseable JSON.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      });
      // A refusal or truncated answer simply means "no suggestion".
      if (res.stop_reason !== 'end_turn') return null;
      const block = res.content.find((b) => b.type === 'text');
      return block && block.type === 'text' ? block.text : null;
    });
  } catch (e) {
    console.error('suggest failed', e instanceof Error ? e.message : e);
    return json({ error: 'model_error' }, 502);
  }

  // Record that we asked (even when there is no suggestion) so this to-do never costs a second call.
  await db.from('memories').update({ suggestion, suggested_at: new Date().toISOString() }).eq('id', memory.id);
  return json({ suggestion });
});
