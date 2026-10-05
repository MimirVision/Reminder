import type { Kind } from './types.ts';

// Which kind of mail is this, and WHY. The reasons are shown to the user ("why is this here?") and can always be overridden per sender,
// because wrong guesses that hide mail are the thing people hate most in Apple Mail's categories. Nothing here ever hides a message:
// a kind only labels it and lets the filter pills narrow the list.

export interface ClassifyInput {
  fromAddress: string;
  fromName?: string;
  subject: string;
  preview?: string;
  inferenceClassification?: string;
  headers?: { name: string; value: string }[];
}

const ROBOT = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|newsletters?|mailer-daemon|postmaster|bounces?|marketing|news|updates?|info|post|varsel|kundeservice)$/i;
const RECEIPT = /(kvittering|faktura|ordrebekreftelse|ordre\s?nr|betalingsbekreftelse|receipt|invoice|order confirmation|your order|payment (received|confirmation)|abonnement|regning)/i;
const ALERT = /(levert|sendt fra|din pakke|pakken din|delivered|shipped|tracking|påminnelse|reminder|varsel|timeavtale|appointment|verification|bekreftelseskode|engangskode|one-time|security (alert|code)|sign-?in|pålogging)/i;

const header = (h: ClassifyInput['headers'], name: string) => h?.find((x) => x.name.toLowerCase() === name)?.value;

export function classify(m: ClassifyInput, overrides: Record<string, Kind> = {}): { kind: Kind; why: string[] } {
  const addr = m.fromAddress.toLowerCase();
  const forced = overrides[addr];
  if (forced) return { kind: forced, why: ['You moved this sender here'] };

  const why: string[] = [];
  const unsub = !!header(m.headers, 'list-unsubscribe') || !!header(m.headers, 'list-id');
  const bulkHeader = /^(bulk|list|junk)$/i.test((header(m.headers, 'precedence') ?? '').trim());
  const auto = (header(m.headers, 'auto-submitted') ?? '').trim().toLowerCase();
  const robot = ROBOT.test(addr.split('@')[0]);
  const subject = m.subject ?? '';

  if (unsub) why.push('Has an unsubscribe link');
  if (bulkHeader) why.push('Sent as bulk mail, not to you personally');
  if (auto && auto !== 'no') why.push('Sent automatically');
  if (robot) why.push('Sent from a no-reply style address');

  if (RECEIPT.test(subject) && (robot || unsub || auto || /faktura|invoice|receipt|kvittering/i.test(subject))) {
    return { kind: 'receipt', why: [...why, 'Looks like a receipt or an invoice'] };
  }
  if (!why.length) return { kind: 'person', why: ['Written by a person'] };
  if (ALERT.test(subject) && !unsub) return { kind: 'alert', why: [...why, 'Looks like a notification'] };
  if (unsub || bulkHeader) return { kind: 'newsletter', why };
  return { kind: 'alert', why };
}
