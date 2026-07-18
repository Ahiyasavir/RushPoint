// PWA installability contract (changes: play-web-store-readiness,
// creator-web-installable-icons). Asserts BOTH web-app manifests are
// installable: required fields, a 192 PNG, a 512 PNG (any), a 512 PNG
// (maskable), no single icon mixing any+maskable, every declared icon file
// present at its declared pixel size, every icon cached by the SW, and (the
// bug that shipped a letter-glyph home-screen icon) the apple-touch-icon in
// index.html points at a PNG, not an SVG. Proves STRUCTURE only — aesthetic
// quality is a human acceptance gate. No emulator.
//   npx tsx scripts/test-manifest.ts
import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Read a PNG's pixel dimensions from its IHDR chunk (no image lib).
function readPngSize(buf: Buffer): { w: number; h: number } | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

type Icon = { src: string; sizes: string; type?: string; purpose?: string };
const purposes = (p?: string) => (p ?? 'any').split(/\s+/).filter(Boolean);
const isPng = (i: { type?: string; src: string }) => i.type === 'image/png' || i.src.endsWith('.png');

function verifyApp(app: string): void {
  console.log(`\n── ${app} ─────────────────────────────────────────────`);
  const PUB = new URL(`../apps/${app}/public/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', PUB), 'utf8')) as {
    name?: string; short_name?: string; start_url?: string; display?: string;
    theme_color?: string; background_color?: string; icons?: Icon[];
  };

  // ── Required installability fields ─────────────────────────────────────────
  check(`[${app}] manifest has name`, !!manifest.name);
  check(`[${app}] manifest has short_name`, !!manifest.short_name);
  check(`[${app}] manifest has start_url`, !!manifest.start_url);
  check(`[${app}] manifest display is installable`, ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display ?? ''), manifest.display);
  check(`[${app}] manifest has theme_color`, !!manifest.theme_color);
  check(`[${app}] manifest has background_color`, !!manifest.background_color);
  check(`[${app}] manifest has non-empty icons`, Array.isArray(manifest.icons) && manifest.icons.length > 0);

  const icons = manifest.icons ?? [];

  // ── Icon-set requirements (a raster PNG is what phones use on the home
  //    screen — SVG-only falls back to a generated letter glyph) ─────────────
  check(`[${app}] has a 192×192 PNG`, icons.some((i) => isPng(i) && i.sizes === '192x192'));
  check(`[${app}] has a 512×512 PNG with purpose any`, icons.some((i) => isPng(i) && i.sizes === '512x512' && purposes(i.purpose).includes('any')));
  check(`[${app}] has a 512×512 PNG with purpose maskable`, icons.some((i) => isPng(i) && i.sizes === '512x512' && purposes(i.purpose).includes('maskable')));
  check(`[${app}] no icon mixes any+maskable in one purpose`,
    !icons.some((i) => { const p = purposes(i.purpose); return p.includes('any') && p.includes('maskable'); }),
    icons.map((i) => i.purpose).join(' | '));

  // ── Every declared icon exists at its declared size ────────────────────────
  for (const icon of icons) {
    // Resolve both absolute ("/icon.png") and base-relative ("icon.png") srcs
    // against the app's public/ dir.
    const fileUrl = new URL(icon.src.replace(/^\//, ''), PUB);
    const exists = existsSync(fileUrl);
    check(`[${app}] icon file exists: ${icon.src}`, exists);
    if (exists && isPng(icon) && /^\d+x\d+$/.test(icon.sizes)) {
      const [w, h] = icon.sizes.split('x').map(Number);
      const dim = readPngSize(readFileSync(fileUrl));
      check(`[${app}] icon ${icon.src} is ${icon.sizes}`, !!dim && dim.w === w && dim.h === h, dim ? `${dim.w}x${dim.h}` : 'not a PNG');
    }
  }

  // ── Every icon is cached by the service worker ─────────────────────────────
  const sw = readFileSync(new URL('sw.js', PUB), 'utf8');
  for (const icon of icons) {
    check(`[${app}] SW caches ${icon.src}`, sw.includes(icon.src));
  }

  // ── apple-touch-icon MUST be a PNG (iOS ignores SVG here → letter glyph) ────
  const html = readFileSync(new URL(`../apps/${app}/index.html`, import.meta.url), 'utf8');
  const appleTouch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*>/i)?.[0] ?? '';
  check(`[${app}] index.html has apple-touch-icon`, !!appleTouch);
  check(`[${app}] apple-touch-icon is a PNG`, /href=["'][^"']*\.png["']/i.test(appleTouch), appleTouch);
}

for (const app of ['play-web', 'creator-web']) verifyApp(app);

console.log(`\n${failures === 0 ? 'ALL MANIFEST TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
