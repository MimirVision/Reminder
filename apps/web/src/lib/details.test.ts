import test from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, detailsOf, emptyDetails, newFields } from './details.ts';

const list = [{ id: 'a', text: 'tent', done: false }];

test('a new to-do sends only what is used', () => {
  assert.deepEqual(newFields(emptyDetails(), true), {});
  assert.deepEqual(newFields({ notes: ' key under the mat ', checklist: list, priority: 2, remind_before: 30 }, true), { notes: 'key under the mat', checklist: list, priority: 2, remind_before: 30 });
  assert.deepEqual(newFields({ ...emptyDetails(), remind_before: 30 }, false), {}, 'a reminder needs a date');
  assert.deepEqual(newFields({ ...emptyDetails(), remind_before: 0 }, true), { remind_before: 0 }, '"at the time" is a real choice');
});

test('an edit sends only what changed, and clears with null', () => {
  const was = detailsOf({ notes: 'old', checklist: list, priority: 1, remind_before: 10 });
  assert.deepEqual(changedFields(was, was, true), {});
  assert.deepEqual(changedFields({ ...was, notes: '' }, was, true), { notes: null });
  assert.deepEqual(changedFields({ ...was, priority: 3 }, was, true), { priority: 3 });
  assert.deepEqual(changedFields({ ...was, checklist: [{ ...list[0], done: true }] }, was, true), { checklist: [{ id: 'a', text: 'tent', done: true }] });
  assert.deepEqual(changedFields(was, was, false), { remind_before: null }, 'removing the date removes the reminder');
});

test('details read safely from a row that has none (database not upgraded yet)', () => {
  assert.deepEqual(detailsOf({}), emptyDetails());
  assert.deepEqual(detailsOf(null), emptyDetails());
});
