import test from 'node:test';
import assert from 'node:assert/strict';
import { BLANK_PICTURE, fixPictureUrls, frameDocument, hasRemoteImages, inlineCids, safeBlobType, shareType, stripDangerous, textToHtml } from './html.ts';

test('scripts, iframes, forms, handlers and javascript: links are removed', () => {
  const out = stripDangerous('<p onclick="x()">a</p><script>alert(1)</script><iframe src="https://e"></iframe><form action="/"><input></form><a href="javascript:alert(1)">l</a><meta http-equiv="refresh" content="0;url=https://e">');
  assert.doesNotMatch(out, /<script|<iframe|<form|onclick|javascript:|refresh/i);
  assert.match(out, /<p>a<\/p>/);
});

test('the frame blocks remote images by default and allows them on request', () => {
  assert.match(frameDocument('<p>x</p>', { remoteImages: false, dark: false }), /img-src data:;/);
  assert.match(frameDocument('<p>x</p>', { remoteImages: true, dark: false }), /img-src data: https: http:;/);
});

test('the frame allows no scripts and opens links in a new tab', () => {
  const d = frameDocument('<a href="https://x">x</a>', { remoteImages: false, dark: false });
  assert.match(d, /default-src 'none'/);
  assert.doesNotMatch(d, /script-src/);
  assert.match(d, /<base target="_blank">/);
});

test('detects tracking-style remote images', () => {
  assert.equal(hasRemoteImages('<img src="https://t.example/p.gif">'), true);
  assert.equal(hasRemoteImages('<div style="background:url(https://x/y.png)">'), true);
  assert.equal(hasRemoteImages('<img src="data:image/png;base64,AAAA">'), false);
  assert.equal(hasRemoteImages('<p>hello</p>'), false);
});

test('cid pictures are swapped for their data', () => {
  assert.equal(inlineCids('<img src="cid:abc">', { abc: 'data:image/png;base64,AA' }), '<img src="data:image/png;base64,AA">');
  assert.equal(inlineCids('<img src="cid:zzz">', {}), '<img src="cid:zzz">');
});

