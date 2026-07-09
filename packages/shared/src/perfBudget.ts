// ─── Performance budgets — the single source of truth for "fast & smooth" ─────
//
// RushPoint targets an instant-feeling, jank-free experience on a mid-range phone
// over mobile data. These budgets are the contract: the app reports real Web
// Vitals against them (lib/perf.ts → reportWebVitals), the build gate checks
// bundle sizes against them, and the test suite asserts both the contract's
// internal consistency and (when measured) the live numbers.
//
// HARD REQUIREMENT: no route may take more than 2.5s to become usable (LCP).
// 2.5s is also the Core Web Vitals "good" threshold for LCP — we adopt it as a
// ceiling, not an average.

// ─── Timing budgets (milliseconds) ───────────────────────────────────────────
export const TIMING_BUDGET_MS = {
  /** Largest Contentful Paint — the hard page-load ceiling. */
  lcp: 2500,
  /** First Contentful Paint — something meaningful on screen. */
  fcp: 1800,
  /** Total Blocking Time — main-thread blocked during load. */
  tbt: 200,
  /** Interaction to Next Paint — tap/click responsiveness (no jank). */
  inp: 200,
  /** In-app route/screen transition — must feel instant. */
  routeTransition: 300,
  /** A single main-thread task longer than this is a "long task" (jank). */
  longTask: 50,
  /** One animation frame at 60fps. Work per frame must fit under this. */
  frame: 16.7,
} as const;

// ─── Cumulative Layout Shift (unitless) ───────────────────────────────────────
/** No visible jump/reflow as content loads. CWV "good" = 0.1. */
export const CLS_BUDGET = 0.1;

// ─── Bundle budgets (gzipped KB) ──────────────────────────────────────────────
// Initial = what's needed to paint + interact on the first route. Heavy deps
// (MapLibre, the story-card canvas) MUST be lazy and therefore excluded from the
// initial budget — they load on demand, never on the critical path.
export const BUNDLE_BUDGET_KB = {
  /** JS executed to render+interact with the first route (gzipped). */
  initialJs: 200,
  /** Total initial transfer (JS + CSS + critical assets, gzipped). */
  initialTransfer: 300,
  /** Any single lazy-loaded route/feature chunk (gzipped). */
  lazyChunk: 150,
} as const;

export type TimingMetric = keyof typeof TIMING_BUDGET_MS;
export type BundleMetric = keyof typeof BUNDLE_BUDGET_KB;

/** True if a measured timing (ms) is within budget for the given metric. */
export function isWithinTimingBudget(metric: TimingMetric, valueMs: number): boolean {
  return Number.isFinite(valueMs) && valueMs >= 0 && valueMs <= TIMING_BUDGET_MS[metric];
}

/** True if a measured gzipped size (KB) is within budget for the given metric. */
export function isWithinBundleBudget(metric: BundleMetric, valueKb: number): boolean {
  return Number.isFinite(valueKb) && valueKb >= 0 && valueKb <= BUNDLE_BUDGET_KB[metric];
}

/** True if a measured layout-shift score is within the CLS budget. */
export function isWithinClsBudget(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= CLS_BUDGET;
}
