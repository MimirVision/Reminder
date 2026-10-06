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
    .replace(/(href|src|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"')
    // A page opened from a link must not be able to reach back into this one.
    .replace(/<a\b/gi, '<a rel="noopener noreferrer"');
}

/**
 * What type an attachment is opened with. A blob URL belongs to THIS app's origin, so an HTML or SVG attachment opened that way
 * would run its scripts as Post. Only types that cannot run code keep their type (so they preview); everything else is forced to a
 * download-style type.
 */
export function safeBlobType(contentType: string, name: string): string {
  if (runsCode(contentType, name)) return 'application/octet-stream';
  const t = contentType.toLowerCase().split(';')[0].trim();
  if (t === 'application/pdf' || /^image\/(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/.test(t) || t === 'text/plain') return t;
  return 'application/octet-stream';
}

/** True for what can run code when it is opened from this site's own address: web pages, vector pictures, scripts. */
function runsCode(contentType: string, name: string): boolean {
  const t = contentType.toLowerCase().split(';')[0].trim();
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|application\/javascript|text\/javascript|application\/x-)/.test(t) || ['html', 'htm', 'xhtml', 'svg', 'xml', 'js', 'mjs', 'hta'].includes(ext);
}

/**
 * The type a file is handed over with when it leaves Post for another app (the share sheet). Its real type, so a phone offers the right apps
 * (Word for a .docx), unless it could run code here, which is then handed over as plain data. Nothing opened from Post's own address uses this.
 */
export function shareType(contentType: string, name: string): string {
  if (runsCode(contentType, name)) return 'application/octet-stream';
  const t = contentType.toLowerCase().split(';')[0].trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t) ? t : 'application/octet-stream';
}

/** A transparent 1×1 picture. Stands in for a `cid:` picture that is not known (yet), so the frame never tries to load an address it cannot open. */
export const BLANK_PICTURE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Replaces `cid:` picture references with the inline attachment data (already fetched), so pictures embedded in the mail show. A reference
 * that is not known is left alone, or, when `missing` is given, swapped for that wherever a picture is expected (never in the visible text).
 */
export function inlineCids(html: string, cids: Record<string, string>, missing?: string): string {
  const known = html.replace(/cid:([^"'\s)>]+)/gi, (all, id: string) => cids[id.toLowerCase()] ?? all);
  return missing === undefined ? known : known.replace(/((?:src|background|poster)\s*=\s*["']?|url\(\s*["']?)cid:[^"'\s)>]+/gi, (_all, before: string) => `${before}${missing}`);
}

export interface FrameOptions { remoteImages: boolean; dark: boolean }

/** The full document for the iframe's srcdoc. Links open in a new tab; nothing can run. */
export function frameDocument(bodyHtml: string, o: FrameOptions): string {
  const img = o.remoteImages ? "img-src data: https: http:;" : 'img-src data:;';
  const csp = `default-src 'none'; ${img} style-src 'unsafe-inline'; font-src data:;`;
  const css = `html{color-scheme:light}body{margin:0;padding:14px 16px;font:15px/1.5 -apple-system,system-ui,'DM Sans',sans-serif;color:#1E2430;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1F5FBF}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #D5D9E0;color:#5B6472}pre{white-space:pre-wrap}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>${css}</style></head><body>${stripDangerous(bodyHtml)}</body></html>`;
}
