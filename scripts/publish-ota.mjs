// Publishes the phone app's JavaScript as an over-the-air update, so small changes reach the phone without sideloading again.
// It exports the iOS bundle, writes a manifest in the Expo Updates format and puts everything under apps/web/public/ota/<runtimeVersion>/,
// which the website host (Cloudflare) serves. Run:  node scripts/publish-ota.mjs   then commit and push (docs/UPDATES.md).
// Only changes to JavaScript, text and images can travel this way. After changing native modules, permissions or app.json plugins,
// raise "runtimeVersion" in apps/mobile/app.json (and the number in updates.url) and build + sideload once.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const mobile = join(root, 'apps/mobile');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', ico: 'image/x-icon', svg: 'image/svg+xml' };
const sha256b64url = (buf) => createHash('sha256').update(buf).digest('base64url');

/** The public Supabase settings live in wrangler.jsonc (they are public by design); the environment can override them. */
function publicEnv() {
  const w = readFileSync(join(root, 'apps/web/wrangler.jsonc'), 'utf8');
  const pick = (k) => w.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`))?.[1];
  return {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? pick('VITE_SUPABASE_URL'),
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? pick('VITE_SUPABASE_ANON_KEY'),
  };
}

/** The manifest for one exported bundle. Pure (hashes and files are passed in) so it can be checked without exporting. */
export function buildManifest({ cfg, base, bundle, assets, now = new Date() }) {
  const id = createHash('sha256').update(bundle.hashHex).update(JSON.stringify(cfg)).digest('hex').slice(0, 32);
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
  return {
    id: uuid,
    createdAt: now.toISOString(),
    runtimeVersion: String(cfg.runtimeVersion),
    launchAsset: { hash: bundle.hash, key: `bundle-${bundle.hashHex.slice(0, 16)}`, contentType: 'application/javascript', url: `${base}/bundles/${bundle.file}` },
    assets: assets.map((a) => ({ hash: a.hash, key: a.key, fileExtension: `.${a.ext}`, contentType: MIME[a.ext] ?? 'application/octet-stream', url: `${base}/assets/${a.key}.${a.ext}` })),
    metadata: {},
    extra: { expoClient: cfg },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = JSON.parse(execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'], { cwd: mobile, encoding: 'utf8' }));
  if (!cfg.runtimeVersion || !cfg.updates?.url) throw new Error('apps/mobile/app.json needs runtimeVersion and updates.url');
  const rv = String(cfg.runtimeVersion);
  const base = cfg.updates.url.replace(/\/manifest\.json$/, '');
  if (!base.endsWith(`/ota/${rv}`)) throw new Error(`updates.url should end in /ota/${rv}/manifest.json, it is ${cfg.updates.url}`);

  const tmp = mkdtempSync(join(tmpdir(), 'ota-'));
  try {
    execFileSync('npx', ['expo', 'export', '--platform', 'ios', '--output-dir', tmp], { cwd: mobile, stdio: 'inherit', env: { ...process.env, ...publicEnv() } });
    const meta = JSON.parse(readFileSync(join(tmp, 'metadata.json'), 'utf8')).fileMetadata.ios;
    const bundleBytes = readFileSync(join(tmp, meta.bundle));
    const bundle = { file: meta.bundle.split('/').pop(), hash: sha256b64url(bundleBytes), hashHex: createHash('sha256').update(bundleBytes).digest('hex') };
    const assets = meta.assets.map((a) => ({ path: a.path, ext: a.ext, key: a.path.split('/').pop(), hash: sha256b64url(readFileSync(join(tmp, a.path))) }));

    const out = join(root, 'apps/web/public/ota', rv);
    rmSync(join(out, 'bundles'), { recursive: true, force: true }); // old bundles are not needed: the manifest names the latest
    mkdirSync(join(out, 'bundles'), { recursive: true });
    mkdirSync(join(out, 'assets'), { recursive: true });
    cpSync(join(tmp, meta.bundle), join(out, 'bundles', bundle.file));
    for (const a of assets) if (!existsSync(join(out, 'assets', `${a.key}.${a.ext}`))) cpSync(join(tmp, a.path), join(out, 'assets', `${a.key}.${a.ext}`));
    const manifest = buildManifest({ cfg, base, bundle, assets });
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Published update ${manifest.id} (runtime ${rv}): bundle ${(bundleBytes.length / 1e6).toFixed(1)} MB, ${assets.length} assets -> apps/web/public/ota/${rv}/`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
