import test from 'node:test';
import assert from 'node:assert/strict';
import { addTags, allTags, extractTags, normalizeTag, removeTag } from './tags.ts';

test('a tag is lower case without # or odd characters', () => {
  assert.equal(normalizeTag(' #Barn! '), 'barn');
  assert.equal(normalizeTag('##'), '');
  assert.equal(normalizeTag('Ærend'), 'ærend');
});

test('adding tags: several at once, no duplicates, capped', () => {
  assert.deepEqual(addTags(['a'], '#b, a  c'), ['a', 'b', 'c']);
  assert.equal(addTags(Array.from({ length: 12 }, (_, i) => `t${i}`), 'more').length, 12);
  assert.deepEqual(removeTag(['a', 'b'], 'a'), ['b']);
});

test('#tags are pulled out of a sentence', () => {
  assert.deepEqual(extractTags('Buy milk #errands #Kids'), { text: 'Buy milk', tags: ['errands', 'kids'] });
  assert.deepEqual(extractTags('#work call Ola'), { text: 'call Ola', tags: ['work'] });
  assert.deepEqual(extractTags('Pick up #2 pencils'), { text: 'Pick up #2 pencils', tags: [] });
  assert.deepEqual(extractTags('mail#x stays'), { text: 'mail#x stays', tags: [] });
});

test('tags in use, most used first', () => {
  assert.deepEqual(allTags([{ tags: ['b', 'a'] }, { tags: ['b'] }, {}]), [{ tag: 'b', count: 2 }, { tag: 'a', count: 1 }]);
});
