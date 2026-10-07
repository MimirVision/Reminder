import type { Kind } from './types.ts';

// Which kind of mail is this, and WHY. Four kinds, like the tabs in iOS Mail: a person (Primary), a transaction (receipts, deliveries,
// bookings, security codes), an update (notifications, social, newsletters) or a promotion (marketing). The reasons are shown to the user
// ("why is this here?") and can always be overridden for one sender or for a whole company, because wrong guesses that hide mail are the
// thing people hate most in Apple Mail's categories. Nothing here ever hides a message: a kind only labels it and picks its tab, and
// when the evidence is thin the message stays with the people (a missed mail is worse than an extra one).
//
// The verdict is a pure function of what is saved about a message (sender, subject, preview, header marks) and of what Post has learned
// (your own choices, the people you have written to, your VIPs). That is what lets every rule change apply to old mail at once, without
// asking Outlook again.
//
// The alert server (the Supabase function post-alerts) sorts new mail with a copy of this very file, so the icon number follows the Primary
// tab: supabase/functions/post-alerts/classify.ts and the single-file function are generated from it. After changing this file run
// `npm run build:functions` in supabase/ and commit what it writes (the supabase tests fail while the copies are stale).

/** Bump when the saved header marks change meaning, so every message is asked about again. Rule changes never need a bump. */
export const CLASSIFIER_VERSION = 2;

export interface ClassifyInput {
  fromAddress: string;
  fromName?: string;
  subject: string;
  preview?: string;
  /** Marks from signalsFromHeaders. Undefined while the headers have not been read. */
  signals?: string[];
}

export interface ClassifyContext {
  /** The user's own choices: "anna@x.no" for one sender, "@x.no" for a whole company. */
  overrides?: Record<string, Kind>;
  /** Addresses the user has written to. */
  known?: ReadonlySet<string>;
  /** Addresses on the VIP list. */
  vips?: ReadonlySet<string>;
}

// ---- reading the headers ----------------------------------------------------------------------------------------------------------

// Headers that mailing services add. Receipts sent through the same services carry them too, so on their own they only count as weak evidence.
const ESP_HEADER = /^(x-mailgun|x-sg-|x-sendgrid|x-mailchimp|x-mc-|x-mandrill|x-campaign|x-cmail|x-ses-|x-postmark|x-pm-|x-sparkpost|x-msys|x-mailjet|x-mj-|x-sib-|x-brevo|x-klaviyo|x-hubspot|x-hs-|x-marketo|x-mkto|x-pardot|x-elq|x-emarsys|x-vero|x-customerio|x-iterable|x-braze|x-ctct|x-newsletter|x-bulk|feedback-id$)/i;
const ESP_MAILER = /(mailchimp|sendgrid|mailgun|mandrill|sendinblue|brevo|klaviyo|hubspot|marketo|campaign ?monitor|constant ?contact|salesforce|exacttarget|postmark|sparkpost|mailjet|braze|iterable|customer\.io|emarsys|dotdigital|activecampaign|convertkit|substack|beehiiv|cordial|listrak|responsys|eloqua|pardot)/i;

/**
 * Boils the headers down to a few short marks that are saved with the message:
 *   unsub (List-Unsubscribe), oneclick (List-Unsubscribe-Post), list (List-Id), bulk (Precedence: bulk/list/junk), bcl (Microsoft's own
 *   "bulk sender" level), auto (sent automatically), esp (sent through a mailing service), thread (a reply in a conversation).
 */
export function signalsFromHeaders(headers: { name: string; value: string }[] | undefined): string[] {
  const first = new Map<string, string>();
  for (const x of headers ?? []) {
    const n = String(x?.name ?? '').trim().toLowerCase();
    if (n && !first.has(n)) first.set(n, String(x.value ?? ''));
  }
  const out: string[] = [];
  const add = (t: string) => { if (!out.includes(t)) out.push(t); };
  const get = (n: string) => (first.get(n) ?? '').trim();

  if (get('list-unsubscribe')) add('unsub');
  if (first.has('list-unsubscribe-post')) add('oneclick');
  if (get('list-id')) add('list');
  const precedence = get('precedence');
  if (/^(bulk|list|junk)$/i.test(precedence)) add('bulk');
  if (/^auto[-_ ]?reply$/i.test(precedence)) add('auto');
  const autoSubmitted = get('auto-submitted').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') add('auto');
  if (first.has('x-auto-response-suppress') || first.has('x-autoreply') || first.has('x-autorespond')) add('auto');
  const bcl = /\bBCL:(\d+)/i.exec(get('x-microsoft-antispam'));
  if (bcl && Number(bcl[1]) >= 1) add('bcl');
  for (const n of first.keys()) if (ESP_HEADER.test(n)) { add('esp'); break; }
  if (ESP_MAILER.test(get('x-mailer')) || ESP_MAILER.test(get('x-mailer-sw'))) add('esp');
  if (first.has('in-reply-to') || first.has('references')) add('thread');
  return out;
}

