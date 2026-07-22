// Pure-logic test for the creator-web mobile breakpoint decision
// (change: mobile-responsive-creator, task 1.1 RED → 1.2 GREEN).
//
// useIsMobile()/useMediaQuery() are React hooks and can't run headless, so the
// breakpoint DECISION is factored into pure exported helpers that this script
// covers without a live DOM:
//   - MOBILE_MEDIA_QUERY   — the canonical `(max-width: …px)` string
//   - isMobileWidth(px)    — is a given viewport width "mobile"?
//   - matchesMaxWidth(px, query) — parse a `max-width: Npx` query, width <= N?
// No emulator, no window.
//   npx tsx scripts/test-mediaquery.ts
import {
  MOBILE_MEDIA_QUERY,
  MOBILE_MAX_WIDTH_PX,
  isMobileWidth,
  matchesMaxWidth,
} from '../apps/creator-web/src/hooks/useMediaQuery';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── Breakpoint sits just below Tailwind `sm` (640px) ──────────────────────────
check('MOBILE_MAX_WIDTH_PX is 639.98', MOBILE_MAX_WIDTH_PX === 639.98);
check('MOBILE_MEDIA_QUERY targets max-width: 639.98px',
  MOBILE_MEDIA_QUERY === '(max-width: 639.98px)');

// ── isMobileWidth: true below the breakpoint, false at/above sm ───────────────
check('375px (phone) is mobile', isMobileWidth(375) === true);
check('390px (phone) is mobile', isMobileWidth(390) === true);
check('414px (large phone) is mobile', isMobileWidth(414) === true);
check('639px is mobile (just under sm)', isMobileWidth(639) === true);
check('640px is NOT mobile (Tailwind sm boundary)', isMobileWidth(640) === false);
check('768px (tablet) is NOT mobile', isMobileWidth(768) === false);
check('1024px (lg) is NOT mobile', isMobileWidth(1024) === false);
check('1280px (desktop) is NOT mobile', isMobileWidth(1280) === false);

// ── matchesMaxWidth: generic parse of a `max-width: Npx` query ────────────────
check('375 matches (max-width: 639.98px)', matchesMaxWidth(375, '(max-width: 639.98px)') === true);
check('700 does NOT match (max-width: 639.98px)', matchesMaxWidth(700, '(max-width: 639.98px)') === false);
check('500 matches (max-width: 767px)', matchesMaxWidth(500, '(max-width: 767px)') === true);
check('900 does NOT match (max-width: 767px)', matchesMaxWidth(900, '(max-width: 767px)') === false);
check('boundary: N matches (max-width: Npx)', matchesMaxWidth(640, '(max-width: 640px)') === true);

console.log(`\n${failures === 0 ? 'ALL MEDIAQUERY TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
