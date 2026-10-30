// Swiping between the setup walk's screens on a phone (Ahiya, 28.10: "scroll up and down like TikTok
// and Instagram"), beside the Next button. On a touch screen it replaces Back (30.10); Back stays for a
// mouse and for a screen reader.
//
// The screen has its own scroll, a map you drag and fields you type in, so a swipe only turns the
// page when it cannot mean anything else:
//   • it starts on nothing that scrolls or drags by itself (the caller checks the target);
//   • it is mostly vertical, long enough and not a slow drag;
//   • the screen was ALREADY at its end when the finger went down: a swipe up from the bottom goes
//     on, a swipe down from the top goes back. A swipe that scrolls the screen only scrolls it.
// Pure and total, so it is pinned by scripts/test-setup-swipe.ts without a browser.

// The first swipe teaches it (Ahiya, 30.10): from then on no hint, here or in the feed, per browser.
const SWIPED_KEY = 'rp-swiped';
export function hasSwiped(): boolean {
  try { return localStorage.getItem(SWIPED_KEY) === '1'; } catch { return false; }
}
export function markSwiped(): void {
  try { localStorage.setItem(SWIPED_KEY, '1'); } catch { /* storage off: the hint simply stays */ }
}

export interface SwipeSample {
  dx: number;
  /** Finger travel in px, positive when the finger moved UP. */
  dy: number;
  ms: number;
  atTopAtStart: boolean;
  atBottomAtStart: boolean;
}

export const SWIPE_MIN_PX = 70;
/** A drag slower than this is reading, not swiping (px per ms). */
export const SWIPE_MIN_SPEED = 0.25;

export function swipeVerdict(s: SwipeSample): 'next' | 'back' | null {
  const { dx, dy, ms } = s;
  if (![dx, dy, ms].every(Number.isFinite) || ms <= 0) return null;
  if (Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dy) < Math.abs(dx) * 1.5) return null;
  if (Math.abs(dy) / ms < SWIPE_MIN_SPEED) return null;
  if (dy > 0) return s.atBottomAtStart ? 'next' : null;
  return s.atTopAtStart ? 'back' : null;
}

/**
 * Elements a swipe never starts on: boxes that scroll their own text, and choosing. Two things are
 * deliberately NOT here, both found in the 28.10 recording: a one-line field (a drag that starts on
 * it is a swipe, only a tap focuses it, and the fields fill the bottom of a screen, exactly where a
 * thumb swipes up), and the walk's map, which is `cooperativeGestures`: one finger never moves it (it
 * scrolls the page and says "use two fingers"), and a two-finger touch is never a swipe here.
 * While a field has focus (the keyboard is up) the caller does not swipe at all.
 */
export const NO_SWIPE_SELECTOR = 'textarea, select, [contenteditable="true"], [data-no-swipe]';

/** Typing: a focused field means the keyboard is up, and a swipe then is the person scrolling. */
export function typingNow(active: Element | null): boolean {
  return !!active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
}

/** How far the screen follows a finger that drags past its end, in px (a rubber band, capped). */
export const SWIPE_PULL_MAX = 140;

/**
 * The screen's offset while a finger drags past its end (28.10): it follows the finger at half speed,
 * so the page visibly gives way before it turns, instead of sitting still and then jumping. Only in a
 * direction that can turn the page: up at the bottom when there is a next screen, down at the top
 * when there is a previous one. Negative = the screen moves up. Total: anything odd is 0.
 */
export function swipePull(s: { dx: number; dy: number; atTopAtStart: boolean; atBottomAtStart: boolean; canGoBack: boolean; canGoOn: boolean }): number {
  const { dx, dy } = s;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dy) < Math.abs(dx)) return 0;
  const band = Math.min(SWIPE_PULL_MAX, Math.abs(dy) * 0.5);
  if (dy > 0 && s.atBottomAtStart && s.canGoOn) return -band;
  if (dy < 0 && s.atTopAtStart && s.canGoBack) return band;
  return 0;
}

/**
 * When the walk lays its screens side by side (no swiping then): a desktop, or any landscape window
 * from 768 px. The `walk:` screen in tailwind.config.js is this same query.
 */
export const WALK_WIDE_QUERY = '(min-width: 1024px), (min-width: 768px) and (orientation: landscape)';
