// Adds Ledger (apps/ledger, a separate accounting app) to this site at /ledger/, the way Post lives at /post/.
// Ledger keeps its own dependencies and build; this only builds it with base /ledger/ and copies the result into dist.
// If anything here fails, Home Memory and Post still deploy: the error is printed and the build carries on.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ledger = fileURLToPath(new URL('../../ledger/', import.meta.url));
const target = fileURLToPath(new URL('../dist/ledger/', import.meta.url));
const run = (cmd) => execSync(cmd, { cwd: ledger, stdio: 'inherit', env: { ...process.env, NODE_ENV: '' } });

try {
  if (!existsSync(ledger)) throw new Error('apps/ledger not found');
  console.log('\n[ledger] building apps/ledger for /ledger/ …');
  run('npm ci --no-audit --no-fund');
  run('npx tsc --noEmit');
  run('npx vite build --base /ledger/ --outDir dist-site --emptyOutDir');
  rmSync(target, { recursive: true, force: true });
  cpSync(fileURLToPath(new URL('dist-site/', `file://${ledger}`)), target, { recursive: true });
  rmSync(new URL('_headers', `file://${target}`), { force: true }); // only the site root's _headers counts
  console.log('[ledger] added at /ledger/');
} catch (e) {
  console.warn(`\n[ledger] WARNING: Ledger was not added to this build (${e.message}). Home Memory and Post are unaffected.\n`);
}
