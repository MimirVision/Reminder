// Supabase Edge Function (Deno): reads a roster (GAT, or any other) from a photo, screenshot or PDF and returns the
// person's shifts and days off as plain data. It only reads: the app shows the result for her to check, and saves
// nothing until she says so. One file, to paste into the dashboard as a function named "vakt-import".
// Secrets: ANTHROPIC_API_KEY (required; the one Home Memory uses), ANTHROPIC_MODEL (optional, default claude-opus-5-5).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MAX_BASE64 = 7_000_000; // about 5 MB of file
const DAILY = 20;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'entries'],
  properties: {
    found: { type: 'boolean', description: 'Whether the person’s own shifts could be found in the roster.' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'code', 'start', 'end', 'kind'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          code: { type: 'string', description: 'The code in the roster cell exactly as written (D, A, N, K2, FE, F …), or "" if none.' },
          start: { type: 'string', description: 'HH:MM, or "" if the roster does not give a time for this cell or its code.' },
          end: { type: 'string', description: 'HH:MM, or "".' },
          kind: { type: 'string', enum: ['shift', 'ferie', 'fri', 'avspasering', 'syk', 'annet'] },
        },
      },
    },
  },
};

function system(name: string, hint: string) {
  return `You read Norwegian work rosters (turnus), usually from GAT (also MinGat, Visma, Tidsbanken) or printed plans in
health care, and return one person's shifts and absences as data.

The person: ${name ? `"${name}". Find her row or column (names may be "Etternavn, Fornavn", initials or an employee number next to the name). Use only that person's cells. If you cannot find her, set found=false and return no entries.` : 'the only person in the roster. If several people are shown and none is marked as the viewer, set found=false.'}
${hint}

For every day that has something in her cell, return one entry:
- date as YYYY-MM-DD. Read the month and year from the roster; if the year is not shown, use the hint above.
- code: the text in the cell as written (for example D, A, K, N, M, D1, A2, N8, FE, F, AV, S).
- start/end: times in 24-hour HH:MM if the cell shows them, or if a legend/explanation on the page gives the times for
  that code. Never guess times that are not on the page; leave them "" instead.
- kind: shift for a working shift; ferie for holiday (FE, FER, Ferie); fri for a day off (F, FRI, /, X when meaning off);
  avspasering (AV, AVSP); syk (S, SYK, egenmelding, sykemelding); annet for anything else that isn't a shift
  (kurs without times, permisjon …).
Leave out empty days. A night shift belongs to the date it starts. Do not invent entries.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await db.auth.getUser();
  if (!who?.user?.id) return json({ error: 'unauthorized' }, 401);

  let body: { op?: string; data?: string; mediaType?: string; name?: string; month?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  // The app asks first whether import is switched on, to show the button or explain what is missing.
  if (body.op === 'status') return json({ ready: Boolean(apiKey) });
  if (!apiKey) return json({ error: 'not_configured' }, 503);

  const mediaType = body.mediaType;
  if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.data.slice(0, 200))) return json({ error: 'bad_request' }, 400);
  if (body.data.length > MAX_BASE64) return json({ error: 'too_large' }, 413);
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mediaType ?? '')) return json({ error: 'bad_type' }, 415);

  const { data: allowed } = await db.rpc('vakt_ai_take', { p_fn: 'import', p_limit: DAILY });
  if (allowed === false) return json({ error: 'limit' }, 429);

  const name = String(body.name ?? '').slice(0, 80);
  const month = /^\d{4}-\d{2}$/.test(body.month ?? '') ? body.month! : '';
  const hint = month ? `Hint: the roster is most likely for ${month} or the weeks around it (year ${month.slice(0, 4)}).` : '';
  const file = mediaType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: body.data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: body.data } };

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5',
      max_tokens: 8000,
      system: system(name, hint),
      messages: [{ role: 'user', content: [file, { type: 'text', text: 'Read the roster and return the entries.' }] }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    });
    if (res.stop_reason !== 'end_turn') return json({ error: 'unreadable' }, 502);
    const block = res.content.find((b) => b.type === 'text');
    const out = block && block.type === 'text' ? JSON.parse(block.text) : null;
    if (!out) return json({ error: 'unreadable' }, 422);
    return json({ found: Boolean(out.found), entries: Array.isArray(out.entries) ? out.entries.slice(0, 200) : [] });
  } catch (e) {
    console.error('vakt-import failed', e instanceof Error ? e.message : e);
    return json({ error: 'model_error' }, 502);
  }
});
