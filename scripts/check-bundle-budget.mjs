// Bundle-budget check (change: play-web-bundle-budget).
//
//   npm run bundle:budget --workspace=@rushpoint/scripts
//   node scripts/check-bundle-budget.mjs
//
// Reads the BUILT output of apps/play-web (run `npm run play:build` first) and
// fails when the participant app's first load gets heavier, or when a heavy
// dependency that must stay lazy has drifted into the entry chunk.
//
// Why: apps/play-web is loaded by real participants outdoors, on their own
// phones, on congested mobile data, often mid-game. A single static import
// anywhere in the module graph silently collapses a code split — the build still
// succeeds and every existing gate still passes — and the entry chunk grows by
// hundreds of kilobytes. Nothing else in the repo would notice.
//
// All decision logic is pure and unit-tested in scripts/test-bundle-budget.ts
// (synthetic fixtures, no build needed). This file only measures and prints.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { evaluateBundleBudget } from './lib/bundleBudget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Policy ───────────────────────────────────────────────────────────────────
// Baseline measured 2026-07-23 from a clean `npm run play:build`, as real bytes
// on disk with gzip level 9 (Vite's own console numbers are computed from JS
// string length and undercount this app's Hebrew dictionaries — it prints
// 895.39 kB for a 902,928-byte file):
//
//   entry js   902,928 raw / 236,157 gzip
//   entry css   38,947 raw /   7,199 gzip
//   initial               243,356 gzip
//
// Budgets sit ~8% above that: large enough that ordinary feature work never
// trips them (ALL application code is ~250 KB *rendered, pre-minification*, in a
// 1.78 MB chunk that is ~75% Firebase SDK), small enough that a collapsed lazy
// boundary — MapLibre is 219,614 gzip bytes, jsqr 47,916 — overshoots by an
// order of magnitude. This is a ratchet: when a deliberate increase lands, move
// the number here with a note. Never disable the check "temporarily".
const PLAY_POLICY = {
  label: 'play-web',
  entryJs: /^assets\/index-[^/]*\.js$/,
  entryCss: /^assets\/index-[^/]*\.css$/,
  maxEntryGzipBytes: 255_000,
  maxEntryRawBytes: 975_000,
  maxInitialGzipBytes: 262_000,
  // Size alone is not enough: the smallest deferred heavy dependency (qrcode,
  // 10,118 gzip bytes) is smaller than any useful headroom, so it could drift
  // into the entry chunk unnoticed. These markers are matched case-insensitively
  // in the entry chunk's text and all four are at 0 hits today.
  forbiddenMarkers: ['maplibre', 'mapbox', 'jsqr', 'qrcode'],
};

// ── Measurement ──────────────────────────────────────────────────────────────
function listAssets(distDir) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const key = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, key); continue; }
      const buf = fs.readFileSync(abs);
      out.push({ file: key, bytes: buf.length, gzipBytes: zlib.gzipSync(buf, { level: 9 }).length, abs });
    }
  };
  walk(distDir, '');
  return out;
}

/** Case-insensitive occurrence count of each marker inside the entry chunk. */
function countMarkers(assets, policy) {
  const entry = assets.find((a) => policy.entryJs.test(a.file));
  const counts = {};
  if (!entry) return counts; // leave them UNMEASURED → the pure logic fails them
  // Vite injects a `__vite__mapDeps` array into the entry chunk listing every
  // dynamic-import chunk's filename (for modulepreload hints). Once two lazy
  // consumers share a heavy chunk (e.g. NavMap + StaffTeamMap both importing
  // maplibre-gl), that chunk's hashed filename — "maplibre-gl-<hash>.js" —
  // appears in this manifest as a plain string, tripping the marker check even
  // though the actual dependency code stays in its own separate chunk. Strip
  // the manifest's filename array before scanning so only real code matches.
  const text = fs.readFileSync(entry.abs, 'utf8').toLowerCase().replace(/m\.f=\[[^\]]*\]/g, 'm.f=[]');
  for (const m of policy.forbiddenMarkers) {
    let n = 0;
    let i = text.indexOf(m.toLowerCase());
    while (i !== -1) { n++; i = text.indexOf(m.toLowerCase(), i + m.length); }
    counts[m] = n;
  }
  return counts;
}

function requireDist(app) {
  const dist = path.join(root, 'apps', app, 'dist');
  if (!fs.existsSync(dist)) return null;
  return dist;
}

const fmt = (n) => n.toLocaleString('en-US');

// ── Participant app — GATED ──────────────────────────────────────────────────
const playDist = requireDist('play-web');
if (!playDist) {
  console.error('\n✗ apps/play-web/dist not found — run `npm run play:build` first.\n');
  process.exit(1);
}

const playAssets = listAssets(playDist);
const result = evaluateBundleBudget({
  assets: playAssets,
  markers: countMarkers(playAssets, PLAY_POLICY),
  policy: PLAY_POLICY,
});

console.log('\n📦 play-web bundle budget (participant app — GATED)\n');
console.log(result.report);

console.log('\n  emitted chunks (raw / gzip bytes):');
for (const a of [...playAssets].sort((x, y) => y.bytes - x.bytes)) {
  console.log(`    ${fmt(a.bytes).padStart(9)} / ${fmt(a.gzipBytes).padStart(8)}  ${a.file}`);
}

// ── Creator app — INFORMATIONAL ONLY (never affects the exit code) ───────────
// Desktop-first, not the field-critical surface, and under concurrent edit.
// Reported because a shared-package regression shows up in both apps.
const creatorDist = requireDist('creator-web');
if (creatorDist) {
  const ca = listAssets(creatorDist);
  const entry = ca.find((a) => PLAY_POLICY.entryJs.test(a.file));
  const css = ca.find((a) => PLAY_POLICY.entryCss.test(a.file));
  console.log('\n📊 creator-web (informational — not gated)');
  if (entry) console.log(`    entry js   ${fmt(entry.bytes).padStart(9)} raw / ${fmt(entry.gzipBytes).padStart(8)} gzip  ${entry.file}`);
  if (css) console.log(`    entry css  ${fmt(css.bytes).padStart(9)} raw / ${fmt(css.gzipBytes).padStart(8)} gzip  ${css.file}`);
} else {
  console.log('\n📊 creator-web: no dist/ (run `npm run creator:build` to include it) — not gated.');
}

if (!result.ok) {
  console.error('\n✗ play-web bundle budget EXCEEDED. Either the growth is deliberate (move the'
    + '\n  number in scripts/check-bundle-budget.mjs, with a note) or a lazy boundary'
    + '\n  collapsed — check for a new static import of a heavy dependency.\n');
  process.exit(1);
}
console.log('\n✓ play-web bundle budget OK.\n');
