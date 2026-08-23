import { useEffect, useState } from 'react';

// ── Pure, DOM-free breakpoint logic (unit-tested by scripts/test-mediaquery.ts) ──
//
// "Mobile" means below the Tailwind `sm` breakpoint (640px). We target 639.98px
// (not 639px) so the JS hook flips at the exact same sub-pixel boundary Tailwind's
// own `max-*` variants use — a viewport of 639.5px is still mobile to both.

/** Upper bound (inclusive) of the "mobile" viewport range, in CSS px. */
export const MOBILE_MAX_WIDTH_PX = 639.98;

/** Canonical media query for the mobile range. Single source of truth. */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/**
 * Does a viewport `width` satisfy a `(max-width: Npx)` query? Pure so the
 * decision is testable without a live `window`/`matchMedia`. Falls back to a
 * plain numeric compare and returns `false` for a query it can't parse.
 */
export function matchesMaxWidth(width: number, query: string): boolean {
  const m = /max-width:\s*([\d.]+)px/.exec(query);
  if (!m) return false;
  return width <= parseFloat(m[1]);
}

/** Is a given viewport width in the mobile range? */
export function isMobileWidth(width: number): boolean {
  return width <= MOBILE_MAX_WIDTH_PX;
}

// ── React hooks ───────────────────────────────────────────────────────────────

/**
 * Subscribe to a CSS media query. SSR-safe: returns `false` when there is no
 * `window` (server / non-DOM). Re-renders when the query starts/stops matching,
 * which also covers orientation changes (they change the reported width).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // sync in case the query changed between render and effect
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True when the viewport is phone-class (below the Tailwind `sm` breakpoint). */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