// ---- words people (and robots) use, in Norwegian and English -----------------------------------------------------------------------

const NOT_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_AFTER = '(?![\\p{L}\\p{N}])';
/** A whole word or phrase. Letters include æ ø å, so "sale" does not match inside "resale" and "salg" not inside "usalg". */
const word = (src: string) => new RegExp(`${NOT_BEFORE}(?:${src})${NOT_AFTER}`, 'iu');
/** A piece of a word. Norwegian builds long compounds ("sommertilbud", "ordrebekreftelse"), so these may start or end anywhere. */
const piece = (src: string) => new RegExp(src, 'iu');
const any = (res: RegExp[], s: string) => res.some((r) => r.test(s));

// Plainly a receipt or an invoice, whoever sends it.
const RECEIPT_SURE = [piece('kvittering|faktura|ordrebekreftelse|bestillingsbekreftelse|betalingsbekreftelse|kontoutskrift'), word('receipt|invoice|order confirmation|payment confirmation|purchase confirmation|booking confirmation|e-?ticket')];
const RECEIPT = [...RECEIPT_SURE, piece('ordre ?(nr|nummer)|ordrenr|takk for (din |ditt )?(bestilling|ordre|kjøp|betaling)|betaling (mottatt|gjennomført|mislyktes)|regning|abonnement'), word('your order|order #?\\d+|payment (received|successful|failed|reminder)|thank you for (your )?(order|purchase|payment)|statement|subscription|renewal|renewed|billing')];
// A parcel, a booking, an appointment, a trip.
const DELIVERY = [piece('levert|forsendelse|leveranse|utlevering|hentes|henting|sporing|pakken din|din pakke|(bestilling|ordre).{0,40}(sendt|mottatt|klar|bekreftet|levert)|timeavtale|timebestilling|din time|avtalen din|reservasjon|billett|boarding|innsjekking|avreise|avgang'), word('pakke|pakken|sendingen( din)?'), word('delivered|shipped|shipment|out for delivery|parcel|package|tracking|appointment|booking|reservation|check-?in|boarding pass|flight|itinerary|pickup|ready for collection|your trip|your ride')];
// Codes and sign-in alerts. The last two words are a code that arrives as digits ("Your Apple ID Code is: 482913", "Bekreft betalingen med kode 5512",
// "482913 is your Instagram code"); a postal, tracking, order or promo code is not one.
const SECURITY = [piece('bekreftelseskode|engangskode|engangspassord|sikkerhetskode|verifiseringskode|påloggingskode|tilgangskode|aktiveringskode|godkjenningskode|autentiseringskode|signeringskode|pin-?kode|passord|pålogging|innlogging|bekreft (din |ditt )?(e-?post|konto|identitet)'), word('verification( code)?|verify (your|this)|one-?time|security (alert|code|info|notice)|sign-?in|log-?in|login|2fa|two-?step|two-?factor|password|your code|confirm your (email|account|identity)|unusual (activity|sign-?in)|new device|account recovery|(confirmation|login|access|authentication|authori[sz]ation|activation|reset|single-?use|auth) code|otp|passcode'),
  word('(?<!(?:postal|post|zip|area|country|dial|tracking|product|item|order|booking|reservation|invoice|customer|member|reference|bar|qr|source|dress|voucher|gift|coupon|discount|promo|offer|campaign) )(?:code|koden?)(?:\\W{1,3}(?:is|er|din))*\\W{1,4}(?:\\d{4,8}|\\d{3}[ -]\\d{3})'), word('\\d{4,8} (?:is|er) (?:your|din|ditt) (?:\\p{L}+ ){0,3}(?:code|kode)')];
