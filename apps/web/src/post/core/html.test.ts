import test from 'node:test';
import assert from 'node:assert/strict';
import { BLANK_PICTURE, frameDocument, hasRemoteImages, inlineCids, safeBlobType, shareType, stripDangerous, textToHtml } from './html.ts';

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
