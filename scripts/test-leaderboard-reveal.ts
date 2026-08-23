// Pure-logic + source-level guards for manual-leaderboard-reveal (Wave B / Task 4).
//
// The feature is "the final board stays hidden from PLAYERS until the creator
// reveals it". There is no single pure function to exercise (the behaviour is a
// one-line predicate inside finalizeRun plus render gates), so this file locks
// the four places that can silently regress it:
//   1. the reveal predicate itself (default-off semantics),
//   2. finalizeRun must NOT hardcode published: true,
//   3. updateGame must accept + persist the flag,
//   4. the flag must never be denormalized into publicGames,
//   5. FinalScreen must gate its rankings UI on `published`.
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── 1. Reveal predicate — the exact expression finalizeRun uses ──────────────
// published = !game.manualLeaderboardReveal: absent/false ⇒ auto-publish (every
// pre-existing game keeps today's behaviour), true ⇒ staged reveal.
const publishedOnFinalize = (game: { manualLeaderboardReveal?: boolean }) => !game.manualLeaderboardReveal;
ok(publishedOnFinalize({}) === true, 'absent flag → auto-publish (back-compat)');
ok(publishedOnFinalize({ manualLeaderboardReveal: false }) === true, 'flag false → auto-publish');
ok(publishedOnFinalize({ manualLeaderboardReveal: true }) === false, 'flag true → board stays unpublished');
ok(publishedOnFinalize({ manualLeaderboardReveal: undefined }) === true, 'undefined flag → auto-publish');

// ── 2. the finalize WRITE must not hardcode the published flag ───────────────
// (change: fix-solo-selfguided-finalize) The authoritative finalize write — read
// game+teams, buildRankings, the runRef.update — was factored out of the
// finalizeRun callable into the internal finalizeRunCore so the hostless-solo
// auto-finalize path can reuse it verbatim. finalizeRun the callable keeps its
// auth/ownership check and delegates the write. So the published derivation now
// lives in the core; assert against it (the semantic is unchanged).
const runsSrc = read('functions/src/runs/index.ts');
ok(runsSrc.includes('export const finalizeRun'), 'finalizeRun callable still exists in functions/src/runs/index.ts');
const coreIdx = runsSrc.indexOf('async function finalizeRunCore');
ok(coreIdx >= 0, 'finalizeRunCore holds the authoritative finalize write');
const finalizeBody = runsSrc.slice(coreIdx, coreIdx + 6000);
ok(
  !/leaderboard:\s*\{\s*rankings,\s*frozen:\s*true,\s*published:\s*true\b/.test(finalizeBody),
  'the finalize write no longer hardcodes published: true (it is derived)',
);
ok(
  /!game\.manualLeaderboardReveal/.test(finalizeBody),
  'the finalize write derives published from game.manualLeaderboardReveal',
);

// ── 3./4. updateGame persists the flag; publicGames never carries it ─────────
const gamesSrc = read('functions/src/games/index.ts');
ok(
  /manualLeaderboardReveal/.test(gamesSrc),
  'games/index.ts handles manualLeaderboardReveal',
);
ok(
  /updates\.manualLeaderboardReveal\s*=\s*manualLeaderboardReveal/.test(gamesSrc),
  'updateGame assigns manualLeaderboardReveal onto the update patch',
);
for (const marker of ['const publicDoc', 'PublicGame = {']) {
  const idx = gamesSrc.indexOf(marker);
  if (idx < 0) continue;
  ok(
    !gamesSrc.slice(idx, idx + 1400).includes('manualLeaderboardReveal'),
    `publicGames denormalization at "${marker}" does not leak manualLeaderboardReveal`,
  );
}

// ── 5. FinalScreen gates its board on published ──────────────────────────────
const finalSrc = read('apps/play-web/src/screens/FinalScreen.tsx');
ok(
  /leaderboard\?\.published|boardPublished/.test(finalSrc),
  'FinalScreen reads the published flag',
);
ok(
  !/\{run\.leaderboard && run\.leaderboard\.rankings\.length > 0 &&/.test(finalSrc),
  'FinalScreen no longer renders the board purely on existence',
);
ok(
  /notRevealed/.test(finalSrc),
  'FinalScreen renders a "results not revealed yet" state',
);

// ── i18n parity for the new keys (HE must be Hebrew, EN must be Latin) ───────
const playI18n = read('apps/play-web/src/i18n.ts');
ok((playI18n.match(/notRevealedTitle:/g) ?? []).length === 2, 'play-web i18n: notRevealedTitle in both locales');
ok((playI18n.match(/notRevealedBody:/g) ?? []).length === 2, 'play-web i18n: notRevealedBody in both locales');
const creatorI18n = read('apps/creator-web/src/i18n.ts');
for (const key of ['revealStandings', 'standingsHiddenUntilReveal', 'standingsRevealed']) {
  // Anchored to the namespace's own indentation. An unanchored `key:` also
  // matched the nested `runConsole.consequence` block added by
  // change: run-console-clarity, which reuses the action ids as its copy keys,
  // so the count read 4 for a dictionary that is still correct.
  ok((creatorI18n.match(new RegExp(`^ {4}${key}:`, 'gm')) ?? []).length === 2, `creator-web i18n: ${key} in both locales`);
}

console.log(`\nleaderboard-reveal: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