test('a picture that is not known is blanked where a picture goes, never in the text', () => {
  const html = '<img src="cid:zzz"><img src=\'cid:y\'><div style="background:url(cid:q)"></div><td background="cid:b"></td><p>the code is cid:abc</p>';
  const out = inlineCids(html, { known: 'data:image/png;base64,AA' }, BLANK_PICTURE);
  assert.doesNotMatch(out, /src="cid:|src='cid:|url\(cid:|background="cid:/);
  assert.match(out, /<img src="data:image\/gif;base64,/);
  assert.match(out, /<p>the code is cid:abc<\/p>/);
  assert.equal(inlineCids('<img src="cid:KNOWN">', { known: 'data:x' }, BLANK_PICTURE), '<img src="data:x">');
});

test('plain text is escaped, linked and line-broken', () => {
  assert.equal(textToHtml('a <b> & https://x.no/p.\nok'), 'a &lt;b&gt; &amp; <a href="https://x.no/p">https://x.no/p</a>.<br>ok');
});

test('links open without access back to Post', () => {
  assert.match(stripDangerous('<a href="https://x">x</a>'), /<a rel="noopener noreferrer" href="https:\/\/x">/);
});

test('attachments that could run code are never opened with their own type', () => {
  for (const [t, n] of [['text/html', 'a.html'], ['image/svg+xml', 'a.svg'], ['application/octet-stream', 'x.HTML'], ['text/xml', 'a.xml'], ['application/x-sh', 'a.sh'], ['image/png', 'evil.svg'], ['application/javascript', 'a.js']]) {
    assert.equal(safeBlobType(t, n), 'application/octet-stream', `${t} ${n}`);
  }
  assert.equal(safeBlobType('application/pdf', 'a.pdf'), 'application/pdf');
  assert.equal(safeBlobType('image/jpeg; charset=x', 'a.jpg'), 'image/jpeg');
  assert.equal(safeBlobType('application/vnd.ms-excel', 'a.xls'), 'application/octet-stream');
});

test('the share sheet gets the real type of a file, except for what could run code', () => {
  assert.equal(shareType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Brev.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(shareType('application/pdf; charset=binary', 'a.pdf'), 'application/pdf');
  assert.equal(shareType('image/heic', 'IMG_1.heic'), 'image/heic');
  assert.equal(shareType('image/svg+xml', 'x.svg'), 'application/octet-stream');
  assert.equal(shareType('text/html', 'side.html'), 'application/octet-stream');
  assert.equal(shareType('application/octet-stream', 'side.html'), 'application/octet-stream');
  assert.equal(shareType('', 'a.bin'), 'application/octet-stream');
  assert.equal(shareType('not a type', 'a.bin'), 'application/octet-stream');
  // what is opened from Post's own address is still limited to the few types that cannot run code
  assert.equal(safeBlobType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Brev.docx'), 'application/octet-stream');
});

test('picture addresses are made loadable inside the frame', async () => {
  const { fixPictureUrls } = await import('./html.ts');
  assert.equal(fixPictureUrls('<img src="//cdn.x.no/a.png">'), '<img src="https://cdn.x.no/a.png">');
  assert.equal(fixPictureUrls("<img width=1 src='http://x.no/a.png'>"), "<img width=1 src='https://x.no/a.png'>");
  assert.equal(fixPictureUrls('<td style="background:url(//x.no/b.png)">'), '<td style="background:url(https://x.no/b.png)">');
  assert.equal(fixPictureUrls('<a href="http://x.no">l</a>'), '<a href="http://x.no">l</a>');
  assert.ok(hasRemoteImages('<img src="//x.no/a.png">'));
});

test('links in plain-text mail end where the address ends: not at a wrapping <> or quote, not at the sentence', () => {
  assert.equal(textToHtml('see <https://x.no/p> now'), 'see &lt;<a href="https://x.no/p">https://x.no/p</a>&gt; now');
  assert.equal(textToHtml('"https://x.no/q" ok'), '&quot;<a href="https://x.no/q">https://x.no/q</a>&quot; ok');
  assert.equal(textToHtml('a (https://x.no/a) b'), 'a (<a href="https://x.no/a">https://x.no/a</a>) b');
  assert.equal(textToHtml('wiki https://x.no/a_(b) ok'), 'wiki <a href="https://x.no/a_(b)">https://x.no/a_(b)</a> ok');
  assert.equal(textToHtml('https://x.no/a?x=1&y=2, ok.'), '<a href="https://x.no/a?x=1&amp;y=2">https://x.no/a?x=1&amp;y=2</a>, ok.');
  assert.equal(textToHtml('https://x.no/p?!'), '<a href="https://x.no/p">https://x.no/p</a>?!');
  assert.equal(textToHtml('just https:// here'), 'just https:// here');
});

test('hostile messages made of thousands of unfinished tags are handled in no time', () => {
  const nasty = ['<form '.repeat(40_000), '<img src='.repeat(40_000), '<img src="'.repeat(40_000), '<meta http-equiv='.repeat(40_000), '<script>'.repeat(40_000), 'url('.repeat(60_000)];
  for (const h of nasty) {
    const t0 = Date.now();
    stripDangerous(h); hasRemoteImages(h); frameDocument(h, { remoteImages: false, dark: false });
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms for ${h.slice(0, 12)}`);
  }
});

test('the tag-by-tag reading keeps what it did: remote pictures found and fixed, meta refresh removed, other meta kept', () => {
  assert.equal(hasRemoteImages('<p><img alt="x" width=1 src="//cdn.x.no/a.png"></p>'), true);
  assert.equal(hasRemoteImages('<img src="cid:abc">'), false);
  assert.match(fixPictureUrls('<img alt="x" src="//cdn.x.no/a.png" srcset="//a/1.png 1x, http://a/2.png 2x">'), /src="https:\/\/cdn\.x\.no\/a\.png" srcset="https:\/\/a\/1\.png 1x, https:\/\/a\/2\.png 2x"/);
  assert.equal(stripDangerous('<meta http-equiv="refresh" content="0;url=https://e"><meta charset="utf-8"><p>x</p>'), '<meta charset="utf-8"><p>x</p>');
  assert.equal(stripDangerous('a<script>alert(1)'), 'a');
  assert.equal(stripDangerous('a<script>1</script>b<script>2</script>c'), 'abc');
});
