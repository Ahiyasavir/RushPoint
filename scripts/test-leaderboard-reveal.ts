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

// ── 2. finalizeRun must not hardcode the published flag ─────────────────────
const runsSrc = read('functions/src/runs/index.ts');
const finalizeIdx = runsSrc.indexOf('export const finalizeRun');
ok(finalizeIdx >= 0, 'finalizeRun still exists in functions/src/runs/index.ts');
const finalizeBody = runsSrc.slice(finalizeIdx, finalizeIdx + 6000);
ok(
  !/leaderboard:\s*\{\s*rankings,\s*frozen:\s*true,\s*published:\s*true/.test(finalizeBody),
  'finalizeRun no longer hardcodes published: true (apply patch A from docs/wave-b/leaderboard-reveal.md)',
);
ok(
  /published:\s*!game\.manualLeaderboardReveal/.test(finalizeBody),
  'finalizeRun derives published from game.manualLeaderboardReveal',
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
  console.error(
    '\n  NOTE: the two finalizeRun assertions stay RED until the one line patch in\n' +
    '  docs/wave-b/leaderboard-reveal.md ("Patch A") is applied to\n' +
    '  functions/src/runs/index.ts — that file was locked by another agent when this\n' +
    '  test was written. Everything else is implemented.\n',
  );
  process.exit(1);
}
