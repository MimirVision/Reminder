import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

const DEMO_KEY = 'ledger-mode';

/** Demo mode when no Supabase project is configured, or when the person chose to explore the demo. */
export function wantsDemo(): boolean {
  if (!supabaseConfigured) return true;
  if (new URLSearchParams(location.search).has('demo')) return true;
  try { return localStorage.getItem(DEMO_KEY) === 'demo'; } catch { return false; }
}

export function setDemoChoice(demo: boolean) {
  try { if (demo) localStorage.setItem(DEMO_KEY, 'demo'); else localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Supabase is not configured');
  // A storage key of its own, so Ledger's sign-in never collides with Home Memory or Post on the same domain.
  client ??= createClient(url!, key!, { auth: { storageKey: 'ledger-auth', persistSession: true, autoRefreshToken: true } });
  return client;
}

/** True when an error means Ledger's tables or functions are not installed in this project yet. */
export function isNotInstalled(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(err?.code ?? '') || /ledger_\w+.*(does not exist|schema cache)/.test(err?.message ?? '');
}
