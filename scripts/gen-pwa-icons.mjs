// Generate the PWA raster icons for BOTH web apps from each app's single source
// icon.svg (changes: play-web-store-readiness, creator-web-installable-icons).
// The redesigned full-bleed SVG is the one source of truth per app; this
// rasterizes it reproducibly via sharp (resvg).
//
//   node scripts/gen-pwa-icons.mjs   (or: npm run icons)
//
// Outputs into each app's public/:
//   icon-512-maskable.png  512, full-bleed square (OS clips the corners)
//   icon-512.png           512, baked squircle corners (rx ~112)
//   icon-192.png           192, baked squircle corners (rx ~42)
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));

// Every app that ships an installable PWA icon set, rasterized from its own
// public/icon.svg. Add a new app here and it gets the same contract for free.
const APPS = ['play-web', 'creator-web'];

/** A rounded-rect alpha mask used to bake squircle corners into the `any` icons. */
function squircleMask(size, rx) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="#fff"/></svg>`,
  );
}

async function rasterize(svg, size) {
  // density scales the SVG render resolution so the 512 viewBox renders crisply.
  return sharp(svg, { density: 512 }).resize(size, size).png();
}

async function squircle(svg, pub, size, rx, out) {
  const base = await rasterize(svg, size);
  await base
    .composite([{ input: squircleMask(size, rx), blend: 'dest-in' }])
    .toFile(join(pub, out));
  console.log(`  ✓ ${out} (${size}×${size}, squircle rx=${rx})`);
}

async function fullBleed(svg, pub, size, out) {
  await (await rasterize(svg, size)).toFile(join(pub, out));
  console.log(`  ✓ ${out} (${size}×${size}, full-bleed)`);
}

for (const app of APPS) {
  const pub = join(here, '..', 'apps', app, 'public');
  const svg = join(pub, 'icon.svg');
  console.log(`Generating PWA icons for ${app} from icon.svg …`);
  await fullBleed(svg, pub, 512, 'icon-512-maskable.png');
  await squircle(svg, pub, 512, 112, 'icon-512.png');
  await squircle(svg, pub, 192, 42, 'icon-192.png');
}
console.log('Done.');
