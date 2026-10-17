// Builds the shirt print files: front chest mark + back lockup, black and white shirt.
// Usage: node build.mjs <repoRoot> <outDir>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [repo, out] = process.argv.slice(2);
const req = createRequire(path.join(repo, 'package.json'));
const QRCode = req('qrcode');
const { chromium } = req('playwright');

const URL = 'https://rush-point.com/t';
const fontDir = path.join(repo, 'node_modules/@fontsource-variable/rubik/files');
const f64 = (n) => fs.readFileSync(path.join(fontDir, n)).toString('base64');
const FONTS = `@font-face{font-family:R;font-weight:300 900;src:url(data:font/woff2;base64,${f64('rubik-hebrew-wght-normal.woff2')}) format('woff2');unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:R;font-weight:300 900;src:url(data:font/woff2;base64,${f64('rubik-latin-wght-normal.woff2')}) format('woff2')}`;

const V = {
  black: { bg: '#121212', fg: '#F5F5F2', ac: '#F26A1B', hub: '#22D3EE', sub: '#BDBDB8' },
  white: { bg: '#FAFAF8', fg: '#141414', ac: '#E2580F', hub: '#0EA5C4', sub: '#55534E' },
};

function mark(t, cx, cy, s) {
  const k = s / 300;
  return `<g transform="translate(${cx} ${cy}) scale(${k}) translate(-256 -256)"><circle cx="256" cy="256" r="132" fill="none" stroke="${t.fg}" stroke-width="14"/><path d="M256 124 A132 132 0 0 1 388 256" fill="none" stroke="${t.ac}" stroke-width="14" stroke-linecap="round"/><g transform="rotate(38 256 256)"><path d="M256 140 L288 256 L256 280 L224 256 Z" fill="${t.ac}"/><path d="M256 372 L288 256 L256 280 L224 256 Z" fill="${t.fg}"/></g><circle cx="256" cy="256" r="22" fill="${t.bg}"/><circle cx="256" cy="256" r="22" fill="none" stroke="${t.fg}" stroke-width="8"/><circle cx="256" cy="256" r="8" fill="${t.hub}"/></g>`;
}

// Real QR, error correction H (30%), so the logo in the middle is affordable.
const qrData = QRCode.create(URL, { errorCorrectionLevel: 'H' });
const N = qrData.modules.size;
const bit = (r, c) => qrData.modules.get(r, c);
function qr(t, x, y, s) {
  const c = s / N;
  const finder = (r, col) => (r < 7 && col < 7) || (r < 7 && col >= N - 7) || (r >= N - 7 && col < 7);
  const hole = Math.ceil(N * 0.26); // centre square kept clear for the mark (~7% of area)
  const h0 = Math.floor((N - hole) / 2), h1 = h0 + hole;
  let o = '';
  for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) {
    if (finder(r, col) || (r >= h0 && r < h1 && col >= h0 && col < h1)) continue;
    if (bit(r, col)) o += `<circle cx="${x + col * c + c / 2}" cy="${y + r * c + c / 2}" r="${c * 0.46}" fill="${t.fg}"/>`;
  }
  for (const [a, b] of [[0, 0], [N - 7, 0], [0, N - 7]]) {
    o += `<rect x="${x + a * c + c * 0.5}" y="${y + b * c + c * 0.5}" width="${c * 6}" height="${c * 6}" rx="${c * 1.6}" fill="none" stroke="${t.fg}" stroke-width="${c}"/>`;
    o += `<rect x="${x + a * c + c * 2}" y="${y + b * c + c * 2}" width="${c * 3}" height="${c * 3}" rx="${c * 0.8}" fill="${t.ac}"/>`;
  }
  return o + mark(t, x + s / 2, y + s / 2, s * 0.30);
}

// On a dark shirt the code sits on a light panel: dark modules on light read on every
// scanner, a light-on-dark code only on scanners that try inverting.
const PANEL = { bg: '#F5F5F2', fg: '#121212', ac: '#F26A1B', hub: '#22D3EE' };
const page = (body, bg) => `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}html,body{margin:0;background:${bg}}svg{display:block}</style></head><body>${body}</body></html>`;

