import test from 'node:test';
import assert from 'node:assert/strict';
import { addPicked, createByteCache, emlName, extOf, fileKind, kindWord, mimeOf, saveName, tileLabel, totalBytes, uniqueName, viewable, MAX_OUT_TOTAL, type Picked } from './files.ts';

const pick = (name: string, size: number, type = ''): Picked => ({ name, type, size, arrayBuffer: async () => new Uint8Array(size).fill(7).buffer });

test('a file is known by its name first, because Outlook often says only "octet-stream"', () => {
  assert.equal(fileKind('Kontrakt.PDF', 'application/octet-stream'), 'pdf');
  assert.equal(fileKind('bilde.jpeg'), 'image');
  assert.equal(fileKind('regnskap.xlsx', ''), 'sheet');
  assert.equal(fileKind('brev.docx'), 'word');
  assert.equal(fileKind('x.pptx'), 'slides');
  assert.equal(fileKind('a.zip'), 'zip');
  assert.equal(fileKind('invite.ics'), 'calendar');
  assert.equal(fileKind('Re hei.eml'), 'mail');
  assert.equal(fileKind('noext', 'application/pdf'), 'pdf');
  assert.equal(fileKind('noext', 'image/heic'), 'image');
  assert.equal(fileKind('noext', 'video/mp4'), 'video');
  assert.equal(fileKind('noext', 'text/html'), 'other');
  assert.equal(fileKind('noext', 'text/x-log'), 'text');
  assert.equal(fileKind('weird.xyz', 'application/octet-stream'), 'other');
});

test('the type is Outlook\'s own unless it says nothing', () => {
  assert.equal(mimeOf('a.pdf', 'application/pdf; charset=binary'), 'application/pdf');
  assert.equal(mimeOf('a.pdf', 'application/octet-stream'), 'application/pdf');
  assert.equal(mimeOf('a.PNG', ''), 'image/png');
  assert.equal(mimeOf('a.unknownext', ''), 'application/octet-stream');
  assert.equal(mimeOf('a.pdf', 'text/plain'), 'text/plain');
});

test('only pages, pictures and plain text are shown inside Post, never anything that can run code', () => {
  assert.equal(viewable('a.pdf'), 'pdf');
  assert.equal(viewable('a.jpg', 'application/octet-stream'), 'image');
  assert.equal(viewable('a.heic'), 'image');
  assert.equal(viewable('a.csv'), 'text');
  assert.equal(viewable('a.svg', 'image/svg+xml'), null);
  assert.equal(viewable('trick.svg', 'image/png'), null);
  assert.equal(viewable('a.html', 'text/html'), null);
  assert.equal(viewable('a.docx'), null);
  assert.equal(viewable('a.zip'), null);
});

