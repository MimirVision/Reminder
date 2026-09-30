// Search across open to-dos: every word you type must appear in the text, the place name or the date words. Accent and case
// insensitive ("kafe" finds "Café"). Pure, unit tested.

const norm = (s: string) => s.toLocaleLowerCase('nb').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function matchTodos<M extends { body: string; place_id: string | null; due_on?: string | null }>(
  memories: M[], query: string, placeName: (id: string | null) => string | undefined, dueText: (m: M) => string = () => '',
): M[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return memories.filter((m) => {
    const hay = norm(`${m.body} ${placeName(m.place_id) ?? ''} ${dueText(m)}`);
    return words.every((w) => hay.includes(w));
  });
}
