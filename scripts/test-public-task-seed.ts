// Seeded public tasks must obey the published-location rule
// (change: public-task-area-visibility).
//
// `publicTasks/{id}` is `allow read: if true`. `task-library-map-view` moved every
// public task's location onto a coarse `approxLocation` derived by the shared
// `publicTaskLocation()` rule, and stopped writing the EXACT authored
// `coordinates` there at all — for hideLocation tasks that exact point is
// server-secret everywhere else in this codebase.
//
// publishGame was fixed. The SEED writers were not: each of them was still writing
// `coordinates: t.coordinates` into the public document and no area at all. Two
// consequences, both observed: a freshly seeded environment shows an EMPTY mission
// library map (nothing is plottable, because nothing has an area), and every seed
// re-publishes exact authored points into a world-readable collection.
//
// The seeders are I/O scripts against a live emulator, so they cannot be executed
// in the pure lane. What IS checkable without an emulator — and what actually
// regressed — is the SHAPE of the document each one writes. This test reads the
// four seed sources and asserts it, so the next hand-rolled public-task write
// fails loudly here instead of silently re-opening the exposure.
//
// No emulator, no network — this test only reads files.
//   npx tsx scripts/test-public-task-seed.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every source that writes a `publicTasks/{id}` document. */
const SEED_SOURCES = [
  'scripts/seed-local.mjs',
  'scripts/seed-games-youth.mjs',
  'scripts/lib/sansana-game-def.mjs',
  'scripts/lib/qa-game-def.mjs',
];

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failures.push(msg); console.log(`  FAIL ${msg}`); }
}

/**
 * The text of the object literal written to `publicTasks/...`.
 *
 * Located by the `publicTasks/` path template and closed by brace matching from
 * the following `{`, so the assertions below are scoped to the public document and
 * cannot be satisfied (or tripped) by unrelated code elsewhere in the file.
 *
 * The path itself is a template literal (`` `publicTasks/${gameId}_${t.id}` ``), so
 * the opening brace is the first one NOT preceded by `$` — a naive "next {" lands
 * inside the placeholder and silently scopes every assertion to `${GAME_ID}`.
 */
function publicTaskWriteBlock(src: string): string | null {
  const at = src.indexOf('publicTasks/');
  if (at < 0) return null;
  let open = -1;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '{' && src[i - 1] !== '$') { open = i; break; }
  }
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

console.log('\n🔒 publicTasks seed-write shape\n');

