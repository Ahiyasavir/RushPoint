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

console.log(`\n${failures.length === 0
  ? `✅ ALL ${passed} PUBLIC-TASK SEED-SHAPE ASSERTIONS PASSED`
  : `❌ ${failures.length} failure(s):\n   - ${failures.join('\n   - ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
