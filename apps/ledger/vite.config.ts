import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const commit = (env.COMMIT_REF ?? env.CF_PAGES_COMMIT_SHA ?? env.GITHUB_SHA ?? 'dev').slice(0, 7);
const built = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: { __BUILD__: JSON.stringify(`${commit} · ${built} UTC`) },
  // `--mode artifact` builds one self-contained page (fonts inlined, one script, one stylesheet); see scripts/inline-artifact.mjs.
  build: mode === 'artifact'
    ? { outDir: 'dist-artifact', assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false, chunkSizeWarningLimit: 2000 }
    : { chunkSizeWarningLimit: 800 },
  server: { port: 5180 },
  preview: { port: 5180 },
}));
