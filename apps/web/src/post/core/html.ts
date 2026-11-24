// Turns a message body into something safe to show. Defence in depth: (1) the iframe it goes in is sandboxed with NO scripts, (2) a
// Content-Security-Policy inside the page allows no scripts and, by default, no remote images (which is what tracking pixels are),
// (3) the obvious dangerous tags are removed here too.

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function textToHtml(text: string): string {
  const safe = escapeHtml(text);
  // A link ends at a space, or at the escaped < > or " that wrap it in plain-text mail (<https://x.no/p> or "https://x.no/p"): those are not part of the address.
  return safe.replace(/https?:\/\/(?:(?!&(?:lt|gt|quot);)[^\s<])+/g, (u) => {
    let url = u;
    // Punctuation that belongs to the sentence, and a closing bracket the address did not open, stay outside the link.
    for (;;) {
      const last = url[url.length - 1];
      const open = (url.match(/\(/g) ?? []).length, close = (url.match(/\)/g) ?? []).length;
      if (/[.,;:!?'\]]/.test(last) || (last === ')' && close > open)) url = url.slice(0, -1); else break;
    }
    return url.length > 8 ? `<a href="${url}">${url}</a>${u.slice(url.length)}` : u;
  }).replace(/\r?\n/g, '<br>');
}

/** One picture tag, read no further than this (real ones are far shorter). */
const IMG_TAG = /<img\b[^>]{0,2000}>/gi;

/** True if the message pulls pictures from the internet (so the "load images" bar is worth showing). */
export function hasRemoteImages(html: string): boolean {
  // Tag by tag, with a bound on how far a tag is followed: a hostile message of thousands of unfinished tags must not make this slow.
  for (const tag of html.match(IMG_TAG) ?? []) if (/\bsrc\s*=\s*["']?(?:https?:)?\/\//i.test(tag)) return true;
  return /url\(\s*["']?(?:https?:)?\/\//i.test(html) || /\bbackground\s*=\s*["']?(?:https?:)?\/\//i.test(html);
}

/**
 * Makes picture addresses loadable from inside the frame: a `//host/pic.png` address would be read against about:srcdoc and never load, and
 * a plain `http:` one is refused as mixed content on this https page. Both become `https:`. Only picture attributes and url(...) are touched.
 */
export function fixPictureUrls(html: string): string {
  const fix = (u: string) => u.replace(/^(\s*)(?:http:)?\/\//i, '$1https://');
  return html
    .replace(IMG_TAG, (tag) => tag
      .replace(/(\bsrc\s*=\s*)(["'])([^"']*)\2/i, (_a, pre: string, q: string, u: string) => `${pre}${q}${fix(u)}${q}`)
      .replace(/(\bsrcset\s*=\s*)(["'])([^"']*)\2/i, (_a, pre: string, q: string, u: string) => `${pre}${q}${u.split(',').map((c) => fix(c)).join(',')}${q}`))
    .replace(/(\bbackground\s*=\s*)(["'])([^"']*)\2/gi, (_a, pre: string, q: string, u: string) => `${pre}${q}${fix(u)}${q}`)
    .replace(/url\(\s*(["']?)\s*(?:http:)?\/\//gi, 'url($1https://');
}

export function stripDangerous(html: string): string {
  return html
    // an unfinished script would run to the end of the page, so it is removed to the end of the page (one pass, however many there are)
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, '')
    .replace(/<(?:iframe|object|embed|applet|form|base|link)\b[^>]{0,1500}>/gi, '')
    .replace(/<meta\b[^>]{0,2000}>/gi, (tag) => (/http-equiv\s*=\s*["']?(?:refresh|content-security-policy)/i.test(tag) ? '' : tag))
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
  const css = `html{color-scheme:light}body{margin:0;padding:14px 16px;font:15px/1.5 -apple-system,system-ui,'DM Sans',sans-serif;color:#1E2430;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}html{overflow:hidden}img{max-width:100%;height:auto}table{max-width:100%}td img,a img{vertical-align:top}a{color:#1F5FBF}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #D5D9E0;color:#5B6472}pre{white-space:pre-wrap}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>${css}</style></head><body>${stripDangerous(fixPictureUrls(bodyHtml))}</body></html>`;
}
