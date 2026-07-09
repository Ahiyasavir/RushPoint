// Pure-logic tests for targeted-announcements (change: targeted-announcements).
// Covers the two shared helpers both the play client and the e2e depend on:
//   - announcementVisibleTo (the per-team visibility predicate)
//   - formatScoreNotice     (bilingual, sign-aware score-notice copy)
// Run by scripts/run-unit-tests.mjs via `npm test`. No emulator needed.
import { announcementVisibleTo, formatScoreNotice } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── announcementVisibleTo ─────────────────────────────────────────────────────
ok(announcementVisibleTo({}, 'team-A') === true, 'no teamId ⇒ visible to anyone');
ok(announcementVisibleTo({ teamId: undefined }, 'team-A') === true, 'undefined teamId ⇒ visible');
ok(announcementVisibleTo({ teamId: '' }, 'team-A') === true, 'empty-string teamId ⇒ treated as global/visible');
ok(announcementVisibleTo({ teamId: 'team-A' }, 'team-A') === true, 'own team ⇒ visible');
ok(announcementVisibleTo({ teamId: 'team-B' }, 'team-A') === false, 'other team ⇒ hidden');

// ── formatScoreNotice ─────────────────────────────────────────────────────────
// Positive delta renders a leading '+'.
{
  const en = formatScoreNotice(50, 'Great teamwork', 'en');
  ok(en.startsWith('+50'), `positive EN starts with +50 (got "${en}")`);
  ok(en.includes('Great teamwork'), 'positive EN includes reason');
}
// Negative delta renders a sign (minus).
{
  const en = formatScoreNotice(-25, 'Late to point', 'en');
  ok(/-|−/.test(en) && en.includes('25'), `negative EN shows a minus and 25 (got "${en}")`);
  ok(en.includes('Late to point'), 'negative EN includes reason');
}
// Reason optional.
{
  const en = formatScoreNotice(15, undefined, 'en');
  ok(en.trim() === '+15' || en.startsWith('+15'), `no-reason EN is just the signed delta (got "${en}")`);
}
// Language: EN output must contain no Hebrew; HE output must contain Hebrew.
{
  const en = formatScoreNotice(50, 'Great teamwork', 'en');
  const he = formatScoreNotice(50, 'עבודת צוות מצוינת', 'he');
  ok(!/[֐-׿]/.test(en), 'EN output contains no Hebrew characters');
  ok(/[֐-׿]/.test(he), 'HE output contains Hebrew characters');
}
// Sign is always rendered on the delta regardless of language.
{
  const he = formatScoreNotice(30, undefined, 'he');
  ok(he.includes('+30'), `HE positive delta still shows +30 (got "${he}")`);
}

console.log(failed === 0
  ? `\n✅ ALL TARGETED-ANNOUNCEMENTS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
