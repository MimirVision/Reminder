// Renders public/icon.svg into the PNG icons phones need (Home Screen, install, maskable). Run: node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const path = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(path) ? { executablePath: path } : {});
const page = await browser.newPage();
// Apple and maskable icons are cropped by the system, so they get a full square with the artwork inset.
const sizes = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['apple-touch-icon.png', 180, true], ['maskable-512.png', 512, true]];
for (const [name, size, square] of sizes) {
  const art = square ? svg.replace('rx="112"', 'rx="0"') : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${art}`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: !square });
}
await browser.close();
console.log('icons written');