test('a saved name has no folders or forbidden characters, and is never empty or very long', () => {
  assert.equal(saveName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(saveName('a:b*c?.pdf'), 'a_b_c_.pdf');
  assert.equal(saveName('  .hidden  '), 'hidden');
  assert.equal(saveName(''), 'attachment');
  assert.equal(saveName('\u0000\u0001'), '_');
  assert.equal(saveName('', 'file'), 'file');
  const long = saveName(`${'å'.repeat(300)}.pdf`);
  assert.ok(long.length <= 120 && long.endsWith('.pdf'), long.length.toString());
  assert.equal(saveName('Signert kontrakt - Vestre Einaren 20.pdf'), 'Signert kontrakt - Vestre Einaren 20.pdf');
});

test('an attached message is saved as an .eml', () => {
  assert.equal(emlName('Re: hei'), 'Re_ hei.eml');
  assert.equal(emlName('x.eml'), 'x.eml');
  assert.equal(emlName(''), 'message.eml');
});

test('extension is the last dot, and a leading dot is not one', () => {
  assert.equal(extOf('a.tar.gz'), 'gz');
  assert.equal(extOf('.bashrc'), '');
  assert.equal(extOf('trailing.'), '');
  assert.equal(extOf('A.PDF'), 'pdf');
});

test('the same name twice becomes "name (2)", "name (3)", keeping the ending', () => {
  assert.equal(uniqueName('a.pdf', []), 'a.pdf');
  assert.equal(uniqueName('a.pdf', ['A.PDF']), 'a (2).pdf');
  assert.equal(uniqueName('a.pdf', ['a.pdf', 'a (2).pdf']), 'a (3).pdf');
  assert.equal(uniqueName('README', ['readme']), 'README (2)');
});

test('picked files are added with their bytes, names kept apart and types filled in', async () => {
  const { files, problems } = await addPicked([], [pick('a.pdf', 10, 'application/octet-stream'), pick('a.pdf', 20), pick('b.png', 5, 'image/png')]);
  assert.deepEqual(problems, []);
  assert.deepEqual(files.map((f) => [f.name, f.type, f.bytes.byteLength]), [['a.pdf', 'application/pdf', 10], ['a (2).pdf', 'application/pdf', 20], ['b.png', 'image/png', 5]]);
  assert.equal(files[0].bytes[0], 7);
});

test('a list the browser empties while the files are being read (the picker is reset, a drop is over) still adds every file', async () => {
  // Browsers hand over a live list: once the handler returns the list is empty, long before the second file has been read.
  const live: Picked[] = [pick('a.pdf', 10), pick('b.pdf', 20), pick('c.pdf', 30)];
  const wait = (p: Picked): Picked => ({ ...p, arrayBuffer: async () => { await new Promise((r) => setTimeout(r, 5)); return p.arrayBuffer(); } });
  const list = live.map(wait);
  const pending = addPicked([], list);
  list.length = 0; // what the browser does right after the handler returns
  const { files, problems } = await pending;
  assert.deepEqual(problems, []);
  assert.deepEqual(files.map((f) => f.name), ['a.pdf', 'b.pdf', 'c.pdf']);
});

test('an empty file is left out with a sentence, and the others still go', async () => {
  const { files, problems } = await addPicked([], [pick('tom.txt', 0), pick('ok.txt', 3)]);
  assert.deepEqual(files.map((f) => f.name), ['ok.txt']);
  assert.match(problems[0], /tom\.txt is empty/);
});

test('a file that cannot be read is left out with advice, and the others still go', async () => {
  const broken: Picked = { name: 'sky.docx', type: '', size: 100, arrayBuffer: async () => { throw new Error('NotReadable'); } };
  const { files, problems } = await addPicked([], [broken, pick('ok.txt', 3)]);
  assert.deepEqual(files.map((f) => f.name), ['ok.txt']);
  assert.match(problems[0], /sky\.docx could not be read.*iCloud/);
});

test('the size limit counts what is already attached, and only the file that does not fit is left out', async () => {
  const current = [{ name: 'a.bin', type: '', bytes: new Uint8Array(15) }];
  const { files, problems } = await addPicked(current, [pick('big.bin', 10), pick('small.bin', 4), pick('one-more.bin', 2)], 20);
  assert.deepEqual(files.map((f) => f.name), ['a.bin', 'small.bin']);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /big\.bin would make the message bigger than/);
  assert.equal(totalBytes(files), 19);
  assert.equal(MAX_OUT_TOTAL, 20 * 1024 * 1024);
});

test('a file that says it is small but is not is still caught by what was really read', async () => {
  const liar: Picked = { name: 'lie.bin', type: '', size: 1, arrayBuffer: async () => new Uint8Array(50).buffer };
  const { files, problems } = await addPicked([], [liar], 20);
  assert.equal(files.length, 0);
  assert.match(problems[0], /lie\.bin would make the message bigger/);
});

test('the memory of downloads forgets the longest unused first, and keeps nothing bigger than itself', () => {
  const cache = createByteCache<{ bytes: Uint8Array }>(10);
  const f = (n: number) => ({ bytes: new Uint8Array(n) });
  cache.set('a', f(4)); cache.set('b', f(4));
  assert.ok(cache.get('a'));            // a is used again, so b is now the oldest
  cache.set('c', f(4));
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a') && cache.get('c'));
  assert.equal(cache.size, 8);
  cache.set('huge', f(11));
  assert.equal(cache.get('huge'), undefined);
  assert.equal(cache.count, 2);
  cache.set('a', f(2));                 // replacing counts the new size, not both
  assert.equal(cache.size, 6);
  cache.clear();
  assert.equal(cache.count, 0);
});

test('a file is described in words and by the few letters on its tile', () => {
  assert.equal(kindWord(fileKind('a.pdf')), 'PDF document');
  assert.equal(kindWord(fileKind('a.xlsx')), 'Spreadsheet');
  assert.equal(kindWord(fileKind('noext')), 'File');
  assert.equal(tileLabel('Kontrakt.pdf'), 'PDF');
  assert.equal(tileLabel('brev.docx'), 'DOCX');
  assert.equal(tileLabel('a.verylongending'), 'VERY');
  assert.equal(tileLabel('noext'), 'FILE');
  assert.equal(tileLabel('Re hei', 'item'), 'MAIL');
  assert.equal(tileLabel('Sky.docx', 'link'), 'LINK');
});
