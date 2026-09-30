import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain JS module outside src
import { render, SHARED, target } from '../../../../scripts/sync-shared.mjs';

test('the phone app copies of the shared files are up to date', () => {
  for (const f of SHARED as string[]) {
    assert.equal(readFileSync(target(f), 'utf8'), render(f), `apps/mobile/src/shared/${f} is stale: run node scripts/sync-shared.mjs`);
  }
});
