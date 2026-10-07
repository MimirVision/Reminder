import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, isFreemail, isRuleKey, isSecurityMail, orgDomain, ruleFor, rulesDigest, sendableRules, signalsFromHeaders, type ClassifyContext } from './classify.ts';
import { asKind, KINDS, type Kind } from './types.ts';

const hdr = (...a: [string, string][]) => a.map(([name, value]) => ({ name, value }));
const UNSUB = hdr(['List-Unsubscribe', '<https://x/u>']);
const sigOf = (headers?: [string, string][]) => (headers ? signalsFromHeaders(hdr(...headers)) : undefined);

type Row = [kind: Kind, from: string, subject: string, preview?: string, headers?: [string, string][], ctx?: ClassifyContext];
const U: [string, string][] = [['List-Unsubscribe', '<https://x/u>']];

// What real inboxes look like, in Norwegian and English. Each row is one message and the tab it must land in.
const ROWS: Row[] = [
  // ---- people (Primary): the cost of a wrong guess is a missed mail, so anything unsure stays here
  ['person', 'anna@example.no', 'Middag på fredag?'],
  ['person', 'kari@firma.no', 'Møtereferat fra i går'],
  ['person', 'per@bedrift.no', 'Re: Tilbud på nytt tak'],
  ['person', 'per@bedrift.no', 'Svar: Tilbud på nytt tak'],
  ['person', 'maler@malermester.no', 'Tilbud på maling av hus', 'Hei! Her er tilbudet vårt'],
  ['person', 'info@bakeri.no', 'Svar: bestilling av kake'],
  ['person', 'kundeservice@elkjop.no', 'Re: Din henvendelse #4455'],
  ['person', 'agent@megler.no', 'Salgsoppgave for Storgata 5'],
  ['person', 'anna@x.no', 'Re: ordrebekreftelse fra deg'],
  ['person', 'anna@x.no', 'Resale of the car?'],
  ['person', 'mailer-daemon@outlook.com', 'Undeliverable: Hei'],
  ['person', 'postmaster@firma.no', 'Delivery Status Notification (Failure)'],
  // ---- transactions: receipts, invoices, deliveries, bookings, codes
  ['transaction', 'noreply@vipps.no', 'Din kvittering fra Rema 1000'],
  ['transaction', 'no-reply@shop.com', 'Your order #123 has shipped'],
  ['transaction', 'varsel@posten.no', 'Pakken din er levert'],
  ['transaction', 'ordre@elkjop.no', 'Ordrebekreftelse 55566'],
  ['transaction', 'security@microsoft.com', 'Security alert', '', [['Auto-Submitted', 'auto-generated']]],
  ['transaction', 'noreply@id.vy.no', 'Billett til Oslo S'],
  ['transaction', 'no-reply@accounts.google.com', 'Ny pålogging på enheten din'],
  ['transaction', 'noreply@github.com', 'Your verification code is 123456'],
  ['transaction', 'faktura@telenor.no', 'Faktura for oktober'],
  ['transaction', 'booking@hotel.com', 'Booking confirmation 99'],
  ['transaction', 'kundeservice@elkjop.no', 'Din time hos oss er bekreftet'],
  ['transaction', 'noreply@paypal.com', 'You sent a payment', 'Payment confirmation for your purchase'],
  ['transaction', 'orders@amazon.com', 'Your order has shipped', '', U],
  ['transaction', 'bank@dnb.no', 'Engangskode 8841'],
  // ---- updates: notifications, social, newsletters, mailing lists, automatic replies
  ['update', 'notifications@github.com', 'Re: [repo] fix bug (#12)', '', [['List-Id', '<repo.github.com>'], ['In-Reply-To', '<x>']]],
  ['update', 'noreply@linkedin.com', 'Anna viewed your profile'],
  ['update', 'info@nrk.no', 'Dagens nyheter', '', U],
  ['update', 'noreply@medium.com', 'Weekly digest', '', U],
  ['update', 'newsletter@substack.com', 'The Sunday issue', '', U],
  ['update', 'noreply@facebookmail.com', 'Du har 3 nye varsler'],
  ['update', 'kari@club.no', 'Referat fra styremøtet', '', [['List-Id', '<styret.club.no>']]],
  ['update', 'noreply@system.firma.no', 'Planlagt vedlikehold søndag'],
  ['update', 'noreply@ms.com', 'Automatic reply: Out of office', '', [['Auto-Submitted', 'auto-replied']]],
  ['update', 'post@kommune.no', 'Nyhetsbrev fra kommunen', '', U],
  // ---- promotions: marketing
  ['promo', 'tilbud@butikk.no', 'Stort sommersalg: opptil 70% rabatt', '', U],
  ['promo', 'hei@brand.com', 'Last chance: 30% off everything', '', U],
  ['promo', 'news@zalando.no', 'Nye favoritter for deg', '', U],
  ['promo', 'marketing@elkjop.no', 'Black Friday starter nå'],
  ['promo', 'anna@brand.com', '50% rabatt i dag!'],
  ['promo', 'noreply@coop.no', 'Medlemstilbud denne uken', '', [['X-Mailgun-Sid', 'abc']]],
  ['promo', 'hello@store.com', 'Free shipping this weekend', '', [['X-SG-EID', 'abc'], ['List-Unsubscribe', '<mailto:u@x>']]],
  ['promo', 'kampanje@power.no', 'Kupong: 200 kr på alt'],
  ['promo', 'info@spotify.com', 'Get 3 months free', '', U],
  ['promo', 'deals@booking.com', 'Hotels from 499 kr', '', U],
  ['promo', 'bulk@brand.no', 'Hei', '', [['Precedence', 'bulk']]],
  ['promo', 'x@brand.no', 'Hei', '', [['X-Microsoft-Antispam', 'BCL:6;']]],
  // ---- what Post has learned about this person
  ['person', 'support@shop.com', 'Hvordan går det?', '', undefined, { known: new Set(['support@shop.com']) }],
  ['person', 'boss@firma.no', 'Quarterly numbers', '', U, { vips: new Set(['boss@firma.no']) }],
  ['promo', 'support@shop.com', 'Hvordan går det?', '', U, { known: new Set(['support@shop.com']) }],
  ['promo', 'anna@x.no', 'Middag?', '', undefined, { overrides: { 'anna@x.no': 'promo' } }],
  ['promo', 'a@news.brand.com', 'Hei', '', undefined, { overrides: { '@brand.com': 'promo' } }],
  ['person', 'a@news.brand.com', 'Hei', '', undefined, { overrides: { '@brand.com': 'promo', 'a@news.brand.com': 'person' } }],
];

