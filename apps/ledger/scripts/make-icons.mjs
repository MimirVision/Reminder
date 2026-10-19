// Renders the PNG app icons (install, home screen, Apple touch) from the same mark as public/icon.svg.
// Run once after changing the icon: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';

const mark = (size, { rounded, inset }) => {
  // `inset` shrinks the L into the safe zone that Android's maskable icons keep (the middle 80%).
  const s = 64, k = inset ? 0.72 : 1, o = (s - s * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="#18191d"/>
    <g transform="translate(${o} ${o}) scale(${k})"><path d="M24 16v32h18" fill="none" stroke="#f5f4f0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg>`;
};
const out = [
  ['icon-192.png', 192, { rounded: true }], ['icon-512.png', 512, { rounded: true }],
  ['maskable-512.png', 512, { rounded: false, inset: true }], ['apple-touch-icon.png', 180, { rounded: false }],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const page = await browser.newPage();
for (const [name, size, opts] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${mark(size, opts)}`);
  await page.locator('svg').screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true });
  console.log('wrote public/' + name);
}
await browser.close();
