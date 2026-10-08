import { CLASSIFIER_VERSION, orgDomain } from './classify.ts';
import { KINDS, KIND_TAB, type Kind, type Mail } from './types.ts';

// "Copy sorting report": a plain-text summary of how the inbox was sorted, for tuning the rules. It is safe to paste into a message: it names
// companies (domains) and counts, and never a subject, a preview, a person's name or a full address.

const SHORT: Record<Kind, string> = { person: 'P', transaction: 'T', update: 'U', promo: 'M' };

export function sortingReport(mail: Mail[], overrides: Record<string, Kind>, today: string, top = 40): string {
  const inbox = mail.filter((m) => m.folder === 'inbox');
  const perKind = Object.fromEntries(KINDS.map((k) => [k, { all: 0, focused: 0, other: 0 }])) as Record<Kind, { all: number; focused: number; other: number }>;
  let read = 0;
  const firms = new Map<string, { n: number; kinds: Record<Kind, number>; marks: Map<string, number>; why: Map<string, number> }>();
  for (const m of inbox) {
    const k = perKind[m.kind] ?? perKind.person;
    k.all++;
    if (m.inf === 'focused') k.focused++; else if (m.inf === 'other') k.other++;
    if (m.sig) read++;
    const dom = orgDomain(m.fromAddress) || '(no address)';
    let f = firms.get(dom);
    if (!f) { f = { n: 0, kinds: { person: 0, transaction: 0, update: 0, promo: 0 }, marks: new Map(), why: new Map() }; firms.set(dom, f); }
    f.n++; f.kinds[m.kind in f.kinds ? m.kind : 'person']++;
    for (const x of m.sig ?? []) f.marks.set(x, (f.marks.get(x) ?? 0) + 1);
    const reason = m.why[0];
    if (reason) f.why.set(reason, (f.why.get(reason) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(`Post sorting report · rules v${CLASSIFIER_VERSION} · ${today}`);
  lines.push(`${inbox.length} messages in the inbox, headers read for ${read}`);
  lines.push('');
  lines.push(KINDS.map((k) => `${KIND_TAB[k]} ${perKind[k].all}`).join(' · '));
  lines.push(`Outlook's own Focused/Other guess: ${KINDS.map((k) => `${SHORT[k]} ${perKind[k].focused}/${perKind[k].other}`).join(', ')}`);
  lines.push('');
  lines.push('Companies, by number of messages: how many went to Primary (P), Transactions (T), Updates (U), Promotions (M), then the header marks seen and the usual reason');
  const ranked = [...firms.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  for (const [dom, f] of ranked.slice(0, top)) {
    const kinds = KINDS.map((k) => `${SHORT[k]}${f.kinds[k]}`).join(' ');
    const marks = [...f.marks.entries()].sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x}×${n}`).join(' ');
    const why = [...f.why.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    lines.push(`${dom}  ${f.n}  ${kinds}  ${marks || 'no marks'}  "${why}"`);
  }
  const rest = ranked.slice(top);
  if (rest.length) lines.push(`(and ${rest.length} more companies, ${rest.reduce((n, [, f]) => n + f.n, 0)} messages)`);

  const rules = Object.entries(overrides);
  lines.push('');
  if (!rules.length) lines.push('Your rules: none');
  else {
    lines.push(`Your rules (${rules.filter(([k]) => k.startsWith('@')).length} company, ${rules.filter(([k]) => !k.startsWith('@')).length} sender; senders are shown by company only):`);
    for (const [k, kind] of rules.sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`${k.startsWith('@') ? `everything from ${k.slice(1)}` : `one sender at ${orgDomain(k)}`} → ${KIND_TAB[kind]}`);
  }
  return lines.join('\n');
}
