// Tags: short labels like #errands or #kids on a to-do. Pure, unit tested.
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 24;

/** "#Barn " becomes "barn". Letters, digits, - and _ only; empty when nothing usable is left. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLocaleLowerCase('nb').replace(/[^\p{L}\p{N}_-]+/gu, '').slice(0, MAX_TAG_LENGTH);
}

/** Adds one or more tags (separated by space or comma), no duplicates, at most MAX_TAGS. */
export function addTags(list: readonly string[], raw: string): string[] {
  const out = [...list];
  for (const part of raw.split(/[\s,]+/)) {
    const tag = normalizeTag(part);
    if (tag && !out.includes(tag) && out.length < MAX_TAGS) out.push(tag);
  }
  return out;
}

export const removeTag = (list: readonly string[], tag: string): string[] => list.filter((t) => t !== tag);

const TAG_IN_TEXT = /(^|\s)#([\p{L}][\p{L}\p{N}_-]{0,23})(?=$|[\s.,;:!?])/gu;

/** Pulls "#tag" words out of a sentence. "Buy milk #errands" gives the text "Buy milk" and ["errands"]. */
export function extractTags(text: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const rest = text.replace(TAG_IN_TEXT, (_m, lead: string, tag: string) => { const n = normalizeTag(tag); if (n && !tags.includes(n)) tags.push(n); return lead; });
  return { text: rest.replace(/\s{2,}/g, ' ').trim(), tags: tags.slice(0, MAX_TAGS) };
}

/** Every tag in use, the most used first (then A to Z). */
export function allTags(list: readonly { tags?: string[] | null }[]): { tag: string; count: number }[] {
  const c = new Map<string, number>();
  for (const m of list) for (const t of m.tags ?? []) c.set(t, (c.get(t) ?? 0) + 1);
  return [...c].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'nb'));
}
