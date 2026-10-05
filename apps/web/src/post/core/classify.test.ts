import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classify.ts';

const base = { fromAddress: 'anna@example.no', fromName: 'Anna', subject: 'Middag?' };

test('a normal message from a person is a person', () => {
  const c = classify(base);
  assert.equal(c.kind, 'person');
  assert.deepEqual(c.why, ['Written by a person']);
});

test('List-Unsubscribe makes a newsletter and says why', () => {
  const c = classify({ ...base, fromAddress: 'news@butikk.no', headers: [{ name: 'List-Unsubscribe', value: '<https://x>' }] });
  assert.equal(c.kind, 'newsletter');
  assert.ok(c.why.includes('Has an unsubscribe link'));
});

test('header names are case-insensitive', () => {
  assert.equal(classify({ ...base, headers: [{ name: 'LIST-ID', value: 'x' }] }).kind, 'newsletter');
});

test('Norwegian and English receipts from a robot are receipts', () => {
  assert.equal(classify({ fromAddress: 'noreply@vipps.no', fromName: 'Vipps', subject: 'Din kvittering fra Rema' }).kind, 'receipt');
  assert.equal(classify({ fromAddress: 'no-reply@shop.com', fromName: 'Shop', subject: 'Your order #123' }).kind, 'receipt');
});

test('a person who writes "faktura" in the subject stays a person unless it is automatic', () => {
  assert.equal(classify({ ...base, subject: 'Re: ordrebekreftelse fra deg' }).kind, 'person');
});

test('delivery and security notifications are alerts', () => {
  assert.equal(classify({ fromAddress: 'varsel@posten.no', fromName: 'Posten', subject: 'Pakken din er levert' }).kind, 'alert');
  assert.equal(classify({ fromAddress: 'security@microsoft.com', fromName: 'Microsoft', subject: 'Security alert', headers: [{ name: 'Auto-Submitted', value: 'auto-generated' }] }).kind, 'alert');
});

test('Auto-Submitted: no does not count as automatic', () => {
  assert.equal(classify({ ...base, headers: [{ name: 'Auto-Submitted', value: 'no' }] }).kind, 'person');
});

test('Precedence: bulk is a newsletter', () => {
  assert.equal(classify({ ...base, headers: [{ name: 'Precedence', value: 'bulk' }] }).kind, 'newsletter');
});

test('a per-sender override always wins, with its own reason', () => {
  const c = classify({ fromAddress: 'noreply@x.no', subject: 'kvittering' }, { 'noreply@x.no': 'person' });
  assert.equal(c.kind, 'person');
  assert.equal(c.why[0], 'You moved this sender here');
});

test('every verdict has at least one reason', () => {
  for (const subject of ['a', 'Faktura', 'Levert', '']) assert.ok(classify({ fromAddress: 'info@x.no', subject }).why.length >= 1);
});