// Codes that nobody types to a friend. (The broader SECURITY list also has "password", which a person might well write.)
const SECURITY_SURE = [piece('engangskode|engangspassord|bekreftelseskode|verifiseringskode|sikkerhetskode|påloggingskode'), word('verification code|security code|one-?time (code|password|passcode)|login code|sign-?in code|your code is|your code:')];
// Selling things. PROMO_SURE is specific enough to trust even on mail that looks personal; PROMO is the broad list, used only once
// something else says the mail was sent in bulk or by a robot (a person writing "tilbud" about a car must not land in Promotions).
const PROMO_SURE = [piece('\\d+\\s?%|%\\s?(off|rabatt|avslag)|black ?friday|cyber ?monday|kupong|gavekort|gratis frakt|fri frakt|(sommer|vinter|høst|vår|jule|lager|nett|påske|helge)salg|utsalg'), word('coupon|voucher|promo code|rabattkode|sale|free shipping|up to \\d+%')];
const PROMO = [...PROMO_SURE, piece('rabatt|kampanje|tilbud|spar |bonus|poeng|gratis|medlem(s)?(fordel|tilbud|pris|klubb)|din kode|bruk koden|eksklusiv|begrenset|siste (sjanse|dag|frist)|bare i dag|kun i dag|handle nå|ny kolleksjon'), word('deals?|offers?|discounts?|save|limited( time| offer)?|last chance|ends (today|tonight|soon|tomorrow|sunday|midnight)|don.t miss|miss out|exclusive|shop now|new (arrivals?|collection|in)|bestsellers?|rewards?|points|members?-only')];
// Editorial mail and social or work notifications.
const NEWS = [word('newsletter|digest|weekly|monthly|daily|briefing|round-?up|what.s new|this week|your week|bulletin|edition|issue #?\\d+|podcast|episode'), piece('nyhetsbrev|ukens|månedens|dagens|ukesoppsummering|siste nytt|nytt fra|oppdatering|nyheter|magasin')];
const SOCIAL = [word('liked|commented|mentioned|invited you|connection request|followed you|new follower|tagged you|sent you a message|friend request|viewed your profile|replied to'), piece('ny melding|nytt innlegg|har kommentert|har invitert deg|følger deg')];
const PLATFORM = /(^|\.)(facebookmail|facebook|linkedin|github|gitlab|twitter|x|instagram|reddit|redditmail|slack|notion|medium|substack|discord|pinterest|quora|trello|atlassian|figma|zoom|dropbox|asana|miro|airtable|calendly|eventbrite|meetup|youtube|tiktok|snapchat|twitch|stackoverflow|stackexchange)\.(com|net|so|us|org|io)$/i;

// Sender names. The strong list is mail no person wrote by hand; the weak list is a role mailbox that people also answer from.
const ROBOT_PREFIX = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|bounces?)/i;
const ROBOT = /^(notifications?|notify|newsletters?|nyhetsbrev|marketing|campaigns?|kampanje|offers?|deals?|tilbud|promo(tions?)?|alerts?|varsel|automated|auto|system)([-_.][\w.-]*)?$/i;
const ROLE = /^(info|post|mail|hello|hei|hi|team|service|kundeservice|kundesenter|support|help|contact|kontakt|sales|salg|orders?|ordre|billing|faktura|invoice|receipts?|kvittering|booking|bestilling|bestillinger|reservasjon|tickets?|billett(er)?|news|updates?|account|accounts|konto|security|sikkerhet|admin|shop|store|butikk|nettbutikk|webshop|medlem|members?|club|klubb|bank)([-_.][\w.-]*)?$/i;

const REPLY = /^\s*(re|sv|svar|aw|vs|vb|fw|fwd)\s*:/i;
const BOUNCE_SUBJECT = /^\s*(undeliverable|returned mail|mail delivery (failed|subsystem)|delivery (status )?notification|delivery has failed|kunne ikke leveres|ikke levert)/i;

// ---- companies and free mail providers -------------------------------------------------------------------------------------------

