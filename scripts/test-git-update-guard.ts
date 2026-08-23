// Pure-logic tests for fix-playtest-git-poll-collapse (fast-forward-safety guard).
// Run by scripts/run-unit-tests.mjs via `npm test`. No git, no network, no spawn.
import { canFastForwardApply } from './lib/gitUpdateGuard.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── up-to-date: nothing to apply ─────────────────────────────────────────────
{
  const r = canFastForwardApply({ ahead: 0, behind: 0, changedUpstreamFiles: [], dirtyFiles: [] });
  ok(r.ok === false, 'behind 0 → not ok');
  ok(r.reason === 'up-to-date', "behind 0 → reason 'up-to-date'");
}

// ── clean fast-forward: strictly behind, no overlap ──────────────────────────
{
  const r = canFastForwardApply({
    ahead: 0, behind: 2,
    changedUpstreamFiles: ['functions/src/index.ts', 'README.md'],
    dirtyFiles: [],
  });
  ok(r.ok === true, 'strictly behind + clean → ok');
  ok(r.reason === 'ff', "clean ff → reason 'ff'");
}

// ── diverged: local commits ahead → cannot fast-forward ──────────────────────
{
  const r = canFastForwardApply({ ahead: 1, behind: 1, changedUpstreamFiles: ['a.ts'], dirtyFiles: [] });
  ok(r.ok === false, 'ahead > 0 (diverged) → not ok');
  ok(r.reason === 'diverged', "diverged → reason 'diverged'");
}

// ── dirty conflict: an incoming file is locally modified → pull would fail ────
{
  const r = canFastForwardApply({
    ahead: 0, behind: 3,
    changedUpstreamFiles: ['apps/creator-web/src/services/firebase.ts', 'x.ts'],
    dirtyFiles: ['apps/creator-web/src/services/firebase.ts'],
  });
  ok(r.ok === false, 'incoming file locally dirty → not ok');
  ok(r.reason.startsWith('dirty-conflict'), "dirty overlap → reason starts 'dirty-conflict'");
  ok(r.reason.includes('firebase.ts'), 'dirty-conflict reason names the offending file');
}

// ── dirt that does NOT overlap the incoming diff → still safe to ff ───────────
{
  const r = canFastForwardApply({
    ahead: 0, behind: 1,
    changedUpstreamFiles: ['functions/src/index.ts'],
    dirtyFiles: ['package-lock.json', '.claude/settings.local.json'],
  });
  ok(r.ok === true, 'non-overlapping dirt → still ok (ff safe)');
  ok(r.reason === 'ff', 'non-overlapping dirt → reason ff');
}

// ── defaults: omitted file arrays behave as empty ────────────────────────────
{
  const r = canFastForwardApply({ ahead: 0, behind: 1 });
  ok(r.ok === true, 'omitted changedUpstreamFiles/dirtyFiles default to empty → ff');
}

console.log(failed === 0
  ? `\n✅ ALL GIT-UPDATE-GUARD TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
