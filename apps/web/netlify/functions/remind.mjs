// Netlify function (v2). Two public, read-only links backed by a reminder key made in Settings:
//   /api/remind?key=...&place=IKEA      to-dos at a place        (for a Shortcuts "Arrive" automation)
//   /api/remind?key=...&category=pharmacy   to-dos at any shop of a kind
//   /api/remind?key=...                 weekly digest            (for a Shortcuts "Time of Day" automation)
//   /calendar.ics?key=...               house tasks as a calendar (Calendar app subscription)
// Text answers are empty when there is nothing to say, so a Shortcut can skip the notification.
import { buildIcs, digestText, loadFeed, placeText } from '../lib/feed.mjs';

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];

const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async function handler(req) {
  const url = new URL(req.url);
  const supabaseUrl = env('VITE_SUPABASE_URL') ?? env('SUPABASE_URL');
  const anonKey = env('VITE_SUPABASE_ANON_KEY') ?? env('SUPABASE_ANON_KEY');

  if (url.searchParams.has('ping')) return text(supabaseUrl && anonKey ? 'ok: configured' : 'ok: missing Supabase environment variables');
  if (!supabaseUrl || !anonKey) return text('Not configured.', 500);

  const key = url.searchParams.get('key') ?? '';
  if (!/^hmr_[0-9a-f]{64}$/.test(key)) return text('This reminder link is not valid.', 401);

  const result = await loadFeed({ url: supabaseUrl, anonKey, key });
  if (result.status === 'invalid') return text('This reminder link is not valid (it may have been revoked).', 401);
  if (result.status === 'error') return text('Could not read your data right now. Try again later.', 502);
  const { feed } = result;

  if (url.pathname.endsWith('.ics')) {
    return new Response(buildIcs(feed), {
      status: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="home-memory.ics"', 'Cache-Control': 'no-store' },
    });
  }

  const place = url.searchParams.get('place');
  const category = url.searchParams.get('category');
  const tz = url.searchParams.get('tz') || undefined;
  return text(place || category ? placeText(feed, { place, category }) : digestText(feed, { tz }));
}

export const config = { path: ['/api/remind', '/calendar.ics'] };
