import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPush } from './pushCore.ts';

const base = { hasSW: true, hasPush: true, hasNotification: true, isIOS: false, standalone: false, vapidKey: 'k' };

test('push readiness: not set up, iPhone needs the Home Screen app, old browsers, and the good case', () => {
  assert.equal(classifyPush({ ...base, vapidKey: undefined }), 'not-configured');
  assert.equal(classifyPush({ ...base, isIOS: true }), 'needs-install');
  assert.equal(classifyPush({ ...base, isIOS: true, standalone: true }), 'ok');
  assert.equal(classifyPush({ ...base, hasPush: false }), 'unsupported');
  assert.equal(classifyPush(base), 'ok');
});
