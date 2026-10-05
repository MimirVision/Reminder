import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build stamp shown in Settings, so you can see which version a phone is really running (Netlify sets COMMIT_REF).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const commit = (env.COMMIT_REF ?? env.CF_PAGES_COMMIT_SHA ?? 'dev').slice(0, 7);
const built = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(`${commit} · ${built} UTC`) },
  // Two pages: Home Memory at / and the Post mail app at /post/.
  build: { rollupOptions: { input: { main: 'index.html', post: 'post/index.html' } } },
});
