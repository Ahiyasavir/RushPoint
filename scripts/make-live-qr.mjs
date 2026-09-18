// QR codes for the RushPoint Live application page (change: rushpoint-live-qr).
//
// Generated LOCALLY, straight from the `qrcode` package already in this repo, and
// the payload is the destination url itself — nothing else.
//
// That is the whole point. A QR made on a free generator site usually encodes a
// link to THAT site, which then bounces the scanner to the real destination: so a
// person who scans a printed poster lands on an interstitial, an advert or a
// consent wall before they reach the form. Worse, the redirect is a third party's
// to keep alive — plenty of those shorteners expire a "free" code after a trial,
// and the poster in somebody's hand quietly stops working. An encoded url has no
// owner, no expiry, no tracking and nothing in front of it.
//
// Run: node scripts/make-live-qr.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import QRCode from 'qrcode';

import { SITE_ORIGIN } from '../apps/marketing/src/utils/i18n.ts';

const OUT = join(import.meta.dirname, '..', 'docs', 'marketing', 'live-qr');

/**
 * Both languages get their own code. The page is bilingual and the band on the
 * home page is geo-gated, but a QR is printed for a known audience, so whoever
 * prints it chooses the language rather than leaving it to a redirect.
 */
const TARGETS = [
  { name: 'rushpoint-live-he', url: `${SITE_ORIGIN}/he/live/` },
  { name: 'rushpoint-live-en', url: `${SITE_ORIGIN}/en/live/` },
];

/**
 * `H` is the highest error correction: about 30% of the code can be dirty, torn,
 * curled or partly covered and it still reads. That normally costs size, but the
 * url is short enough that even at H the grid stays coarse — so the modules print
 * large and scan easily from a distance, which is what a poster needs.
 */
const ERROR_CORRECTION = 'H';

/**
 * Four modules of white on every side, which is the spec's minimum quiet zone.
 * A QR pasted flush against artwork is the single most common reason a code that
 * "looks fine" will not scan.
 */
const MARGIN = 4;

/** Black on white. A tinted QR is a QR that fails in bad light. */
const COLOR = { dark: '#000000ff', light: '#ffffffff' };

async function main() {
  await mkdir(OUT, { recursive: true });
  const written = [];

  for (const { name, url } of TARGETS) {
    const opts = { errorCorrectionLevel: ERROR_CORRECTION, margin: MARGIN, color: COLOR };

    // SVG first: vector, so it prints at any size from a business card to a
    // banner without the soft edges that make a scaled-up PNG hard to scan.
    const svg = await QRCode.toString(url, { ...opts, type: 'svg' });
    await writeFile(join(OUT, `${name}.svg`), svg, 'utf8');
    written.push(`${name}.svg`);

    // And PNGs, for anything that will not take an SVG (Instagram, WhatsApp, most
    // print shops' upload forms).
    for (const width of [1024, 2048]) {
      const png = await QRCode.toBuffer(url, { ...opts, width, type: 'png' });
      await writeFile(join(OUT, `${name}-${width}.png`), png);
      written.push(`${name}-${width}.png`);
    }

    // The encoded payload, written beside the images, so anybody can verify what
    // the code actually contains without owning a scanner.
    await writeFile(join(OUT, `${name}.txt`), `${url}\n`, 'utf8');
    written.push(`${name}.txt`);
  }

  console.log(`QR codes written to docs/marketing/live-qr:\n  ${written.join('\n  ')}`);
  for (const { name, url } of TARGETS) console.log(`\n${name} encodes exactly: ${url}`);
}

await main();