test('real-world mail lands in the right tab', () => {
  const wrong: string[] = [];
  for (const [kind, from, subject, preview, headers, ctx] of ROWS) {
    const r = classify({ fromAddress: from, subject, preview, signals: sigOf(headers) }, ctx);
    if (r.kind !== kind) wrong.push(`${from} | ${subject}: wanted ${kind}, got ${r.kind} (${r.why.join('; ')})`);
  }
  assert.deepEqual(wrong, []);
});

test('every verdict comes with at least one plain reason', () => {
  for (const [, from, subject, preview, headers, ctx] of ROWS) assert.ok(classify({ fromAddress: from, subject, preview, signals: sigOf(headers) }, ctx).why.length >= 1, subject);
  for (const subject of ['a', 'Faktura', 'Levert', '']) assert.ok(classify({ fromAddress: 'info@x.no', subject }).why.length >= 1);
  assert.deepEqual(classify({ fromAddress: '', subject: '' }).kind, 'person');
});

test('a normal message from a person says so', () => {
  assert.deepEqual(classify({ fromAddress: 'anna@example.no', fromName: 'Anna', subject: 'Middag?' }), { kind: 'person', why: ['Written by a person'] });
});

test('the reasons name what was seen', () => {
  const unsub = classify({ fromAddress: 'news@butikk.no', subject: 'Hei fra butikken', signals: sigOf(U) });
  assert.equal(unsub.kind, 'promo');
  assert.ok(unsub.why.includes('Has an unsubscribe link'));
  assert.ok(classify({ fromAddress: 'noreply@vipps.no', subject: 'Din kvittering' }).why.includes('Looks like a receipt or an invoice'));
  assert.ok(classify({ fromAddress: 'a@b.no', subject: 'x', signals: ['list'] }).why.includes('Sent to a mailing list'));
  assert.ok(classify({ fromAddress: 'a@b.no', subject: 'x', signals: ['bcl'] }).why.includes('Sent as bulk mail, not to you personally'));
  assert.deepEqual(classify({ fromAddress: 'x@y.no', subject: 'Hei' }, { known: new Set(['x@y.no']) }).why, ['You have written to this address']);
  assert.deepEqual(classify({ fromAddress: 'x@y.no', subject: 'Re: Hei' }).why, ['Part of a conversation']);
  assert.deepEqual(classify({ fromAddress: 'x@y.no', subject: 'Hei' }, { vips: new Set(['x@y.no']) }).why, ['On your VIP list']);
});

