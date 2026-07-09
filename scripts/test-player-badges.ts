// Pure-logic tests for player-profile-badges. Run by scripts/run-unit-tests.mjs.
import { evaluateBadges, mergePlayerResult, emptyProfile } from '@rushpoint/shared';

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string) { if (cond) passed++; else { failed++; console.error(`  ✗ ${msg}`); } }

// evaluateBadges thresholds
ok(evaluateBadges({ gamesPlayed: 0, tasksCompleted: 0, totalPoints: 0 }).length === 0, 'no badges at zero');
ok(evaluateBadges({ gamesPlayed: 1, tasksCompleted: 0, totalPoints: 0 }).includes('first_finish'), 'first_finish at 1 game');
ok(evaluateBadges({ gamesPlayed: 1, tasksCompleted: 10, totalPoints: 0 }).includes('explorer'), 'explorer at 10 tasks');
ok(evaluateBadges({ gamesPlayed: 5, tasksCompleted: 0, totalPoints: 0 }).includes('veteran'), 'veteran at 5 games');
ok(evaluateBadges({ gamesPlayed: 1, tasksCompleted: 0, totalPoints: 500 }).includes('high_scorer'), 'high_scorer at 500 pts');

// First finish from empty
const r1 = mergePlayerResult(null, { uid: 'u1', displayName: 'Ann', tasksCompleted: 3, points: 120 });
ok(r1.profile.gamesPlayed === 1 && r1.profile.tasksCompleted === 3 && r1.profile.totalPoints === 120, 'first result accumulates');
ok(r1.newBadges.includes('first_finish'), 'first_finish is newly earned');
ok(r1.profile.displayName === 'Ann', 'display name captured');

// Second run accumulates and does NOT re-award first_finish
const r2 = mergePlayerResult(r1.profile, { uid: 'u1', tasksCompleted: 8, points: 400 });
ok(r2.profile.gamesPlayed === 2 && r2.profile.tasksCompleted === 11 && r2.profile.totalPoints === 520, 'second result accumulates');
ok(!r2.newBadges.includes('first_finish'), 'first_finish not re-awarded');
ok(r2.newBadges.includes('explorer') && r2.newBadges.includes('high_scorer'), 'crossing thresholds awards new badges');
ok(r2.profile.displayName === 'Ann', 'display name persists when omitted');

// Negatives floored
const r3 = mergePlayerResult(null, { uid: 'u2', tasksCompleted: -5, points: -100 });
ok(r3.profile.tasksCompleted === 0 && r3.profile.totalPoints === 0, 'negative inputs floored at 0');

// Idempotent-ish: same stats → same badge set
ok(JSON.stringify(evaluateBadges(r2.profile)) === JSON.stringify(r2.profile.badges), 'badge set matches stats');

// emptyProfile shape
const e = emptyProfile('u3');
ok(e.gamesPlayed === 0 && e.badges.length === 0 && e.uid === 'u3', 'emptyProfile is zeroed');

console.log(failed === 0 ? `\n✅ ALL PLAYER-BADGE TESTS PASSED (${passed})` : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
