#!/usr/bin/env node
/**
 * Google Play store graphics generator.
 *
 * Renders the listing artwork Play requires at exact pixel sizes. Unlike the
 * og.jpg cards (see scripts/og-cards.README.md) this is NOT a paste-into-the-
 * console ritual — it runs headless via Playwright so Hebrew text gets correct
 * RTL shaping (librsvg/sharp mangles it) and the output is reproducible.
 *
 *   node scripts/gen-play-assets.mjs             (Hebrew, default listing)
 *   node scripts/gen-play-assets.mjs --lang=en   (English listing)
 *
 * Writes to docs/play-store/assets/:
 *   feature-graphic.png      1024x500  (required by Play, Hebrew listing)
 *   feature-graphic-en.png   1024x500  (English listing, via --lang=en)
 *
 * Play rules honoured here: no transparency, no device frames, no store badges,
 * no "download now" callouts, and all key content kept inside a centre safe area
 * because Play crops this graphic on some surfaces.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'play-store', 'assets');

// Brand — mirrors apps/play-web/public/manifest.webmanifest + icon.svg
const BRAND = {
  orange: '#F97316',
  orangeLight: '#FCA855',
  orangeDeep: '#DC4F08',
  cyan: '#22D3EE',
  cream: '#FBF7F0',
};

const iconB64 = readFileSync(join(ROOT, 'apps/play-web/public/icon-512.png')).toString('base64');

const lang = process.argv.includes('--lang=en') ? 'en' : 'he';
const TAGLINE = {
  he: { text: 'משחק שדה בעולם האמיתי', dir: 'rtl', lang: 'he' },
  en: { text: 'Real world team field games', dir: 'ltr', lang: 'en' },
};
const OUT_NAME = lang === 'en' ? 'feature-graphic-en.png' : 'feature-graphic.png';

/** Decorative topographic contours — nods to the outdoor/field-game theme. */
function contours() {
  const rings = [];
  for (let i = 0; i < 7; i++) {
    const r = 120 + i * 78;
    rings.push(
      `<ellipse cx="512" cy="250" rx="${r * 1.5}" ry="${r}" fill="none" ` +
        `stroke="#FFFFFF" stroke-opacity="${(0.09 - i * 0.011).toFixed(3)}" stroke-width="2"/>`,
    );
  }
  return rings.join('');
}

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', 'Arial', 'Helvetica Neue', sans-serif;
    background: linear-gradient(135deg, ${BRAND.orangeLight} 0%, ${BRAND.orange} 45%, ${BRAND.orangeDeep} 100%);
    position: relative;
  }
  .contours { position: absolute; inset: 0; }
  /* Cyan halo accent, echoing the app icon's glow ring */
  .halo {
    position: absolute; left: 50%; top: 50%; width: 900px; height: 900px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle,
      rgba(34,211,238,0) 58%, rgba(34,211,238,0.22) 70%, rgba(34,211,238,0) 82%);
  }
  .stack {
    position: relative; z-index: 2;
    display: flex; flex-direction: column; align-items: center;
    /* centre safe area — Play crops the edges on some surfaces */
    max-width: 760px; text-align: center;
  }
  .mark {
    width: 132px; height: 132px; border-radius: 30px;
    box-shadow: 0 16px 44px rgba(120, 40, 0, 0.34);
    margin-bottom: 26px;
  }
  .wordmark {
    font-size: 82px; font-weight: 800; letter-spacing: -1.5px; color: #FFFFFF;
    text-shadow: 0 3px 18px rgba(120, 40, 0, 0.32);
    line-height: 1;
  }
  .tagline {
    margin-top: 20px; font-size: 35px; font-weight: 600;
    color: ${BRAND.cream}; opacity: 0.97;
    text-shadow: 0 2px 12px rgba(120, 40, 0, 0.30);
    line-height: 1.35;
  }
  .rule {
    margin-top: 26px; width: 132px; height: 5px; border-radius: 3px;
    background: ${BRAND.cyan}; opacity: 0.9;
  }
</style>
<svg class="contours" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">${contours()}</svg>
<div class="halo"></div>
<div class="stack">
  <img class="mark" src="data:image/png;base64,${iconB64}" alt="">
  <div class="wordmark">RushPoint</div>
  <div class="tagline" dir="${TAGLINE[lang].dir}" lang="${TAGLINE[lang].lang}">${TAGLINE[lang].text}</div>
  <div class="rule"></div>
</div>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 500 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  // .then(() => true): document.fonts.ready resolves to a FontFaceSet, which is
  // not serializable across the CDP boundary.
  await page.evaluate(() => document.fonts.ready.then(() => true));

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, OUT_NAME);
  // omitBackground:false => opaque, as Play requires (no alpha channel surprises)
  await page.screenshot({ path: out, type: 'png', omitBackground: false });
  console.log(`✓ ${OUT_NAME}  1024x500  → ${out}`);
} finally {
  await browser.close();
}