/** "mail.elkjop.no" gives "elkjop.no"; "shop.example.co.uk" gives "example.co.uk". Takes an address or a domain. */
export function orgDomain(addressOrDomain: string): string {
  const d = (addressOrDomain.includes('@') ? addressOrDomain.split('@')[1] : addressOrDomain).toLowerCase().trim();
  const parts = d.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  const keep = tld.length === 2 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ltd', 'plc'].includes(sld) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** Everyone shares these, so "everything from gmail.com" is never a useful rule. */
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.no', 'hotmail.co.uk', 'live.com', 'live.no', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'yahoo.no', 'online.no', 'getmail.no', 'start.no', 'c2i.net', 'protonmail.com', 'proton.me', 'gmx.com', 'aol.com', 'yandex.com', 'mail.com', 'tutanota.com']);
export const isFreemail = (addressOrDomain: string) => FREEMAIL.has(orgDomain(addressOrDomain));

/** The saved choice that decides this sender: the sender's own, else the one for their company. */
export function ruleFor(overrides: Record<string, Kind> | undefined, address: string): { key: string; kind: Kind; scope: 'sender' | 'company' } | null {
  if (!overrides) return null;
  const addr = address.trim().toLowerCase();
  if (overrides[addr]) return { key: addr, kind: overrides[addr], scope: 'sender' };
  const labels = (addr.split('@')[1] ?? '').split('.').filter(Boolean);
  for (let i = 0; i <= labels.length - 2; i++) {
    const key = `@${labels.slice(i).join('.')}`;
    if (overrides[key]) return { key, kind: overrides[key], scope: 'company' };
  }
  return null;
}

/**
 * A short fingerprint of the saved choices, so a phone and the alert server can tell whether they hold the same ones without sending them
 * (the same text on both sides: the server's copy of this file is generated from this one).
 */
export function rulesDigest(overrides: Record<string, Kind> | undefined): string {
  const lines = Object.entries(overrides ?? {}).map(([who, kind]) => `${who.trim().toLowerCase()}=${kind}`).sort();
  let h = 0x811c9dc5; // FNV-1a over the code points of every line
  for (const ch of lines.join('\n')) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return `${lines.length}:${h.toString(16)}`;
}

/** The shape of a saved choice an alert server can hold: "anna@x.no" for one sender, "@x.no" for a company. */
export const isRuleKey = (who: string): boolean => who.length <= 120 && /^(@[^\s@]+|[^\s@]+@[^\s@]+)$/.test(who);

/**
 * The saved choices the phone tells the alert server. A key of any other shape (the internal address an Exchange server gives a colleague, say)
 * stays on the phone: one such key must not make the server refuse all the others.
 */
export function sendableRules(overrides: Record<string, Kind> | undefined): Record<string, Kind> {
  const out: Record<string, Kind> = {};
  for (const [who, kind] of Object.entries(overrides ?? {})) { const key = who.trim().toLowerCase(); if (isRuleKey(key)) out[key] = kind; }
  return out;
}

const flat = (t: string) => t.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/** A company writing under its own name ("Elkjøp Norge" from elkjop.no). "Ola Hansen" from hansen.no is a person: the first word has to be the company. */
function isBrandSender(fromName: string | undefined, domain: string): boolean {
  if (!fromName || !domain || isFreemail(domain)) return false;
  const org = flat(orgDomain(domain).split('.')[0]);
  const first = flat(fromName.trim().split(/\s+/)[0] ?? '');
  return org.length >= 3 && first.startsWith(org);
}

// ---- the verdict -----------------------------------------------------------------------------------------------------------------------

const R = {
  sender: 'You moved this sender here',
  vip: 'On your VIP list',
  bounce: 'A problem delivering mail you sent',
  known: 'You have written to this address',
  thread: 'Part of a conversation',
  unsub: 'Has an unsubscribe link',
  list: 'Sent to a mailing list',
  bulk: 'Sent as bulk mail, not to you personally',
  mailer: 'Sent through a mailing service',
  auto: 'Sent automatically',
  robot: 'Sent from a no-reply style address',
  receipt: 'Looks like a receipt or an invoice',
  delivery: 'Looks like a delivery, booking or appointment',
  security: 'Looks like a security code or sign-in alert',
  promo: 'Sounds like an offer or a sale',
  news: 'Looks like a newsletter or news',
  platform: 'From a social or work app',
  person: 'Written by a person',
};

/** A one-time code or a sign-in alert: it sits in Transactions, yet it cannot wait for you to open Post (the alert server lets these through). */
export function isSecurityMail(v: { kind: Kind; why: string[] }): boolean {
  return v.kind === 'transaction' && v.why.includes(R.security);
}

export function classify(m: ClassifyInput, ctx: ClassifyContext = {}): { kind: Kind; why: string[] } {
  const addr = (m.fromAddress ?? '').trim().toLowerCase();
  const [localFull = '', domain = ''] = addr.split('@');
  const local = localFull.split('+')[0];
  const subject = m.subject ?? '';
  const text = `${subject} ${m.preview ?? ''}`;

  // 1. What the person decided always wins, then the VIP list.
  const rule = ruleFor(ctx.overrides, addr);
  if (rule) return { kind: rule.kind, why: [rule.scope === 'sender' ? R.sender : `You moved everything from ${rule.key.slice(1)} here`] };
  if (addr && ctx.vips?.has(addr)) return { kind: 'person', why: [R.vip] };

  // 2. Facts from the headers (undefined until they have been read).
  const sig = m.signals ?? [];
  const has = (t: string) => sig.includes(t);
  const bulk = has('unsub') || has('list') || has('bulk') || has('bcl');
  const auto = has('auto');
  const mailer = has('esp');
  const robot = ROBOT_PREFIX.test(local) || ROBOT.test(local);
  const role = ROLE.test(local) || isBrandSender(m.fromName, domain);
  const thread = REPLY.test(subject) || has('thread');
  const known = !!addr && !!ctx.known?.has(addr);

  const why: string[] = [];
  if (has('unsub')) why.push(R.unsub);
  if (has('list')) why.push(R.list);
  if (has('bulk') || has('bcl')) why.push(R.bulk);
  if (mailer && !bulk) why.push(R.mailer);
  if (auto) why.push(R.auto);
  if (robot) why.push(R.robot);

  // 3. Mail that needs the person's attention whatever it looks like: a bounce of something they sent.
  if (/^(mailer-daemon|postmaster)$/i.test(local) || BOUNCE_SUBJECT.test(subject)) return { kind: 'person', why: [R.bounce] };

  const cues = {
    receiptSure: any(RECEIPT_SURE, text), receipt: any(RECEIPT, text), promoSure: any(PROMO_SURE, text), promo: any(PROMO, text),
    security: any(SECURITY, text), delivery: any(DELIVERY, text), news: any(NEWS, text), platform: PLATFORM.test(domain) || any(SOCIAL, text),
  };
  const anyCue = cues.receipt || cues.promo || cues.security || cues.delivery || cues.news || cues.platform;
  const byWords = (): { kind: Kind; why: string[] } | null => {
    const v = verdictFromWords(cues);
    return v ? { kind: v.kind, why: [...why, v.reason] } : null;
  };

  // 4. People: someone you have written to, or a reply in a conversation, unless the mail itself says it was sent in bulk.
  if (known && !bulk && !auto && !((robot || role) && (cues.receipt || cues.delivery || cues.security || cues.promo))) return { kind: 'person', why: [R.known] };
  if (thread && !bulk && !auto && !robot) return { kind: 'person', why: [R.thread] };

  // 5. Sent in bulk (an unsubscribe link, a mailing list, bulk headers): never a person.
  if (bulk) {
    const v = byWords();
    if (v) return v;
    // A mailing list without an unsubscribe link is a group or a discussion, not an advertisement.
    if (has('list') && !has('unsub')) return { kind: 'update', why };
    return { kind: 'promo', why };
  }

  // 6. Sent by a robot: automatic, a no-reply address, or a mailing service plus one more hint (a role mailbox, or words that say what it is).
  if (auto || robot || (mailer && (role || anyCue)) || (role && (cues.receipt || cues.delivery || cues.security || cues.promo))) {
    return byWords() ?? { kind: 'update', why: why.length ? why : [R.auto] };
  }

  // 7. Nothing says "robot", but the subject plainly is a receipt or an offer (a person rarely writes these).
  if (any(RECEIPT_SURE, subject)) return { kind: 'transaction', why: [R.receipt] };
  if (any(SECURITY_SURE, subject)) return { kind: 'transaction', why: [R.security] };
  if (any(PROMO_SURE, subject)) return { kind: 'promo', why: [R.promo] };

  return { kind: 'person', why: [R.person] };
}

/** What the words alone say, strongest first: a receipt or a sale is unmistakable; a code beats a mere offer; an offer beats a mention of delivery. */
function verdictFromWords(c: { receiptSure: boolean; receipt: boolean; promoSure: boolean; promo: boolean; security: boolean; delivery: boolean; news: boolean; platform: boolean }): { kind: Kind; reason: string } | null {
  if (c.receiptSure) return { kind: 'transaction', reason: R.receipt };
  if (c.promoSure) return { kind: 'promo', reason: R.promo };
  if (c.security) return { kind: 'transaction', reason: R.security };
  if ((c.delivery || c.receipt) && !c.promo) return { kind: 'transaction', reason: c.delivery ? R.delivery : R.receipt };
  if (c.promo) return { kind: 'promo', reason: R.promo };
  if (c.platform) return { kind: 'update', reason: R.platform };
  if (c.news) return { kind: 'update', reason: R.news };
  return null;
}
