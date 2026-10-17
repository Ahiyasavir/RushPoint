// The phones burst onto the real map of the route (Motza to Park HaTanakh), 9:16, frame exact.
//   copy to the repo root (node_modules must resolve), then: node render_burst.mjs <seconds> [frame,frame,...]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const REPO = 'C:/Users/savir/Projects/Rushpoint';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('playwright');
const HERE = 'C:/Users/savir/Desktop/RushPoint-reels-work/reel16-button/map';
const RD = path.resolve(HERE, '..');
const FPS = 30;
const env = fs.readFileSync(REPO + '/apps/play-web/.env', 'utf8');
const KEY = (env.match(/^VITE_MAPTILER_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) throw new Error('no MapTiler key in apps/play-web/.env');
// PROVISIONAL coordinates, the same ones the classroom and opening videos used (2026-10-04/05)
const P = { motza: [35.1720, 31.7970], torsinai: [35.1815, 31.8040], park: [35.19117, 31.80836] };
const ROUTE = [P.motza, [35.1745, 31.7990], [35.1772, 31.8012], [35.1795, 31.8030], P.torsinai, [35.1840, 31.8052], [35.1868, 31.8066], [35.1893, 31.8077], P.park];
const dur = Number(process.argv[2] || 6.5);
const spec = {
  n: 350, dur, spawnSpan: 0.85, burstR: 0.0036, lane: 0.00085, pops: 46, popFrom: 1.5,
  countOut: 2.9, boardIn: 3.3, boardOut: dur - 0.1, washDur: 0.3, btn: [594, 1240],
  route: ROUTE,
  // the start point sits where the button was on the pressed screen, then the camera pulls back over the whole route
  camera: [
    { t: 0, center: P.motza, zoom: 16.0, bearing: 18, pad: 560, padl: 108 },
    { t: 1.2, center: [35.1741, 31.7987], zoom: 15.7, bearing: 32, pad: 300, padl: 0 },
    { t: 3.2, center: [35.1812, 31.8034], zoom: 15.2, bearing: 44, pad: 120 },
    { t: dur, center: [35.1822, 31.8040], zoom: 15.1, bearing: 47, pad: 120 },
  ],
  pins: [{ id: 'motza', c: P.motza, label: 'מוצא', t: 0.5, fire: true }, { id: 'park', c: P.park, label: 'פארק התנ״ך', t: 2.3, fire: true }],
  teams: ['קבוצה 12', 'קבוצה 7', 'קבוצה 31', 'קבוצה 20'], base: [140, 125, 110, 95], rate: [3, 5, 4, 7],
  style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${KEY}`,
};
const nm = REPO + '/node_modules';
const fontDir = REPO + '/.claude/skills/reel-studio/engine/fonts';
const html = fs.readFileSync(HERE + '/burst.html', 'utf8')
  .replace('MAPLIBRE_CSS', pathToFileURL(nm + '/maplibre-gl/dist/maplibre-gl.css').href)
  .replace('MAPLIBRE_JS', pathToFileURL(nm + '/maplibre-gl/dist/maplibre-gl.js').href)
  .replace('RTL_PLUGIN', pathToFileURL(nm + '/@mapbox/mapbox-gl-rtl-text/mapbox-gl-rtl-text.min.js').href)
  .replace('FONT_RUBIK_900', pathToFileURL(fontDir + '/Rubik-900.ttf').href)
  .replace('FONT_RUBIK_700', pathToFileURL(fontDir + '/Rubik-700.ttf').href)
  .replace('SPEC_JSON', JSON.stringify(spec));
const page_ = HERE + '/_page_burst.html';
fs.writeFileSync(page_, html);
const frames = HERE + '/frames_burst';
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('console', m => { if (m.type() === 'error') console.error('page:', m.text()); });
page.on('pageerror', e => console.error('pageerror:', e.message));
await page.goto(pathToFileURL(page_).href);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const n = Math.round(dur * FPS);
for (let i = 0; i < n; i++) {
  if (only && !only.includes(i)) continue;
  await page.evaluate(t => Promise.race([window.setFrame(t), new Promise(r => setTimeout(r, 4000))]), i / FPS);
  if (only) await page.evaluate(t => Promise.race([window.setFrame(t), new Promise(r => setTimeout(r, 2500))]), i / FPS);
  await page.screenshot({ path: `${frames}/f_${String(i).padStart(4, '0')}.png` });
  if (i % 45 === 0) console.log(`burst: ${i}/${n}`);
}
await browser.close();
if (!only) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', `${frames}/f_%04d.png`, '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=out_range=tv:out_color_matrix=bt709', '-color_range', 'tv', '-colorspace', 'bt709', RD + '/clips/burst.mp4']);
  console.log(`clips/burst.mp4  ${dur.toFixed(2)}s  ${n} frames`);
}
