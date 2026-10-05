// Turns a message body into something safe to show. Defence in depth: (1) the iframe it goes in is sandboxed with NO scripts, (2) a
// Content-Security-Policy inside the page allows no scripts and, by default, no remote images (which is what tracking pixels are),
// (3) the obvious dangerous tags are removed here too.

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function textToHtml(text: string): string {
  const safe = escapeHtml(text);
  return safe.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, '<a href="$1">$1</a>').replace(/\r?\n/g, '<br>');
}

/** True if the message pulls pictures from the internet (so the "load images" bar is worth showing). */
export function hasRemoteImages(html: string): boolean {
  return /<img\b[^>]*\bsrc\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html) || /\bbackground\s*=\s*["']?https?:/i.test(html);
}

export function stripDangerous(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(iframe|object|embed|applet|form|base|link)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(refresh|content-security-policy)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"');
}

/** Replaces `cid:` picture references with the inline attachment data (already fetched), so pictures embedded in the mail show. */
export function inlineCids(html: string, cids: Record<string, string>): string {
  return html.replace(/cid:([^"'\s)>]+)/gi, (all, id: string) => cids[id.toLowerCase()] ?? all);
}

export interface FrameOptions { remoteImages: boolean; dark: boolean }

/** The full document for the iframe's srcdoc. Links open in a new tab; nothing can run. */
export function frameDocument(bodyHtml: string, o: FrameOptions): string {
  const img = o.remoteImages ? "img-src data: https: http:;" : 'img-src data:;';
  const csp = `default-src 'none'; ${img} style-src 'unsafe-inline'; font-src data:;`;
  const css = `html{color-scheme:light}body{margin:0;padding:14px 16px;font:15px/1.5 -apple-system,system-ui,'DM Sans',sans-serif;color:#1E2430;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1F5FBF}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #D5D9E0;color:#5B6472}pre{white-space:pre-wrap}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>${css}</style></head><body>${stripDangerous(bodyHtml)}</body></html>`;
}
