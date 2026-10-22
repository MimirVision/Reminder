import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Cloud containers ship a Chromium at this path; elsewhere Playwright uses its own (npx playwright install chromium).
const chromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:5191',
    viewport: { width: 390, height: 844 },
    launchOptions: existsSync(chromium) ? { executablePath: chromium } : {},
  },
  // The end-to-end tests run against demo mode, so they never touch a real database.
  webServer: {
    command: 'npx vite --port 5191 --strictPort',
    url: 'http://localhost:5191',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
});
