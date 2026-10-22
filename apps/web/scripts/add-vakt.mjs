// Adds Vakt (apps/vakt, a pay calculator for shift work) to this site at /vakt/, the way Ledger lives at /ledger/.
// Vakt keeps its own dependencies and build; this only builds it with base /vakt/ and copies the result into dist.
// If anything here fails, Home Memory, Post and Ledger still deploy: the error is printed and the build carries on.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const vakt = fileURLToPath(new URL('../../vakt/', import.meta.url));
const target = fileURLToPath(new URL('../dist/vakt/', import.meta.url));
const run = (cmd) => execSync(cmd, { cwd: vakt, stdio: 'inherit', env: { ...process.env, NODE_ENV: '' } });

try {
  if (!existsSync(vakt)) throw new Error('apps/vakt not found');
  console.log('\n[vakt] building apps/vakt for /vakt/ …');
  run('npm ci --no-audit --no-fund');
  run('npx tsc --noEmit');
  run('npx vite build --base /vakt/ --outDir dist-site --emptyOutDir');
  rmSync(target, { recursive: true, force: true });
  cpSync(fileURLToPath(new URL('dist-site/', `file://${vakt}`)), target, { recursive: true });
  rmSync(new URL('_headers', `file://${target}`), { force: true }); // only the site root's _headers counts
  console.log('[vakt] added at /vakt/');
} catch (e) {
  console.warn(`\n[vakt] WARNING: Vakt was not added to this build (${e.message}). Home Memory, Post and Ledger are unaffected.\n`);
}
