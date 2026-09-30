// Sharing into the app (Web Share Target): the OS opens /?share=1&title=…&text=…&url=… . Turn that into to-do text.

/** One clean line or two: the shared text, the title if it adds something, and the link. Empty when nothing usable. */
export function shareToText(search: string): string {
  const p = new URLSearchParams(search);
  if (!hasShare(search)) return '';
  const clean = (s: string | null) => (s ?? '').trim();
  const title = clean(p.get('title')), text = clean(p.get('text')), url = clean(p.get('url'));
  const parts: string[] = [];
  // Many apps put the link in `text` as well; do not repeat what is already there.
  const body = text || title;
  if (body) parts.push(body);
  if (title && text && !text.includes(title)) parts.unshift(title);
  if (url && !parts.some((x) => x.includes(url))) parts.push(url);
  return parts.join('\n').slice(0, 1000);
}

// Chromium replaces the query of the manifest's action with title/text/url, so any of those means "shared".
export const hasShare = (search: string) => ['share', 'title', 'text', 'url'].some((k) => new URLSearchParams(search).has(k));
