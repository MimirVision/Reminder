// The single-file function copies for the Supabase dashboard must match the real sources.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { bundle } from '../build-functions.mjs';

for (const name of ['suggest', 'import-report']) {
  const onDisk = readFileSync(new URL(`../dashboard/${name}.ts`, import.meta.url), 'utf8');
  assert.equal(onDisk, bundle(name), `dashboard/${name}.ts is stale: run npm run build:functions`);
  assert.doesNotMatch(onDisk, /from '\.\/logic\.ts'/, 'no relative imports in a single-file function');
  assert.match(onDisk, /Deno\.serve/, 'contains the handler');
  assert.match(onDisk, /export const SCHEMA/, 'contains the logic');
  assert.equal((onDisk.match(/^import /gm) ?? []).every((l) => true), true);
  for (const line of onDisk.split('\n').filter((l) => l.startsWith('import '))) {
    assert.match(line, /from '(npm:|node:)/, `only npm:/node: imports: ${line}`);
  }
}
console.log('dashboard bundles OK');
