// Optional "liquid" refraction for the glass bars, in browsers that can do it.
//
// Real iOS Liquid Glass bends what is behind it. In a web page that needs `backdrop-filter: url(#svg-filter)`, which only
// Chromium supports (Chrome, Edge, Android). Safari and Firefox ignore it, so we must not even try there: they get the
// blur + highlight glass from the stylesheet. We detect Chromium through `navigator.userAgentData` (Safari and Firefox do
// not have it) and never through `@supports`, because Safari can claim support for the property but not the url() form.

/** Displacement map for a pill: near the edge the light is pulled inwards, the middle is untouched.
 *  Red = horizontal shift, green = vertical shift, 128 = no shift. */
export function lensMapPixels(w: number, h: number, rim = 0.38): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const r = h / 2; // pill: fully rounded ends
  const band = Math.max(4, h * rim);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.min(Math.max(x + 0.5, r), w - r);
      const cy = h / 2;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      const inside = r - dist; // distance from the edge, inwards
      const t = Math.max(0, 1 - inside / band);
      const push = t * t * t; // strong at the very edge, gentle further in
      const nx = dist > 0 ? dx / dist : 0, ny = dist > 0 ? dy / dist : 0;
      const i = (y * w + x) * 4;
      out[i] = 128 - nx * push * 127; // towards the centre
      out[i + 1] = 128 - ny * push * 127;
      out[i + 2] = 128;
      out[i + 3] = 255;
    }
  }
  return out;
}

export function isChromium(nav: { userAgentData?: { brands?: { brand: string }[] } } = navigator as never): boolean {
  return !!nav.userAgentData?.brands?.some((b) => /chromium|google chrome|microsoft edge/i.test(b.brand));
}

export function installLens() {
  try {
    if (!isChromium() || document.getElementById('hm-lens-svg')) return;
    const w = 480, h = 88;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(lensMapPixels(w, h) as unknown as ImageDataArray, w, h), 0, 0);
    const href = canvas.toDataURL('image/png');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'hm-lens-svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.innerHTML =
      `<filter id="hm-lens" filterUnits="objectBoundingBox" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">` +
      `<feImage href="${href}" preserveAspectRatio="none" result="map"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="18" xChannelSelector="R" yChannelSelector="G"/>` +
      `</filter>`;
    document.body.appendChild(svg);
    document.documentElement.dataset.lens = '1';
  } catch { /* the plain glass is fine */ }
}
