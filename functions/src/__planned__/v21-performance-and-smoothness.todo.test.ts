// ⚠️ RED-PHASE BLUEPRINT — NOT COVERAGE. The test.todo() lines below are the
// intended future RED tests for the mapped Appendix B roadmap rows; they assert
// nothing yet. Do not read this file's existence as test coverage. When a row is
// started, convert its todos into real failing tests first (see openspec/config.yaml).
// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Performance budgets & "buttery smooth" UX
// ───────────────────────────────────────────────────────────────────────────
// The DETERMINISTIC half of this guarantee already ships and gates today:
// scripts/test-perf-budget.ts pins the budget contract (HARD LCP ≤ 2500ms, INP
// ≤ 200ms, CLS ≤ 0.1, bundle ceilings) from packages/shared/src/perfBudget.ts.
// The todos below are the MEASURED half — real numbers from a real build / a real
// browser — plus the smoothness techniques that keep us under budget. Each is the
// RED target for its OpenSpec change. See v21-data-and-scalability.todo.test.ts
// for how to flip a todo into a real test. Maps to TECH_SPEC.md §21.A + Appendix B
// rows 23–25.
import { describe, test } from 'vitest';

describe('Appendix B #23 — page-load budget: every route usable in ≤ 2.5s [§21.A]', () => {
  test.todo('[ui] cold-load LCP of Join, Play, Final, Dashboard, Builder, RunConsole each ≤ TIMING_BUDGET_MS.lcp (2500)');
  test.todo('[ui] FCP ≤ 1800ms and CLS ≤ 0.1 on every route (skeletons reserve layout; no jump)');
  test.todo('[build] initial JS chunk ≤ BUNDLE_BUDGET_KB.initialJs (gzipped) — parsed from the Vite build manifest');
  test.todo('[build] MapLibre + story-card canvas are NOT in any initial chunk (lazy-only, off the critical path)');
  test.todo('[build] each lazy route chunk ≤ BUNDLE_BUDGET_KB.lazyChunk (gzipped)');
  test.todo('[ui] repeat visit (warm SW precache + persistentLocalCache) paints from cache in ≤ 1s');
  test.todo('[pure] reportWebVitals maps web-vitals samples through isWithinTimingBudget and flags busts');
  test.todo('[e2e] hot callables (getMyTeamState, getJoinInfo) respond fast — min-instances / payload kept small to dodge cold starts');
});

describe('Appendix B #24 — runtime smoothness: no jank, 60fps, INP ≤ 200ms [§21.A]', () => {
  test.todo('[ui] tapping a task control yields INP ≤ TIMING_BUDGET_MS.inp (200ms) — optimistic UI, no await-blocked paint');
  test.todo('[ui] no main-thread long task > TIMING_BUDGET_MS.longTask (50ms) during steady-state play');
  test.todo('[ui] RunConsole teams table + leaderboard are virtualized (windowed) — smooth at 100+ rows');
  test.todo('[ui] story-card canvas generation does not block the main thread (OffscreenCanvas / worker / idle)');
  test.todo('[pure] non-urgent work (telemetry, prefetch) is scheduled via requestIdleCallback, not inline');
  test.todo('[ui] depends on the four perf quick-wins (Appendix B #11–#14) landing first');
});

describe('Appendix B #25 — smooth transitions & perceived performance [§21.A]', () => {
  test.todo('[ui] route/screen transitions complete in ≤ TIMING_BUDGET_MS.routeTransition (300ms)');
  test.todo('[ui] transitions animate only GPU-composited props (transform/opacity), never layout properties');
  test.todo('[ui] all motion (transitions, interstitials, confetti) honors prefers-reduced-motion');
  test.todo('[ui] every async surface shows a skeleton (reserved layout), never a layout-shifting spinner');
  test.todo('[ui] likely next route chunk is prefetched on intent (hover / idle) so navigation feels instant');
  test.todo('[ui] optimistic task completion shows the success state immediately, reconciled on server confirm');
});
