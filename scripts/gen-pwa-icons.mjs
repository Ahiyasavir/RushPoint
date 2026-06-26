// Generate the play-web PWA raster icons from the single source icon.svg
// (change: play-web-store-readiness). The redesigned "Velocity Compass" SVG is
// the one source of truth; this rasterizes it reproducibly via sharp (resvg).
//
//   node scripts/gen-pwa-icons.mjs   (or: npm run icons)
//
// Outputs into apps/play-web/public/:
//   icon-512-maskable.png  512, full-bleed square (OS clips the corners)
//   icon-512.png           512, baked squircle corners (rx ~112)
//   icon-192.png           192, baked squircle corners (rx ~42)
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, '..', 'apps', 'play-web', 'public');
const SVG = join(PUB, 'icon.svg');

/** A rounded-rect alpha mask used to bake squircle corners into the `any` icons. */
function squircleMask(size, rx) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="#fff"/></svg>`,
  );
}

async function rasterize(size) {
  // density scales the SVG render resolution so the 512 viewBox renders crisply.
  return sharp(SVG, { density: 512 }).resize(size, size).png();
}

async function squircle(size, rx, out) {
  const base = await rasterize(size);
  await base
    .composite([{ input: squircleMask(size, rx), blend: 'dest-in' }])
    .toFile(join(PUB, out));
  console.log(`  ✓ ${out} (${size}×${size}, squircle rx=${rx})`);
}

async function fullBleed(size, out) {
  await (await rasterize(size)).toFile(join(PUB, out));
  console.log(`  ✓ ${out} (${size}×${size}, full-bleed)`);
}

console.log('Generating PWA icons from icon.svg …');
await fullBleed(512, 'icon-512-maskable.png');
await squircle(512, 112, 'icon-512.png');
await squircle(192, 42, 'icon-192.png');
console.log('Done.');
