// Pure-logic tests for the live photo feed report reducer (applyReport).
// Change: feed-ugc-safety. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed.
//
// DESIGN AMENDMENT: reportedBy is keyed by teamId, not uid. RushPoint supports
// shared team devices (multiple uids attached to one team via `deviceUids`), so
// per-uid distinctness would let a single team with two phones reach
// FEED_AUTO_HIDE_REPORTS on its own and hide a rival team's photo — exactly the
// griefing the threshold-of-2 exists to prevent. The `applyReport` parameter is
// named `reporterKey` (not `uid`) to keep the reducer pure/caller-agnostic; the
// callable passes teamId for participants and `staff:<uid>` for staff/owner.
import { applyReport, FEED_REPORT_REASONS, FEED_AUTO_HIDE_REPORTS } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const fresh = () => ({ active: true } as {
  reportedBy?: Record<string, string>;
  reportCount?: number;
  active?: boolean;
  hiddenAt?: string;
  hiddenBy?: string;
  reportsCleared?: boolean;
});

// ── Reason set ───────────────────────────────────────────────────────────────
ok(FEED_REPORT_REASONS.length === 4, 'FEED_REPORT_REASONS has exactly 4 entries');
ok(new Set(FEED_REPORT_REASONS).size === 4, 'FEED_REPORT_REASONS entries are distinct');
ok(FEED_AUTO_HIDE_REPORTS === 2, 'FEED_AUTO_HIDE_REPORTS is 2');

const [R1, R2] = [FEED_REPORT_REASONS[0], FEED_REPORT_REASONS[1]];

// ── Invalid reason throws ────────────────────────────────────────────────────
{
  let threw = false;
  try { applyReport(fresh(), 'team-a', 'because' as any); } catch { threw = true; }
  ok(threw, 'reason outside FEED_REPORT_REASONS throws');
}
{
  let threw = false;
  try { applyReport(fresh(), 'team-a', '' as any); } catch { threw = true; }
  ok(threw, 'empty reason throws');
}

// ── First report ─────────────────────────────────────────────────────────────
{
  const r = applyReport(fresh(), 'team-a', R1);
  ok(r.reportCount === 1, 'first report → reportCount 1');
  ok(r.reportedBy['team-a'] === R1, 'first report records reportedBy[team]');
  ok(r.active === true, 'item stays active after one report');
  ok(r.hidden === false, 'not hidden after one report');
  ok(r.changed === true, 'first report reports changed');
}

// ── Same team reporting again is idempotent ──────────────────────────────────
{
  const once = applyReport(fresh(), 'team-a', R1);
  const twice = applyReport(once, 'team-a', R1);
  ok(twice.changed === false, 'same team + same reason is a no-op (changed:false)');
  ok(twice.reportCount === 1, 'repeat never inflates reportCount');
}

// ── Same team, different reason updates reason but not count ────────────────
{
  const once = applyReport(fresh(), 'team-a', R1);
  const updated = applyReport(once, 'team-a', R2);
  ok(updated.reportedBy['team-a'] === R2, 'different reason updates stored reason');
  ok(updated.reportCount === 1, 'reason change does not raise reportCount');
}

// ── A second distinct TEAM hits the auto-hide threshold ─────────────────────
{
  let s = applyReport(fresh(), 'team-a', R1);
  s = applyReport(s, 'team-b', R2);
  ok(s.reportCount === 2, 'second distinct team → reportCount 2');
  ok(s.hidden === true, 'second distinct team flips hidden:true');
  ok(s.active === false, 'item becomes inactive');
  ok(s.hiddenBy === 'auto:reports', "hiddenBy is the sentinel 'auto:reports'");
  ok(typeof s.hiddenAt === 'string' && s.hiddenAt.length > 0, 'hiddenAt is set');
}

// ── A second device on the SAME team does NOT reach the threshold ──────────
// (the DESIGN AMENDMENT this test exists to lock in.)
{
  let s = applyReport(fresh(), 'team-a', R1);
  const before = { ...s };
  s = applyReport(s, 'team-a', R1); // "second device", same team, same reason
  ok(s.changed === false, 'second device on the same team re-reporting is idempotent (changed:false)');
  ok(s.reportCount === 1, 'second device on the same team does not raise reportCount');
  ok(s.active === true, 'a single team can never auto-hide an item on its own');
  ok(JSON.stringify(s.reportedBy) === JSON.stringify(before.reportedBy), 'reportedBy unchanged by the same-team repeat');
}

// ── A third report on an already-hidden item is idempotent ──────────────────
{
  let s = applyReport(fresh(), 'team-a', R1);
  s = applyReport(s, 'team-b', R2);
  ok(s.active === false, 'sanity: item is hidden after two distinct teams');
  const third = applyReport(s, 'team-c', R1);
  ok(third.hidden === false, 'third report on an already-hidden item reports hidden:false');
  ok(third.active === false, 'item stays inactive');
  ok(third.reportCount === 3, 'report is still recorded/counted');
}

// ── reportsCleared suppresses auto-hide even at/above threshold ────────────
{
  let s = applyReport(fresh(), 'team-a', R1);
  s = { ...s, reportsCleared: true };
  s = applyReport(s, 'team-b', R2);
  ok(s.active === true, 'reportsCleared keeps the item active at the threshold');
  ok(s.hidden === false, 'reportsCleared → hidden:false even though count reached threshold');
  ok(s.reportCount === 2, 'reportsCleared does not stop counting');
}

// ── Purity: the input object is not mutated ──────────────────────────────────
{
  const input = fresh();
  const frozenCopy = JSON.parse(JSON.stringify(input));
  applyReport(input, 'team-a', R1);
  ok(JSON.stringify(input) === JSON.stringify(frozenCopy), 'applyReport does not mutate its input');
}

// ── Deterministic `now` injection ────────────────────────────────────────────
{
  let s = applyReport(fresh(), 'team-a', R1, '2026-01-01T00:00:00.000Z');
  s = applyReport(s, 'team-b', R2, '2026-01-02T00:00:00.000Z');
  ok(s.hiddenAt === '2026-01-02T00:00:00.000Z', 'injected now() is used for hiddenAt');
}

console.log(failed === 0
  ? `\n✅ ALL FEED-REPORT TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
