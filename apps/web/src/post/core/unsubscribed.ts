import type { Mail } from './types.ts';

/** How long a sender gets to honour an unsubscribe before more mail from them means they are blocked. */
export const GRACE_DAYS = 3;

/**
 * The first sender who was asked to stop (address -> when) and sent something new after the grace period, or null.
 * Mail that arrived before the request, or inside the grace period, does not count; a flagged mail never triggers it.
 */
export function unsubscribedAgain(mail: Mail[], asked: Record<string, number>, nowMs: number): string | null {
  for (const [addr, at] of Object.entries(asked)) {
    if (nowMs < at + GRACE_DAYS * 86_400_000) continue;
    const limit = new Date(at + GRACE_DAYS * 86_400_000).toISOString();
    if (mail.some((m) => !m.flagged && m.fromAddress.toLowerCase() === addr && m.received > limit)) return addr;
  }
  return null;
}
