// "One tap unsubscribe" from the List-Unsubscribe header. A browser cannot send the RFC 8058 one-click POST to another site (CORS),
// so https links open in a new tab and mailto links are sent from the account by Post itself.

export interface Unsub { https: string | null; mailto: { to: string; subject: string; body: string } | null; oneClick: boolean }

export function parseUnsubscribe(headers: { name: string; value: string }[] | undefined): Unsub | null {
  const get = (n: string) => headers?.find((h) => h.name.toLowerCase() === n)?.value;
  const raw = get('list-unsubscribe');
  if (!raw) return null;
  const urls = [...raw.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const https = urls.find((u) => /^https:\/\//i.test(u)) ?? null;
  const mail = urls.find((u) => /^mailto:/i.test(u));
  let mailto: Unsub['mailto'] = null;
  if (mail) {
    const [addr, qs = ''] = mail.slice(7).split('?');
    const q = new URLSearchParams(qs);
    const to = decodeURIComponent(addr);
    if (/^[^\s@]+@[^\s@]+$/.test(to)) mailto = { to, subject: q.get('subject') || 'unsubscribe', body: q.get('body') || 'unsubscribe' };
  }
  if (!https && !mailto) return null;
  return { https, mailto, oneClick: /one-click/i.test(get('list-unsubscribe-post') ?? '') };
}
