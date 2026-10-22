import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

const DEMO_KEY = 'vakt-mode';

/** Local mode when no Supabase project is configured (development, tests), or when chosen with ?demo. */
export function wantsLocal(): boolean {
  if (!supabaseConfigured) return true;
  if (new URLSearchParams(location.search).has('demo')) return true;
  try { return localStorage.getItem(DEMO_KEY) === 'demo'; } catch { return false; }
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Supabase is not configured');
  // A storage key of its own, so Vakt's sign-in never collides with the other apps on the same domain.
  client ??= createClient(url!, key!, { auth: { storageKey: 'vakt-auth', persistSession: true, autoRefreshToken: true } });
  return client;
}

/** True when an error means Vakt's tables are not installed in this project yet. */
export function isNotInstalled(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(err?.code ?? '') || /vakt_\w+.*(does not exist|schema cache)/.test(err?.message ?? '');
}

export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Får ikke kontakt med serveren. Sjekk nettet og prøv igjen.';
  if (/JWT|session|not authenticated/i.test(msg)) return 'Du er logget ut. Logg inn igjen.';
  return msg;
}
