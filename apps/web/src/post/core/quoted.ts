// Finds where a reply starts quoting the messages before it ("From: / Sent: / To:" blocks, "On … wrote:", > lines), so the reader can show
// the new text first and keep the quoted history one tap away. Nothing is removed: `rest` is always what comes after `main`.

export interface Split { main: string; rest: string }

const NONE = (text: string): Split => ({ main: text, rest: '' });

/** A forward is the quoted message on purpose; it is never folded away. */
export const isForward = (subject: string) => /^\s*(fwd?|vs|vl|videresendt)\s*:/i.test(subject);

const FROM = String.raw`(?:From|Fra|Von|De|Van)`;
const SENT = String.raw`(?:Sent|Sendt|Date|Dato|Datum|Gesendet|Envoy[eé]|Verzonden)`;
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
/** The line Outlook puts above its header block: "From: Name <address> Sent: … To: …". */
const HEADER = new RegExp(String.raw`^\s*${FROM}\s*:[\s\S]{0,400}?\b${SENT}\s*:`, 'i');
const header = (html: string) => HEADER.test(textOf(html.slice(0, 1500)));

/** Whether anything a person can read is left once the quote is taken away (an empty rest of the message is a forward, not a reply). */
const hasText = (html: string) => textOf(html.replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, '')).length > 0;

const MARKERS: RegExp[] = [
  /<div\b[^>]*\bid\s*=\s*["']?(?:appendonsend|divRplyFwdMsg|mail-editor-reference-message-container|x_divRplyFwdMsg)\b/i,
  /<(?:div|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:gmail_quote|yahoo_quoted|moz-cite-prefix|OutlookMessageHeader)\b/i,
  /<blockquote\b[^>]*\btype\s*=\s*["']?cite\b/i,
];

/** Moves a cut point up over the rule line and the empty "append on send" box Outlook puts just above its header block. */
function above(html: string, at: number): number {
  const start = Math.max(0, at - 700);
  for (const m of html.slice(start, at).matchAll(/<hr\b[^>]*>|<div\b[^>]*\bid\s*=\s*["']?appendonsend\b[^>]*>\s*<\/div>|<div\b[^>]*border-top\s*:\s*solid[^>]*>/gi)) {
    const from = start + (m.index ?? 0);
    if (!hasText(html.slice(from, at))) return from; // only rules, boxes and empty tags between it and the block: it belongs to the quote
  }
  return at;
}

/** Cuts a trailing "On Mon, X wrote:" / "Den man. skrev X:" line off the new text: it introduces the quote, it is not part of the answer. */
function trimIntro(main: string): string {
  const m = /(?:<(?:div|p|span|font)\b[^>]*>\s*)*(?:On|Den|Am|Le|El|Op)\b[^<]{4,240}\b(?:wrote|skrev|schrieb|a écrit|escribió|schreef)\b[^<]{0,40}:?\s*(?:<br\s*\/?>\s*|<\/(?:div|p|span|font)>\s*)*$/i.exec(main);
  return m ? main.slice(0, m.index) : main;
}

/** Splits an HTML body into the new text and the quoted history under it. When nothing quoted is found (or nothing new is above it), `rest` is empty. */
export function splitQuotedHtml(html: string): Split {
  let at = -1;
  for (const re of MARKERS) { const i = html.search(re); if (i >= 0 && (at < 0 || i < at)) at = i; }
  // Outlook's header block without a marker of its own: a line, then "From: … Sent: …".
  for (const m of html.matchAll(/<hr\b[^>]*>/gi)) {
    const i = m.index ?? 0;
    if (header(html.slice(i + m[0].length))) { if (at < 0 || i < at) at = i; break; }
  }
  if (at < 0) {
    const m = new RegExp(String.raw`<(?:b|strong)\b[^>]*>\s*${FROM}\s*:\s*<\/(?:b|strong)>`, 'i').exec(html);
    if (m && header(html.slice(m.index))) at = m.index;
  }
  if (at < 0) return NONE(html);
  const main = trimIntro(html.slice(0, above(html, at)));
  if (!hasText(main)) return NONE(html);
  return { main, rest: html.slice(main.length) };
}

const WROTE = /\b(?:wrote|skrev|schrieb|a écrit|escribió|schreef)\b[^\n]{0,40}:\s*$/i;
/** "On Mon, X wrote:", on one line or wrapped onto the next. */
const isIntro = (a: string, b = '') => /^\s*(?:on|den|am|le|el|op)\b/i.test(a) && (WROTE.test(a.trim()) || WROTE.test(`${a.trim()} ${b.trim()}`));

/** The same for a plain-text body: the lines from "On … wrote:", "-----Original Message-----", a "From: … Sent: …" block or the first "> " line. */
export function splitQuotedText(text: string): Split {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l, i) => {
    if (/^\s*>/.test(l)) return true;
    if (/^\s*-{2,}\s*(original message|opprinnelig melding|original-nachricht|message d'origine)\s*-{2,}\s*$/i.test(l)) return true;
    if (/^\s*_{10,}\s*$/.test(l) && header(lines.slice(i + 1, i + 6).join(' '))) return true;
    if (new RegExp(String.raw`^\s*${FROM}\s*:`, 'i').test(l) && header(lines.slice(i, i + 6).join(' '))) return true;
    return isIntro(l, lines[i + 1]);
  });
  if (at < 0) return NONE(text);
  let cut = at;
  // the line that says who wrote it can be one or two lines above the first > line
  if (/^\s*>/.test(lines[at])) for (let k = Math.max(0, at - 2); k < at; k++) {
    if (isIntro(lines[k], lines[k + 1])) { cut = k; break; }
  }
  const main = lines.slice(0, cut).join('\n').replace(/\s+$/, '');
  if (!main.trim()) return NONE(text);
  return { main, rest: text.slice(main.length) };
}