// Back lockup in mm units (column width W mm). Text is fitted to the column in the browser.
function backSvg(t, W, withQuietZone) {
  const QZ = W * 0.08; // a light panel behind the code on the dark shirt
  return `<svg id="art" xmlns="http://www.w3.org/2000/svg" width="${W}mm" viewBox="0 0 ${W} 1000" data-w="${W}"${withQuietZone ? ' data-panel="1"' : ''}>
  <text id="l1" x="${W / 2}" text-anchor="middle" direction="rtl" font-family="R" font-weight="900" fill="${t.fg}">תבנו מירוץ</text>
  <text id="l2" x="${W / 2}" text-anchor="middle" direction="rtl" font-family="R" font-weight="900" fill="${t.ac}">לחברים שלכם</text>
  <text id="l3" x="${W / 2}" text-anchor="middle" direction="rtl" font-family="R" font-weight="500" fill="${t.sub}">בחינם. סרקו ותראו איך</text>
  <g id="code">${withQuietZone
    ? `<rect x="0" y="0" width="${W}" height="${W}" rx="${W * 0.09}" fill="${PANEL.bg}"/>${qr(PANEL, W * 0.11, W * 0.11, W * 0.78)}`
    : qr(t, W * 0.09, 0, W * 0.82)}</g>
  <text id="wm" x="${W / 2}" text-anchor="middle" font-family="R" font-weight="900" fill="${t.fg}">Rush<tspan fill="${t.ac}">Point</tspan></text>
</svg>`;
}

function frontSvg(t, W) {
  return `<svg id="art" xmlns="http://www.w3.org/2000/svg" width="${W}mm" viewBox="0 0 ${W} 1000" data-w="${W}" data-front="1">
  <g id="mk">${mark(t, W / 2, W * 0.36, W * 0.62)}</g>
  <text id="wm" x="${W / 2}" text-anchor="middle" font-family="R" font-weight="900" fill="${t.fg}">Rush<tspan fill="${t.ac}">Point</tspan></text>
</svg>`;
}

// Runs in the page: size each line to the column, stack, set the final height.
const layout = () => {
  const s = document.getElementById('art');
  const W = +s.dataset.w;
  const fitTo = (el, w) => { el.setAttribute('font-size', 100); const L = el.getComputedTextLength(); el.setAttribute('font-size', 100 * w / L); return 100 * w / L; };
  let y = 0;
  if (s.dataset.front) {
    y = W * 0.72;
    const wm = document.getElementById('wm'); const fs = fitTo(wm, W); y += fs * 0.78; wm.setAttribute('y', y); y += fs * 0.12;
  } else {
    const l1 = document.getElementById('l1'); let fs = fitTo(l1, W); y += fs * 0.80; l1.setAttribute('y', y);
    const l2 = document.getElementById('l2'); fs = fitTo(l2, W); y += fs * 0.98; l2.setAttribute('y', y);
    y += W * 0.11;
    const l3 = document.getElementById('l3'); fs = fitTo(l3, W * 0.8); y += fs * 0.80; l3.setAttribute('y', y);
    y += W * 0.06;
    document.getElementById('code').setAttribute('transform', `translate(0 ${y})`); y += (s.dataset.panel ? W : W * 0.82) + W * 0.13;
    const wm = document.getElementById('wm'); fs = fitTo(wm, W * 0.62); y += fs * 0.75; wm.setAttribute('y', y); y += fs * 0.08;
  }
  s.setAttribute('viewBox', `0 0 ${W} ${y}`);
  s.setAttribute('height', `${y}mm`);
  return { W, H: y };
};

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const DPI = 600, PX_PER_MM = DPI / 25.4;
const results = [];
for (const [name, t] of Object.entries(V)) {
  for (const [side, svg, W] of [['front', frontSvg(t, 80), 80], ['back', backSvg(t, 110, name === 'black'), 110]]) {
    for (const transparent of [true, false]) {
      const ctx = await browser.newContext({ deviceScaleFactor: PX_PER_MM / (96 / 25.4) });
      const p = await ctx.newPage();
      await p.setContent(page(svg, transparent ? 'transparent' : t.bg));
      await p.evaluate(() => document.fonts.ready);
      const dims = await p.evaluate(layout);
      const el = await p.$('#art');
      const file = path.join(out, `shirt-${name}-${side}${transparent ? '-print' : '-preview'}.png`);
      await el.screenshot({ path: file, omitBackground: transparent });
      if (transparent) {
        const final = await p.evaluate(() => document.getElementById('art').outerHTML);
        fs.writeFileSync(path.join(out, `shirt-${name}-${side}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n` + final.replace('<svg ', `<svg xmlns:xlink="http://www.w3.org/1999/xlink" `).replace('>', `><style>${FONTS}</style>`));
        results.push({ file: path.basename(file), mm: `${dims.W} x ${dims.H.toFixed(1)}` });
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(JSON.stringify({ url: URL, qrVersion: qrData.version, modules: N, results }, null, 1));