test('a choice you made always wins, and says whose choice it was', () => {
  const one = classify({ fromAddress: 'noreply@x.no', subject: 'kvittering' }, { overrides: { 'noreply@x.no': 'person' } });
  assert.equal(one.kind, 'person');
  assert.equal(one.why[0], 'You moved this sender here');
  const company = classify({ fromAddress: 'a@mail.x.no', subject: 'Hei' }, { overrides: { '@x.no': 'update' } });
  assert.equal(company.kind, 'update');
  assert.equal(company.why[0], 'You moved everything from x.no here');
  // beats the VIP list and the bulk marks too
  assert.equal(classify({ fromAddress: 'v@x.no', subject: 'Hei', signals: ['unsub'] }, { overrides: { 'v@x.no': 'update' }, vips: new Set(['v@x.no']) }).kind, 'update');
});

test('bulk marks are never overruled by a person-looking sender, except your own choice', () => {
  const m = { fromAddress: 'anna.hansen@firma.no', fromName: 'Anna Hansen', subject: 'Hei der', signals: ['unsub'] };
  assert.notEqual(classify(m).kind, 'person');
  assert.notEqual(classify({ ...m, subject: 'Re: Hei der' }).kind, 'person');
  assert.notEqual(classify(m, { known: new Set([m.fromAddress]) }).kind, 'person');
  assert.equal(classify(m, { overrides: { [m.fromAddress]: 'person' } }).kind, 'person');
});

test('a mailing list without an unsubscribe link is a discussion, not an advert', () => {
  assert.equal(classify({ fromAddress: 'kari@club.no', subject: 'Hei alle', signals: ['list'] }).kind, 'update');
  assert.equal(classify({ fromAddress: 'kari@club.no', subject: 'Hei alle', signals: ['list', 'unsub'] }).kind, 'promo');
});

test('auto-replies and automatic mail are updates, never people', () => {
  assert.equal(classify({ fromAddress: 'anna@x.no', subject: 'Re: Hei', signals: ['auto', 'thread'] }).kind, 'update');
  assert.equal(classify({ fromAddress: 'anna@x.no', subject: 'Hei', signals: ['auto'] }, { known: new Set(['anna@x.no']) }).kind, 'update');
});

test('a mailing service alone is weak evidence, with a company sender or shop words it is enough', () => {
  assert.equal(classify({ fromAddress: 'anna@x.no', subject: 'Middag?', signals: ['esp'] }).kind, 'person');
  assert.equal(classify({ fromAddress: 'info@x.no', subject: 'Hei', signals: ['esp'] }).kind, 'update');
  assert.equal(classify({ fromAddress: 'anna@x.no', subject: 'Din kvittering', signals: ['esp'] }).kind, 'transaction');
});

