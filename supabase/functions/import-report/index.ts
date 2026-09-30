// Supabase Edge Function (Deno): reads an uploaded tilstandsrapport PDF and returns structured findings.
// The PDF is read from the private `media` bucket as the caller (row level security decides access).
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional, default claude-opus-5-5).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import { clean, SCHEMA, SYSTEM } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MAX_BYTES = 25 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'not_configured' }, 503);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });

  let path: string | undefined;
  try {
    path = (await req.json()).path;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!path || !/^[0-9a-f-]{36}\/reports\/[\w.-]+\.pdf$/i.test(path)) return json({ error: 'bad_request' }, 400);

  const { data: file, error } = await db.storage.from('media').download(path);
  if (error || !file) return json({ error: 'not_found' }, 404);
  if (file.size > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  const client = new Anthropic({ apiKey });
  try {
    // Long documents: stream and take the final message so the request does not hit an HTTP timeout.
    const stream = client.messages.stream({
      model: Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5',
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: 'Extract the findings from this condition report.' },
        ],
      }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    });
    const res = await stream.finalMessage();
    if (res.stop_reason !== 'end_turn') return json({ error: 'incomplete', stop_reason: res.stop_reason }, 502);
    const block = res.content.find((b) => b.type === 'text');
    const parsed = block && block.type === 'text' ? clean(JSON.parse(block.text)) : null;
    if (!parsed) return json({ error: 'unreadable' }, 502);
    return json({ report: parsed });
  } catch (e) {
    console.error('import-report failed', e instanceof Error ? e.message : e);
    return json({ error: 'model_error' }, 502);
  }
});
