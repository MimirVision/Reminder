import test from 'node:test';
import assert from 'node:assert/strict';
import { installKind, isIOS, isIOSSafari } from './install.ts';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

test('installed apps are left alone; Chrome offers its own prompt; iPhone Safari gets the manual steps', () => {
  assert.equal(installKind({ standalone: true, ua: IPHONE_SAFARI, hasPrompt: false }), 'installed');
  assert.equal(installKind({ standalone: false, ua: ANDROID, hasPrompt: true }), 'prompt');
  assert.equal(installKind({ standalone: false, ua: IPHONE_SAFARI, hasPrompt: false }), 'ios');
  assert.equal(installKind({ standalone: false, ua: IPHONE_CHROME, hasPrompt: false }), 'none');
  assert.equal(installKind({ standalone: false, ua: ANDROID, hasPrompt: false }), 'none');
});

test('iPadOS pretends to be a Mac: touch points give it away', () => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  assert.equal(isIOS(mac, 5), true);
  assert.equal(isIOS(mac, 0), false);
  assert.equal(isIOSSafari(IPHONE_CHROME), false);
});
