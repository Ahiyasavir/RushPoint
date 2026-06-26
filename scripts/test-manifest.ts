// PWA installability contract (change: play-web-store-readiness). Asserts the
// play-web manifest is store-installable: required fields, a 192 PNG, a 512 PNG
// (any), a 512 PNG (maskable), no single icon mixing any+maskable, every declared
// icon file present at its declared pixel size, and every icon cached by the SW.
// Proves STRUCTURE only — the aesthetic quality is a human acceptance gate. No emulator.
//   npx tsx scripts/test-manifest.ts
import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const PUB = new URL('../apps/play-web/public/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', PUB), 'utf8')) as {
  name?: string; short_name?: string; start_url?: string; display?: string;
  theme_color?: string; background_color?: string;
  icons?: Array<{ src: string; sizes: string; type?: string; purpose?: string }>;
};

// Read a PNG's pixel dimensions from its IHDR chunk (no image lib).
function readPngSize(buf: Buffer): { w: number; h: number } | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ── Required installability fields ───────────────────────────────────────────
check('manifest has name', !!manifest.name);
check('manifest has short_name', !!manifest.short_name);
check('manifest has start_url', !!manifest.start_url);
check('manifest display is installable', ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display ?? ''), manifest.display);
check('manifest has theme_color', !!manifest.theme_color);
check('manifest has background_color', !!manifest.background_color);
check('manifest has non-empty icons', Array.isArray(manifest.icons) && manifest.icons.length > 0);

const icons = manifest.icons ?? [];
const purposes = (p?: string) => (p ?? 'any').split(/\s+/).filter(Boolean);
const isPng = (i: { type?: string; src: string }) => i.type === 'image/png' || i.src.endsWith('.png');

// ── Icon-set requirements ────────────────────────────────────────────────────
check('has a 192×192 PNG', icons.some((i) => isPng(i) && i.sizes === '192x192'));
check('has a 512×512 PNG with purpose any', icons.some((i) => isPng(i) && i.sizes === '512x512' && purposes(i.purpose).includes('any')));
check('has a 512×512 PNG with purpose maskable', icons.some((i) => isPng(i) && i.sizes === '512x512' && purposes(i.purpose).includes('maskable')));
check('no icon mixes any+maskable in one purpose',
  !icons.some((i) => { const p = purposes(i.purpose); return p.includes('any') && p.includes('maskable'); }),
  icons.map((i) => i.purpose).join(' | '));

// ── Every declared icon exists at its declared size ──────────────────────────
for (const icon of icons) {
  const fileUrl = new URL('.' + icon.src, PUB);
  const exists = existsSync(fileUrl);
  check(`icon file exists: ${icon.src}`, exists);
  if (exists && isPng(icon) && /^\d+x\d+$/.test(icon.sizes)) {
    const [w, h] = icon.sizes.split('x').map(Number);
    const dim = readPngSize(readFileSync(fileUrl));
    check(`icon ${icon.src} is ${icon.sizes}`, !!dim && dim.w === w && dim.h === h, dim ? `${dim.w}x${dim.h}` : 'not a PNG');
  }
}

// ── Every icon is cached by the service worker ───────────────────────────────
const sw = readFileSync(new URL('sw.js', PUB), 'utf8');
for (const icon of icons) {
  check(`SW caches ${icon.src}`, sw.includes(icon.src));
}

console.log(`\n${failures === 0 ? 'ALL MANIFEST TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
