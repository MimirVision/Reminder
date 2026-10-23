import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const commit = (env.WORKERS_CI_COMMIT_SHA ?? env.CF_PAGES_COMMIT_SHA ?? env.GITHUB_SHA ?? 'dev').slice(0, 7);
const built = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Shown at the bottom of Oppsett, so it's easy to see which version is running.
  define: { __BUILD__: JSON.stringify(`${commit} · ${built} UTC`) },
  build: { chunkSizeWarningLimit: 800 },
  server: { port: 5190 },
  preview: { port: 5190 },
});