test('a person at a company is not mistaken for the company', () => {
  // "Ola Hansen" writing from hansen.no is a person; "Elkjøp Norge" from elkjop.no is the shop.
  assert.equal(classify({ fromAddress: 'ola@hansen.no', fromName: 'Ola Hansen', subject: 'Din bestilling er sendt' }).kind, 'person');
  assert.equal(classify({ fromAddress: 'ola@elkjop.no', fromName: 'Elkjøp Norge', subject: 'Din bestilling er sendt' }).kind, 'transaction');
  // a shared mail provider is never "the company"
  assert.equal(classify({ fromAddress: 'gmail@gmail.com', fromName: 'Gmail Team', subject: 'Din bestilling er sendt' }).kind, 'person');
});

test('words match whole words, so "sale" is not found in "resale" and Norwegian letters count as letters', () => {
  assert.equal(classify({ fromAddress: 'noreply@x.no', subject: 'Resale value', signals: ['unsub'] }).kind, 'promo'); // bulk fallback, not the word "sale"
  assert.ok(!classify({ fromAddress: 'noreply@x.no', subject: 'Resale value', signals: ['unsub'] }).why.includes('Sounds like an offer or a sale'));
  assert.ok(classify({ fromAddress: 'noreply@x.no', subject: 'Sale ends soon' }).why.includes('Sounds like an offer or a sale'));
  assert.equal(classify({ fromAddress: 'noreply@x.no', subject: 'Åpent hus i Ålesund' }).kind, 'update');
});

test('a receipt that arrives with an unsubscribe link is still a receipt', () => {
  assert.equal(classify({ fromAddress: 'orders@amazon.com', subject: 'Your order has shipped', signals: ['unsub', 'oneclick'] }).kind, 'transaction');
  assert.equal(classify({ fromAddress: 'shop@brand.no', subject: 'Ordrebekreftelse 12', signals: ['unsub'] }).kind, 'transaction');
});

test('an unsure message stays in Primary', () => {
  for (const subject of ['Hei', 'Kan du ringe meg?', 'Bilder fra turen', 'Re: møtet', 'Ny versjon av dokumentet']) assert.equal(classify({ fromAddress: 'ola@privat.no', subject, preview: 'hei' }).kind, 'person', subject);
});

