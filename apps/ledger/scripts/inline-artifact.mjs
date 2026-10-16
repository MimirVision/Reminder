// Turns the `vite build --mode artifact` output into one HTML file (ledger.html) with the stylesheet and script inline,
// for publishing as a single page. Run through `npm run build:artifact`.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dir = new URL('../dist-artifact/', import.meta.url);
const assets = readdirSync(new URL('assets/', dir));
const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));
if (js.length !== 1 || css.length !== 1) throw new Error(`Expected one script and one stylesheet, found ${js} ${css}`);
const read = (f) => readFileSync(new URL(`assets/${f}`, dir), 'utf8');
const script = read(js[0]).replace(/<\/script/gi, '<\\/script');
const style = read(css[0]).replace(/<\/style/gi, '<\\/style');

// The host wraps the page in its own <html>/<head>/<body>, so this is the page content only.
const page = `<title>Ledger Workspace</title>
<meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8'))}">
<style>${style}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
writeFileSync(new URL('ledger.html', dir), page);
console.log(`wrote dist-artifact/ledger.html (${Math.round(page.length / 1024)} KB)`);
