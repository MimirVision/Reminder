import test from 'node:test';
import assert from 'node:assert/strict';
import { frameDocument, hasRemoteImages, inlineCids, stripDangerous, textToHtml } from './html.ts';

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

test('plain text is escaped, linked and line-broken', () => {
  assert.equal(textToHtml('a <b> & https://x.no/p.\nok'), 'a &lt;b&gt; &amp; <a href="https://x.no/p">https://x.no/p</a>.<br>ok');
});
