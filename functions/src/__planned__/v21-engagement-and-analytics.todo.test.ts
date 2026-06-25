// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Engagement, analytics & discovery
// ───────────────────────────────────────────────────────────────────────────
// Each test.todo becomes a real failing test when the change is implemented via /opsx:apply.
// OpenSpec changes:
//   openspec/changes/tv-leaderboard/
//   openspec/changes/streak-momentum/
//   openspec/changes/run-analytics-heatmap/
//   openspec/changes/surprise-trivia-waypoints/
// Lane tags: [pure] → scripts/test-*.ts · [e2e] → scripts/e2e-verify.mjs · [ui] → preview tools
//            [rules] → scripts/test-rules.mjs
import { describe, test } from 'vitest';

// ─── TV Leaderboard ──────────────────────────────────────────────────────────
describe('tv-leaderboard — full-screen auto-refreshing standings for projection', () => {
  test.todo('[ui] ?tv=<accessCode> renders full-screen standings (rank, team, score, time) for a published run');
  test.todo('[ui] ?tv= for an unpublished run shows a "not available" state (published gate enforced)');
  test.todo('[ui] display auto-refreshes and updates within 15 s without manual action');
  test.todo('[ui] when the leading team changes between refreshes, a "Now in the lead!" highlight fires');
  test.todo('[ui] creator RunConsole "TV Screen" button opens/copies the ?tv=<accessCode> URL');
});

// ─── Streak & Momentum ───────────────────────────────────────────────────────
describe('streak-momentum — consecutive-task engagement counter', () => {
  test.todo('[pure] computeStreak: consecutive completions correctly increment the streak count');
  test.todo('[pure] computeStreak: a skipped task resets the streak to 0');
  test.todo('[pure] computeStreak: a gap > breakMultiplier × medianMs resets the streak');
  test.todo('[pure] computeStreak: milestone value returned at exactly 3, 5, and 10');
  test.todo('[pure] computeStreak: streak of 0 or 1 returns milestone: null');
  test.todo('[pure] computeMedianTaskMs: returns correct median for odd/even-length arrays');
  test.todo('[pure] computeMedianTaskMs: returns a sensible default for an empty list');
  test.todo('[ui] play screen shows "🔥 N in a row!" chip when streak ≥ 2');
  test.todo('[ui] chip is not rendered when streak is 0 or 1');
  test.todo('[ui] milestone animation class is NOT applied when prefers-reduced-motion is active');
});

// ─── Run Analytics & Heatmap ─────────────────────────────────────────────────
describe('run-analytics-heatmap — post-run creator analytics dashboard (Pro-gated)', () => {
  // Pure aggregator
  test.todo('[pure] computeRunAnalytics: completion rate = completed / (completed + skipped + timed-out)');
  test.todo('[pure] computeRunAnalytics: median computed correctly for odd and even team counts');
  test.todo('[pure] computeRunAnalytics: p90 computed correctly');
  test.todo('[pure] computeRunAnalytics: hint and skip counts summed correctly per task');
  test.todo('[pure] computeRunAnalytics: stage drop-off = teams that reached the stage but did not finish it');
  test.todo('[pure] computeRunAnalytics: prune-safe — cleared team contributes 0 with no error');
  test.todo('[pure] computeRunAnalytics: result is deterministic regardless of input order');
  // Callable
  test.todo('[e2e] getRunAnalytics as owner returns correct per-task structure after finalize');
  test.todo('[e2e] getRunAnalytics as non-owner returns permission-denied');
  test.todo('[e2e] getRunAnalytics on a non-finished run returns an appropriate error');
  // UI
  test.todo('[ui] Analytics tab renders route map with green/amber/red task pins by completion rate');
  test.todo('[ui] Analytics tab renders sortable per-task table (completion %, median time, hints, skips)');
  test.todo('[ui] non-Pro creator sees an upsell chip — analytics data is not rendered');
});

// ─── Surprise Trivia Waypoints (Discovery POIs) ───────────────────────────────
describe('surprise-trivia-waypoints — hidden geofenced POIs with trivia bonus', () => {
  // Pure math
  test.todo('[pure] isWithinPoiRadius: coords inside radius → true');
  test.todo('[pure] isWithinPoiRadius: coords on the boundary (exactly radiusMeters away) → true');
  test.todo('[pure] isWithinPoiRadius: coords outside radius → false');
  test.todo('[pure] isWithinPoiRadius: invalid coords → throws LocationError');
  test.todo('[pure] matchesDiscoveryAnswer: exact match → true');
  test.todo('[pure] matchesDiscoveryAnswer: case-insensitive match → true');
  test.todo('[pure] matchesDiscoveryAnswer: extra whitespace trimmed → true');
  test.todo('[pure] matchesDiscoveryAnswer: wrong answer → false; no false positives');
  test.todo('[pure] buildOverpassQuery: output contains the bbox coords and expected OSM tag strings');
  test.todo('[pure] buildOverpassQuery: adversarial bbox values do not alter the query structure (injection-safe)');
  test.todo('[pure] isPoiAlreadyClaimed: "answered" → true; undefined / "triggered" → false');
  // Firestore rules
  test.todo('[rules] discoveryPois — creator (owner) get/list succeeds');
  test.todo('[rules] discoveryPois — play client (different uid) get/list denied');
  // Callable
  test.todo('[e2e] claimDiscoveryPoi: correct coords + correct answer → { correct: true, bonusPoints: N }');
  test.todo('[e2e] claimDiscoveryPoi: correct coords + correct answer increments team earnedScore');
  test.todo('[e2e] claimDiscoveryPoi: correct coords + wrong answer → { correct: false, bonusPoints: 0 }, score unchanged');
  test.todo('[e2e] claimDiscoveryPoi: coords outside radius → failed-precondition');
  test.todo('[e2e] claimDiscoveryPoi: second call for same team+POI → already-exists, no double-credit');
  test.todo('[e2e] getRunDiscoveryPois: response contains NO coordinates or answers fields');
  // UI — Builder
  test.todo('[ui] Builder "Discovery POIs" panel lets creator place a POI on the map and save it');
  test.todo('[ui] Builder "Suggest POIs" queries Overpass and shows up to 10 add-cards with name/category');
  test.todo('[ui] a creator-added POI does NOT appear on the participant route map or task list');
  // UI — Play
  test.todo('[ui] discovery overlay appears when team GPS enters a POI radius for the first time');
  test.todo('[ui] overlay shows flavor text and trivia question');
  test.todo('[ui] overlay does NOT reappear for an already-answered POI on GPS fluctuation');
  test.todo('[ui] correct answer shows "Correct! +N points" feedback');
  test.todo('[ui] wrong answer shows result without error or score change');
});