for (const rel of SEED_SOURCES) {
  console.log(`▶ ${rel}`);
  const src = readFileSync(join(root, rel), 'utf8');
  const block = publicTaskWriteBlock(src);

  ok(block !== null, `${rel}: a publicTasks/{id} write is present and parseable`);
  if (!block) continue;

  // 1. The exact authored point must not be written into the public document.
  //    `coordinates:` anywhere in that literal is the exposure, whatever it is
  //    assigned from (`t.coordinates`, a hideLocation ternary, a constant).
  ok(!/\bcoordinates\s*:/.test(block),
    `${rel}: writes NO exact "coordinates" into the public document`);

  // 2. The area must come from the shared rule, not be re-derived by hand — the
  //    rule is what encodes hideLocation / locationless / null-island omission.
  ok(/\bapproxLocation\b/.test(block),
    `${rel}: writes the coarse "approxLocation" area`);
  ok(/publicTaskLocation\s*\(/.test(src),
    `${rel}: derives the area with the shared publicTaskLocation() rule`);
  ok(/from\s+'@rushpoint\/shared'/.test(src),
    `${rel}: imports the rule from @rushpoint/shared (single source of truth)`);

  // 3. The field must be OMITTED, not written as null/placeholder, when the rule
  //    yields nothing — a stored key is still a stored key.
  ok(/\.\.\.\(\s*approxLocation\s*\?/.test(block),
    `${rel}: omits the area entirely when the rule yields none`);
}

// ─── The publish path itself (change: hidden-location-map-visibility) ─────────
//
// `publishGame` is the primary writer of `publicTasks/{id}`, and the change that
// made hidden-location tasks publish an AREA is exactly the kind of change that
// invites someone to "simplify" the writer by inlining a location decision back
// into it. The document shape is assertable without an emulator, so it is
// asserted here next to the seeders that write the same document.
//
// Anchored on the typed literal rather than on a path template — the publish path
// builds its ref through FIRESTORE_PATHS.publicTask(), so the string
// `publicTasks/` never appears in the file.
{
  const rel = 'functions/src/games/index.ts';
  console.log(`\n▶ ${rel}`);
  const src = readFileSync(join(root, rel), 'utf8');
  const anchor = src.indexOf('const publicTask: PublicTask = {');
  ok(anchor >= 0, `${rel}: the publicTasks document literal is present and locatable`);
  if (anchor >= 0) {
    const open = src.indexOf('{', anchor + 'const publicTask: PublicTask = '.length - 1);
    let depth = 0, block = '';
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) { block = src.slice(open, i + 1); break; }
      }
    }
    ok(block.length > 0, `${rel}: the document literal is brace-balanced and parseable`);
    // The exact authored point must never reach a world-readable document.
    ok(!/\bcoordinates\s*:/.test(block),
      `${rel}: writes NO exact "coordinates" into the public document`);
    // The area comes from the shared rule…
    ok(/\bapproxLocation\b/.test(block),
      `${rel}: writes the coarse "approxLocation" area`);
    ok(/const\s+approxLocation\s*=\s*publicTaskLocation\s*\(\s*task\s*\)/.test(src),
      `${rel}: derives the area with the shared publicTaskLocation() rule`);
    // …and the field is omitted, never nulled, when the rule yields nothing.
    ok(/\.\.\.\(\s*approxLocation\s*\?/.test(block),
      `${rel}: omits the area entirely when the rule yields none`);
    // …and the writer applies NO location policy of its own. A `hideLocation`
    // test here would be a second copy of the rule, free to drift from the one in
    // @rushpoint/shared that every other consumer obeys.
    ok(!/hideLocation/.test(block),
      `${rel}: applies no hideLocation branch of its own (one rule, not two)`);
  }
}

// ─── The seed self-heals legacy publicTasks (gallery-precise-task-location) ───
//
// A `publicTasks` document written before the precise-location rule keeps its
// legacy shape (exact `coordinates`, no `approxLocation`) forever: the demo games
// are seed-if-present and a creator's own games are never re-seeded, so nothing
// ever repaired them and every located mission silently vanished from the gallery
// map. seed-local.mjs now runs a repair sweep on every boot, reusing the SAME
// shared rule (`repairPublicTask`) the production backfill applies. This asserts
// that sweep is present and wired, so it can't be quietly dropped — which would
// re-open the "no missions on the map" bug on the next fresh emulator.
{
  const rel = 'scripts/seed-local.mjs';
  console.log(`\n▶ ${rel} (self-heal sweep)`);
  const src = readFileSync(join(root, rel), 'utf8');
  ok(/repairPublicTask\b/.test(src) && /mayNeedPublicTaskRepair\b/.test(src),
    `${rel}: imports the shared repairPublicTask / mayNeedPublicTaskRepair rule`);
  ok(/from\s+'@rushpoint\/shared'/.test(src),
    `${rel}: sources the repair rule from @rushpoint/shared (single source of truth)`);
  ok(/async function repairPublicTaskAreas\s*\(/.test(src),
    `${rel}: defines the repairPublicTaskAreas sweep`);
  ok(/await\s+repairPublicTaskAreas\s*\(\s*\)/.test(src),
    `${rel}: runs the sweep from main() on every seed/boot`);
  // The legacy exact point must be DELETED, not left beside the new area.
  ok(/coordinates\s*:\s*DELETE/.test(src),
    `${rel}: deletes the legacy exact "coordinates" as it writes the area`);
}

console.log(`\n${failures.length === 0
  ? `✅ ALL ${passed} PUBLIC-TASK SEED-SHAPE ASSERTIONS PASSED`
  : `❌ ${failures.length} failure(s):\n   - ${failures.join('\n   - ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
