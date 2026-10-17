// Builds the RushPoint sticker print files (die cut, white cut border included).
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

const ORANGE = '#F26A1B', INK = '#121212', BONE = '#F5F5F2', CYAN = '#22D3EE';
const CUT = 3; // mm of white die cut border around every sticker

// The compass, flattened for print. t = { fg, ac, hub, bg }.
function mark(t, cx, cy, s) {
  const k = s / 300;
  return `<g transform="translate(${cx} ${cy}) scale(${k}) translate(-256 -256)"><circle cx="256" cy="256" r="132" fill="none" stroke="${t.fg}" stroke-width="14"/><path d="M256 124 A132 132 0 0 1 388 256" fill="none" stroke="${t.ac}" stroke-width="14" stroke-linecap="round"/><g transform="rotate(38 256 256)"><path d="M256 140 L288 256 L256 280 L224 256 Z" fill="${t.ac}"/><path d="M256 372 L288 256 L256 280 L224 256 Z" fill="${t.fg}"/></g><circle cx="256" cy="256" r="22" fill="${t.bg}"/><circle cx="256" cy="256" r="22" fill="none" stroke="${t.fg}" stroke-width="8"/><circle cx="256" cy="256" r="8" fill="${t.hub}"/></g>`;
}

const qrData = QRCode.create(URL, { errorCorrectionLevel: 'H' });
const N = qrData.modules.size;
function qr(t, x, y, s) {
  const c = s / N;
  const finder = (r, col) => (r < 7 && col < 7) || (r < 7 && col >= N - 7) || (r >= N - 7 && col < 7);
  const hole = Math.ceil(N * 0.26), h0 = Math.floor((N - hole) / 2), h1 = h0 + hole;
  let o = '';
  for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) {
    if (finder(r, col) || (r >= h0 && r < h1 && col >= h0 && col < h1)) continue;
    if (qrData.modules.get(r, col)) o += `<circle cx="${x + col * c + c / 2}" cy="${y + r * c + c / 2}" r="${c * 0.46}" fill="${t.fg}"/>`;
  }
  for (const [a, b] of [[0, 0], [N - 7, 0], [0, N - 7]]) {
    o += `<rect x="${x + a * c + c * 0.5}" y="${y + b * c + c * 0.5}" width="${c * 6}" height="${c * 6}" rx="${c * 1.6}" fill="none" stroke="${t.fg}" stroke-width="${c}"/>`;
    o += `<rect x="${x + a * c + c * 2}" y="${y + b * c + c * 2}" width="${c * 3}" height="${c * 3}" rx="${c * 0.8}" fill="${t.ac}"/>`;
  }
  return o + mark(t, x + s / 2, y + s / 2, s * 0.30);
}

// Text that is sized in the browser to fill a given width (data-fit="width").
const fitText = (txt, x, y, w, weight, fill, rtl = true) =>
  `<text x="${x}" y="${y}" data-fit="${w}" text-anchor="middle"${rtl ? ' direction="rtl"' : ''} font-family="R" font-weight="${weight}" fill="${fill}">${txt}</text>`;
const wordmark = (x, y, w, fg, ac) =>
  `<text x="${x}" y="${y}" data-fit="${w}" text-anchor="middle" font-family="R" font-weight="900" fill="${fg}">Rush<tspan fill="${ac}">Point</tspan></text>`;

// Every sticker: [name, widthMm, heightMm, body]. The body draws inside a CUT offset.
const S = [];

// 1. App icon: orange squircle, the compass in white. 60 mm.
{
  const w = 60, h = 60, r = 14;
  const t = { fg: '#FFFFFF', ac: INK, hub: INK, bg: ORANGE };
  S.push(['icon', w, h, `<rect x="${-CUT}" y="${-CUT}" width="${w + 2 * CUT}" height="${h + 2 * CUT}" rx="${r + CUT}" fill="#FFFFFF"/>
<rect width="${w}" height="${h}" rx="${r}" fill="${ORANGE}"/>${mark(t, w / 2, h / 2, w * 0.86)}`]);
}

