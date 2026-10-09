import test from 'node:test';
import assert from 'node:assert/strict';
import { isForward, splitQuotedHtml, splitQuotedText } from './quoted.ts';

const OUTLOOK_WEB = '<div dir="ltr">Den er grei, da ser vi hva vi gjør :) Ha en fortsatt fin dag.</div><div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font><b>From:</b> Reidun &lt;r@hotmail.com&gt;<br><b>Sent:</b> Monday, 05 October 2026 08:18:42<br><b>To:</b> Andreas<br><b>Subject:</b> Re: Leie</font><div>&nbsp;</div></div><div>Hei! Nei, dessverre</div><hr><div><b>From:</b> Andreas<br><b>Sent:</b> Sunday</div><div>Hei Reidun</div>';

test('Outlook on the web: the answer stays, the rule, the header block and everything under it is the quote', () => {
  const s = splitQuotedHtml(OUTLOOK_WEB);
  assert.equal(s.main, '<div dir="ltr">Den er grei, da ser vi hva vi gjør :) Ha en fortsatt fin dag.</div>');
  assert.equal(s.main + s.rest, OUTLOOK_WEB);
  assert.match(s.rest, /^<div id="appendonsend">/);
});

test('Outlook on a computer: a box with a top border and a From: line in bold', () => {
  const h = '<p>Takk, det passer fint.</p><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm"><p class="MsoNormal"><b>Fra:</b> Per<br><b>Sendt:</b> mandag 5. oktober<br><b>Til:</b> Meg</p></div><p>Gammel tekst</p>';
  const s = splitQuotedHtml(h);
  assert.equal(s.main, '<p>Takk, det passer fint.</p>');
  assert.match(s.rest, /^<div style="border:none;border-top/);
});

test('a bare rule followed by From: and Sent: is the start of the quote, a rule on its own is not', () => {
  const s = splitQuotedHtml('<p>Ja</p><hr><p><strong>From:</strong> A<br><strong>Sent:</strong> B</p><p>old</p>');
  assert.equal(s.main, '<p>Ja</p>');
  const none = splitQuotedHtml('<p>Del 1</p><hr><p>Del 2</p>');
  assert.equal(none.rest, '');
});

test('Gmail, Apple Mail and Thunderbird quotes', () => {
  assert.equal(splitQuotedHtml('<div>Hi</div><br><div class="gmail_quote"><div>On Mon, A wrote:</div><blockquote class="gmail_quote">old</blockquote></div>').main, '<div>Hi</div><br>');
  const apple = splitQuotedHtml('<div>Fine</div><div><br><blockquote type="cite"><div>old</div></blockquote></div>');
  assert.match(apple.main, /^<div>Fine<\/div>/);
  assert.match(apple.rest, /<blockquote type="cite">/);
});

test('"On … wrote:" above a quote goes with the quote', () => {
  const s = splitQuotedHtml('<div>Fine</div><div>On 5 Oct 2026, at 08:18, Reidun &lt;r@x.no&gt; wrote:</div><blockquote type="cite">old</blockquote>');
  assert.equal(s.main, '<div>Fine</div>');
  const no = splitQuotedHtml('<div>Fint</div><div>Den man. 5. okt. 2026 kl. 08:18 skrev Reidun:</div><blockquote type="cite">gammelt</blockquote>');
  assert.equal(no.main, '<div>Fint</div>');
});

test('nothing quoted, or nothing new above the quote: the message is shown whole', () => {
  assert.equal(splitQuotedHtml('<p>Hello</p>').rest, '');
  assert.equal(splitQuotedHtml('<div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>From:</b> A<br><b>Sent:</b> B</div><p>forwarded</p>').rest, '');
  assert.equal(splitQuotedHtml('<style>p{color:red}</style><blockquote type="cite">only a quote</blockquote>').rest, '');
});

test('the text and the quote together are always the original', () => {
  for (const h of [OUTLOOK_WEB, '<p>a</p><blockquote type="cite">b</blockquote>', '<p>x</p>']) { const s = splitQuotedHtml(h); assert.equal(s.main + s.rest, h); }
});

test('plain text: > lines, "On … wrote:", Original Message and header blocks', () => {
  assert.deepEqual(splitQuotedText('Fine\n\nOn Mon, 5 Oct 2026, Reidun wrote:\n> old\n> older'), { main: 'Fine', rest: '\n\nOn Mon, 5 Oct 2026, Reidun wrote:\n> old\n> older' });
  assert.equal(splitQuotedText('Fine\n> old').main, 'Fine');
  assert.equal(splitQuotedText('Fine\n\n-----Original Message-----\nFrom: A\nSent: B\nold').main, 'Fine');
  assert.equal(splitQuotedText('Fint\n\nFra: A\nSendt: B\nTil: C\ngammelt').main, 'Fint');
  assert.equal(splitQuotedText('Den man. 5. okt. 2026 skrev Reidun:\n> gammelt').rest, '');
  assert.equal(splitQuotedText('Just a note.\nFrom Anna with love').rest, '');
});

test('a forward is never folded', () => {
  assert.ok(isForward('Fwd: Leie') && isForward('VS: Leie') && isForward('FW: x'));
  assert.ok(!isForward('Re: Leie') && !isForward('Forward looking'));
});
