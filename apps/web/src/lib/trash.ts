// "Recently deleted": to-dos stay for 30 days after they are deleted. Pure helpers, unit tested.
export const TRASH_DAYS = 30;

/** Whole days since it was deleted (0 = today). */
export function daysSince(iso: string | undefined, now = new Date()): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

/** Deleted most recently first. */
export const newestFirst = <T extends { updated_at?: string; created_at: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));
