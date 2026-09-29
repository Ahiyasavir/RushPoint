// Pure-logic tests for targeted-announcements (change: targeted-announcements).
// Covers the two shared helpers both the play client and the e2e depend on:
//   - announcementVisibleTo (the per-team visibility predicate)
//   - formatScoreNotice     (bilingual, sign-aware score-notice copy)
// Run by scripts/run-unit-tests.mjs via `npm test`. No emulator needed.
import { announcementVisibleTo, formatScoreNotice, routeNoticeStillCurrent, newestRouteNoticeId } from '@rushpoint/shared';

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

// Overnight 2026-09-29, played at 375x667: every operator route left a "הצוות שלח אתכם אל: X" notice,
// and old ones stayed after the team moved on (three stacked, two naming a mission no longer current),
// pushing the mission's own button out of the sheet. A route notice is shown only while X is current.
ok(routeNoticeStillCurrent({ kind: 'forceAssign', taskId: 'x' }, 'x') === true, 'route notice for the current mission is shown');
ok(routeNoticeStillCurrent({ kind: 'forceAssign', taskId: 'x' }, 'y') === false, 'route notice for a mission the team has left is hidden');
ok(routeNoticeStillCurrent({ kind: 'forceAssign', taskId: 'x' }, null) === true, 'between missions (unknown current) a route notice stays: fail open');
ok(routeNoticeStillCurrent({ kind: 'announcement', taskId: 'x' }, 'y') === true, 'an ordinary announcement is never hidden by this');
ok(routeNoticeStillCurrent({ kind: 'forceAssign' }, 'y') === true, 'a route notice with no task id stays');

// Two routes to the same mission left two identical notices: only the NEWEST route notice is shown.
ok(newestRouteNoticeId([
  { id: 'a', kind: 'forceAssign', createdAt: '2026-09-29T01:00:00.000Z' },
  { id: 'b', kind: 'forceAssign', createdAt: '2026-09-29T02:00:00.000Z' },
  { id: 'c', kind: 'announcement', createdAt: '2026-09-29T03:00:00.000Z' },
]) === 'b', 'the newest route notice wins; ordinary announcements do not count');
ok(newestRouteNoticeId([{ id: 'c', kind: 'announcement' }]) === null, 'no route notice ⇒ null');
ok(newestRouteNoticeId(null as never) === null, 'junk ⇒ null');

console.log(failed === 0
  ? `\n✅ ALL TARGETED-ANNOUNCEMENTS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