test('signals: read from the headers, names in any case', () => {
  assert.deepEqual(signalsFromHeaders(undefined), []);
  assert.deepEqual(signalsFromHeaders([]), []);
  assert.deepEqual(signalsFromHeaders(hdr(['LIST-UNSUBSCRIBE', '<mailto:u@x>'])), ['unsub']);
  assert.deepEqual(signalsFromHeaders(hdr(['List-Unsubscribe', '<https://u>'], ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'], ['List-Id', '<news.x.no>'])), ['unsub', 'oneclick', 'list']);
  assert.deepEqual(signalsFromHeaders(hdr(['Precedence', 'bulk'])), ['bulk']);
  assert.deepEqual(signalsFromHeaders(hdr(['Precedence', 'list'])), ['bulk']);
  assert.deepEqual(signalsFromHeaders(hdr(['Precedence', 'auto_reply'])), ['auto']);
  assert.deepEqual(signalsFromHeaders(hdr(['Auto-Submitted', 'auto-generated'])), ['auto']);
  assert.deepEqual(signalsFromHeaders(hdr(['Auto-Submitted', 'no'])), []);
  assert.deepEqual(signalsFromHeaders(hdr(['X-Auto-Response-Suppress', 'All'])), ['auto']);
  assert.deepEqual(signalsFromHeaders(hdr(['X-Microsoft-Antispam', 'BCL:0;ARA:1'])), []);
  assert.deepEqual(signalsFromHeaders(hdr(['X-Microsoft-Antispam', 'BCL:7;ARA:1'])), ['bcl']);
  assert.deepEqual(signalsFromHeaders(hdr(['X-Mailgun-Sid', 'x'])), ['esp']);
  assert.deepEqual(signalsFromHeaders(hdr(['Feedback-ID', 'a:b:c'])), ['esp']);
  assert.deepEqual(signalsFromHeaders(hdr(['X-Mailer', 'Mailchimp Mailer - **CID123**'])), ['esp']);
  assert.deepEqual(signalsFromHeaders(hdr(['X-Mailer', 'Apple Mail (2.3774)'])), []);
  assert.deepEqual(signalsFromHeaders(hdr(['In-Reply-To', '<a@b>'])), ['thread']);
  assert.deepEqual(signalsFromHeaders(hdr(['References', '<a@b>'])), ['thread']);
});

test('signals: only the first of a repeated header counts, odd input never throws', () => {
  assert.deepEqual(signalsFromHeaders(hdr(['Auto-Submitted', 'no'], ['Auto-Submitted', 'auto-generated'])), []);
  assert.deepEqual(signalsFromHeaders([{ name: '', value: 'x' }, { name: 'List-Id', value: '' }, null as never, { name: 'X-Mailer' } as never]), []);
});

test('orgDomain: the company part of an address or a domain', () => {
  assert.equal(orgDomain('a@mail.elkjop.no'), 'elkjop.no');
  assert.equal(orgDomain('mail.elkjop.no'), 'elkjop.no');
  assert.equal(orgDomain('elkjop.no'), 'elkjop.no');
  assert.equal(orgDomain('A@News.Brand.COM'), 'brand.com');
  assert.equal(orgDomain('a@shop.example.co.uk'), 'example.co.uk');
  assert.equal(orgDomain('localhost'), 'localhost');
});

test('isFreemail: shared mail providers are never a company rule', () => {
  for (const d of ['gmail.com', 'anna@hotmail.com', 'mail.live.com', 'icloud.com', 'online.no']) assert.equal(isFreemail(d), true, d);
  for (const d of ['elkjop.no', 'anna@firma.no']) assert.equal(isFreemail(d), false, d);
});

test('ruleFor: the sender first, then the company, walking up subdomains', () => {
  const o: Record<string, Kind> = { 'a@x.brand.com': 'person', '@brand.com': 'promo', '@shop.no': 'update' };
  assert.deepEqual(ruleFor(o, 'A@X.brand.com'), { key: 'a@x.brand.com', kind: 'person', scope: 'sender' });
  assert.deepEqual(ruleFor(o, 'b@x.brand.com'), { key: '@brand.com', kind: 'promo', scope: 'company' });
  assert.deepEqual(ruleFor(o, 'b@deep.er.shop.no'), { key: '@shop.no', kind: 'update', scope: 'company' });
  assert.equal(ruleFor(o, 'b@other.no'), null);
  assert.equal(ruleFor(undefined, 'b@other.no'), null);
  assert.equal(ruleFor({ '@no': 'promo' }, 'b@other.no'), null, 'a bare top-level domain is never a company');
});

test('older saved names map onto the four kinds', () => {
  assert.equal(asKind('newsletter'), 'update');
  assert.equal(asKind('Receipts'), 'transaction');
  assert.equal(asKind('alert'), 'update');
  assert.equal(asKind('people'), 'person');
  assert.equal(asKind('promo'), 'promo');
  assert.equal(asKind('nonsense'), null);
  assert.equal(asKind(7), null);
  for (const k of KINDS) assert.equal(asKind(k), k);
});

test('a security code or sign-in alert is told apart from other Transactions (the alert server lets only these through)', () => {
  const v = (from: string, subject: string, preview = '', ctx: ClassifyContext = {}) => classify({ fromAddress: from, subject, preview }, ctx);
  assert.equal(isSecurityMail(v('noreply@github.com', 'Your verification code is 482913')), true);
  assert.equal(isSecurityMail(v('no-reply@accounts.google.com', 'Security alert: new sign-in on Pixel 9', 'Your Google Account was just signed in to from a new Pixel 9 device.')), true);
  assert.equal(isSecurityMail(v('varsel@dnb.no', 'Din engangskode er 394 118')), true);
  assert.equal(isSecurityMail(v('faktura@telenor.no', 'Faktura for september')), false, 'an invoice is a transaction, not a code');
  assert.equal(isSecurityMail(v('varsling@posten.no', 'Pakken din er på vei')), false);
  assert.equal(isSecurityMail(v('anna@x.no', 'Middag på fredag?')), false);
  assert.equal(isSecurityMail({ kind: 'promo', why: ['Looks like a security code or sign-in alert'] }), false, 'only in Transactions');
});

test('a code that arrives as digits counts as a code, in Norwegian and English (Apple, Slack, Facebook), unless it is a postal, tracking, ticket, invite or promo code', () => {
  const code = (from: string, fromName: string, subject: string, preview = '', signals?: string[]) => {
    const r = classify({ fromAddress: from, fromName, subject, preview, signals });
    return isSecurityMail(r) ? 'code' : r.kind;
  };
  // robots that send codes
  assert.equal(code('noreply@email.apple.com', 'Apple', 'Your Apple ID Code is: 482913', 'Your Apple ID Code is: 482913. Don’t share it with anyone.'), 'code');
  assert.equal(code('notification@slack.com', 'Slack', 'Slack: confirmation code 123-456', 'Your confirmation code is 123-456'), 'code');
  assert.equal(code('notification@slack.com', 'Slack', 'Slack: confirmation code 123-456'), 'code', 'in the subject alone');
  assert.equal(code('security@facebookmail.com', 'Facebook', '482913 is your Facebook confirmation code'), 'code');
  assert.equal(code('security@mail.instagram.com', 'Instagram', '482913 is your Instagram code'), 'code');
  assert.equal(code('no-reply@vipps.no', 'Vipps', 'Bruk koden 4821 for å bekrefte', 'Vipps: koden din er 4821'), 'code', 'a code is not a coupon, whatever "bruk koden" says elsewhere');
  assert.equal(code('bankid@bankid.no', 'BankID', 'Din kode er 482913'), 'code');
  assert.equal(code('bankid@bankid.no', 'BankID', 'Koden din er 482913'), 'code');
  assert.equal(code('noreply@service.com', 'Service', 'Code', 'Your code is 123 456'), 'code');
  assert.equal(code('noreply@bank.com', 'Bank', 'Sign in', 'Your OTP is 123456'), 'code');
  assert.equal(code('noreply@bank.no', 'Bank', 'Ny PIN-kode', 'Her er din nye PIN-kode'), 'code', 'no digits, but a robot says it is a PIN code');
  assert.equal(code('noreply@steampowered.com', 'Steam', 'Steam: new computer', 'Here is the Steam Guard code you need to login to account bob: 7QK2P'), 'code', 'letters and digits: the word "login" from a robot');
  // a promo code, a postal or tracking number, a bar code, a ticket or invite code: not codes
  assert.equal(code('info@shop.no', 'Shop', 'Bruk koden SOMMER20 i kassen', 'Rabatt på alt', ['unsub']), 'promo');
  assert.equal(code('hello@store.com', 'Store', 'Use code 2024 for 20% off', '', ['unsub']), 'promo');
  assert.equal(code('info@shop.no', 'Shop', 'Handle med kode 4821', 'Sparer du penger', ['unsub']), 'promo', 'a bare "code 4821" is not enough');
  for (const [name, preview] of [['Postal code', 'Your postal code is 0150'], ['Zip code', 'Your zip code is 90210'], ['Barcode', 'Your bar code is 12345678'], ['Tracking code', 'Your tracking code is 12345678'],
    ['Order code', 'Your order code is 12345678'], ['Ticket code', 'Your ticket code is 482913'], ['Invite code', 'Your invite code is 482913'], ['Referral code', 'Your referral code: 123456'],
    ['Redeem code', 'Your redeem code is 482913'], ['PIN code of the area', 'Your PIN code is 400001'], ['Dress code', 'The dress code is 2024 black tie'], ['Gift card code', 'Your gift card code is 12345678'],
    ['Booking code', 'Your booking confirmation code is 12345678'], ['Flight code', 'Flight confirmation code: 7654321'], ['Hotel code', 'Hotel confirmation code 12345678'], ['Order confirmation', 'Order confirmation code is 123456']]) {
    assert.notEqual(code('noreply@shop.com', 'Shop', name, preview), 'code', preview);
  }
  assert.notEqual(code('noreply@shop.com', 'Shop', 'Your number', 'Code 12345678901 is too long to be one'), 'code');
  assert.equal(code('anna@x.no', 'Anna', 'Kode til porten: 4521'), 'person');
  assert.equal(code('kari@firma.no', 'Kari', 'Koden til alarmen er 1234'), 'person');
  assert.equal(code('ola@hansen-bygg.no', 'Ola', 'Møte i morgen', 'Access code: 123456 for videomøtet'), 'person');
  assert.equal(code('per@firma.no', 'Per', 'Your code is 4821', 'the door code'), 'person', 'a person may write "your code is"');
  assert.equal(code('notifications@github.com', 'GitHub', '[reminder] Pull request #12 merged'), 'update');
});

test('a newsletter or an offer that says "log in", "password" or "new device" is not a code; mail sent in bulk counts only when it plainly is one', () => {
  const kind = (from: string, subject: string, preview = '', signals: string[] = []) => {
    const r = classify({ fromAddress: from, fromName: from.split('@')[0], subject, preview, signals });
    return isSecurityMail(r) ? 'code' : r.kind;
  };
  const bulk = ['unsub'];
  // bulk mail with the weak security words is never a code: next to an offer it is a promotion, on its own a notification
  assert.equal(kind('hello@store.com', 'Forgot your password? Log in and see what is new', 'New arrivals this week', bulk), 'promo');
  assert.equal(kind('news@saas.com', 'Product update: passkeys and a new sign-in page', 'Two-factor authentication is now available for everyone', bulk), 'update');
  assert.equal(kind('hello@phones.com', 'Got a new device? Accessories for it', 'Cases and chargers', bulk), 'update');
  assert.equal(kind('hello@quiz.com', 'Your code of the week', 'Tips from our developers', bulk), 'update');
  assert.equal(kind('hello@app.com', 'Welcome! Confirm your email', 'Confirm your email address to start', bulk), 'update');
  assert.equal(kind('hello@app.com', 'Invite friends: your referral code is 123456', 'Share it and both get a month free', bulk), 'promo');
  assert.equal(kind('hello@quiz.com', 'Your code is ready', 'Tips from our developers', bulk), 'update', 'plain words, no digits');
  assert.equal(kind('hello@quiz.com', 'Your code 2024', 'Tips from our developers', bulk), 'update', 'digits, but nothing says it is a code to type');
  assert.equal(kind('hello@shop.no', 'Your code is SAVE20', 'Save on shoes this week', bulk), 'promo', 'the plain words next to an offer in bulk mail are an advertisement');
  assert.equal(kind('hello@shop.no', 'Your code is 482913', 'Exclusive offer for members: save on shoes this week', bulk), 'promo', 'so are the digits');
  assert.equal(kind('hello@shop.no', 'Your code is 482913', 'Exclusive offer for members: save on shoes this week'), 'code', 'though not in mail that nobody sent in bulk');
  assert.equal(kind('notifications@github.com', '[org/repo] Fix login bug (#42)', 'Merged. The login page now works.', ['list']), 'update', 'a mailing list mentioning "login" is not a security alert');
  assert.equal(kind('no-reply@zoom.us', 'Meeting starts soon', 'Join with passcode 123456'), 'update', 'a meeting passcode is not a security code');
  // the same words from a robot with nothing else going on: a security alert; next to an offer, a receipt or a parcel: not
  assert.equal(kind('no-reply@accounts.google.com', 'Security alert', 'Your Google Account was just signed in to from a new Pixel 9 device.'), 'code');
  assert.equal(kind('no-reply@service.com', 'Reset your password', 'Click the link to choose a new password'), 'code');
  assert.equal(kind('noreply@brand.com', 'Login to see your new offers', 'Exclusive deals for you'), 'promo');
  assert.equal(kind('noreply@brand.com', 'Your order has shipped', 'Login to track your parcel'), 'transaction');
  assert.equal(kind('noreply@brand.com', 'Receipt for your payment', 'Login to download'), 'transaction');
  assert.equal(kind('noreply@brand.com', 'Login to see your account', 'Quiet this week'), 'code', 'the same word with no offer next to it');
  // a code is a code even when the sender adds an unsubscribe link
  assert.equal(kind('notification@slack.com', 'Slack: confirmation code 123-456', 'Your confirmation code is 123-456', bulk), 'code');
  assert.equal(kind('security@facebookmail.com', '482913 is your Facebook confirmation code', '', ['unsub', 'list']), 'code');
  assert.equal(kind('noreply@github.com', 'Your verification code is 482913', '', bulk), 'code');
  assert.equal(kind('bankid@bankid.no', 'Din engangskode er 482913', '', bulk), 'code');
  // the price of that: a sign-in alert (no code in it) that comes with an unsubscribe link sits in Updates and does not count
  assert.equal(kind('noreply@github.com', 'A new device signed in to your account', 'New sign-in from Chrome on Windows', bulk), 'update');
});

test('the fingerprint of the saved choices ignores order and case and changes with every choice (the phone and the alert server compare them)', () => {
  const rules: Record<string, Kind> = { 'b@x.no': 'promo', '@Shop.no': 'update', 'a@x.no': 'person' };
  assert.equal(rulesDigest(undefined), '0:811c9dc5');
  assert.equal(rulesDigest({}), '0:811c9dc5');
  assert.equal(rulesDigest(rules), rulesDigest({ 'a@x.no': 'person', '@shop.no': 'update', 'b@x.no': 'promo' }));
  assert.match(rulesDigest(rules), /^3:[0-9a-f]+$/);
  assert.notEqual(rulesDigest(rules), rulesDigest({ ...rules, 'b@x.no': 'update' }));
  assert.notEqual(rulesDigest(rules), rulesDigest({ ...rules, 'c@x.no': 'promo' }));
  assert.notEqual(rulesDigest({ 'a@x.no': 'person' }), rulesDigest({ 'a@x.no': 'promo' }));
  // names beyond plain letters still count (code points, not bytes)
  assert.notEqual(rulesDigest({ 'æ@x.no': 'person' }), rulesDigest({ 'ø@x.no': 'person' }));
});

test('only a choice of the shape an alert server can hold is sent to it (a sender, or a company with an @); the rest stays on the phone', () => {
  assert.equal(isRuleKey('anna@x.no'), true);
  assert.equal(isRuleKey('@shop.no'), true);
  for (const bad of ['', 'shop.no', '@', 'a@', 'a b@x.no', '@x.no ', 'a@@x.no', `${'a'.repeat(120)}@x.no`]) assert.equal(isRuleKey(bad), false, JSON.stringify(bad));
  const internal = '/o=firma/ou=exchange administrative group (fydibohf23spdlt)/cn=recipients/cn=ola';
  assert.deepEqual(sendableRules({ [internal]: 'update', 'Anna@X.no': 'person', '@Shop.no': 'promo' }), { 'anna@x.no': 'person', '@shop.no': 'promo' });
  assert.deepEqual(sendableRules(undefined), {});
  assert.equal(rulesDigest(sendableRules({ [internal]: 'update' })), rulesDigest({}), 'with nothing to send the phone and a server that holds nothing agree');
});

test('the alert server sorts with a copy of this very file: change this file, run `npm run build:functions` in supabase/ and commit what it writes', () => {
  const here = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const source = here('./classify.ts');
  const copy = here('../../../../../supabase/functions/post-alerts/classify.ts');
  const kind = /^export type Kind = [^;]+;$/m.exec(here('./types.ts'))![0];
  assert.ok(copy.endsWith(source.replace("import type { Kind } from './types.ts';", kind)), 'supabase/functions/post-alerts/classify.ts is stale');
  assert.ok(here('../../../../../supabase/dashboard/post-alerts.ts').includes(copy.trimEnd()), 'supabase/dashboard/post-alerts.ts is stale');
});