// 2. Round badge: black disc, compass over the wordmark. 70 mm.
{
  const d = 70;
  const t = { fg: BONE, ac: ORANGE, hub: CYAN, bg: INK };
  S.push(['badge', d, d, `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 + CUT}" fill="#FFFFFF"/>
<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${INK}"/>
<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 3}" fill="none" stroke="${ORANGE}" stroke-width="0.8"/>
${mark(t, d / 2, d * 0.40, d * 0.52)}${wordmark(d / 2, d * 0.78, d * 0.62, BONE, ORANGE)}`]);
}

// 3. Pill: compass then wordmark, for a laptop lid or a bottle. 90 x 30 mm.
{
  const w = 90, h = 30;
  const t = { fg: BONE, ac: ORANGE, hub: CYAN, bg: INK };
  S.push(['pill', w, h, `<rect x="${-CUT}" y="${-CUT}" width="${w + 2 * CUT}" height="${h + 2 * CUT}" rx="${h / 2 + CUT}" fill="#FFFFFF"/>
<rect width="${w}" height="${h}" rx="${h / 2}" fill="${INK}"/>${mark(t, h / 2 + 1, h / 2, h * 0.92)}
${wordmark(h + 1 + (w - h - 7) / 2, h * 0.66, w - h - 8, BONE, ORANGE)}`]);
}

// 4. The shirt's back, as a sticker: headline, code, wordmark. 60 x 92 mm.
{
  const w = 60, h = 92, pad = 6, W = w - 2 * pad;
  const t = { fg: INK, ac: ORANGE, hub: CYAN, bg: BONE };
  S.push(['qr', w, h, `<rect x="${-CUT}" y="${-CUT}" width="${w + 2 * CUT}" height="${h + 2 * CUT}" rx="${8 + CUT}" fill="#FFFFFF"/>
<rect width="${w}" height="${h}" rx="8" fill="${INK}"/>
${fitText('תבנו מירוץ', w / 2, 15.5, W, 900, BONE)}${fitText('לחברים שלכם', w / 2, 25.5, W, 900, ORANGE)}
<rect x="${pad}" y="31" width="${W}" height="${W}" rx="5" fill="${BONE}"/>${qr(t, pad + W * 0.1, 31 + W * 0.1, W * 0.8)}
${wordmark(w / 2, h - 7.5, W * 0.7, BONE, ORANGE)}`]);
}

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${body}</body></html>`;
const svgOf = (w, h, body) => `<svg id="art" xmlns="http://www.w3.org/2000/svg" width="${w + 2 * CUT}mm" height="${h + 2 * CUT}mm" viewBox="${-CUT} ${-CUT} ${w + 2 * CUT} ${h + 2 * CUT}">${body}</svg>`;
const fit = () => {
  for (const el of document.querySelectorAll('[data-fit]')) {
    el.setAttribute('font-size', 100);
    el.setAttribute('font-size', (100 * +el.dataset.fit) / el.getComputedTextLength());
  }
};

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const DPI = 600;
const ctx = await browser.newContext({ deviceScaleFactor: DPI / 96 });
const p = await ctx.newPage();
for (const [name, w, h, body] of S) {
  await p.setContent(page(svgOf(w, h, body)));
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(fit);
  await (await p.$('#art')).screenshot({ path: path.join(out, `sticker-${name}-print.png`), omitBackground: true });
  const svg = await p.evaluate(() => document.getElementById('art').outerHTML);
  fs.writeFileSync(path.join(out, `sticker-${name}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace('>', `><style>${FONTS}</style>`)}`);
  console.log(`sticker-${name}: ${w + 2 * CUT} x ${h + 2 * CUT} mm with the cut border`);
}
// A contact sheet on a mid grey, so the white cut border is visible.
const imgs = S.map(([name]) => `<img src="data:image/png;base64,${fs.readFileSync(path.join(out, `sticker-${name}-print.png`)).toString('base64')}" style="height:${name === 'pill' ? 160 : name === 'qr' ? 470 : 330}px;margin:30px">`).join('');
const sheet = await browser.newContext({ deviceScaleFactor: 1 });
const sp = await sheet.newPage();
await sp.setViewportSize({ width: 1700, height: 600 });
await sp.setContent(`<body style="margin:0;background:#8a8a86;display:flex;align-items:center;justify-content:center;flex-wrap:wrap">${imgs}</body>`);
await sp.screenshot({ path: path.join(out, 'sticker-sheet-preview.png'), fullPage: true });
await browser.close();
