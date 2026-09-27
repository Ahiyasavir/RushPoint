// Pure-logic tests — keeping a popover inside the viewport
// (change: popover-stays-on-screen).
//
// THE MEASURED DEFECT. The Builder's launch-readiness popover mounts, on a phone,
// against a ZERO-WIDTH slot (the component's own comment says so), and `end-0` then
// places it relative to whatever x that slot happened to land on. Probed in a real
// browser at 375x812 RTL:
//
//   anchor slot   left 204, width 0
//   panel         left 204 -> right 555, width 351
//   viewport      375        =>  180px off screen, 49% visible
//   scrollWidth   375        =>  the overflow is CLIPPED, not scrollable
//   max-width     351px      =>  the cap APPLIED and changed nothing
//
// That last line is the whole lesson: `max-width` bounds how WIDE a box is, never
// WHERE it sits. And because the document is RTL, the half that fell off the screen
// is the half every Hebrew line BEGINS on, so the organizer saw the tail of each
// sentence and could not read why their game would not launch.
//
// So the placement is computed in MEASURED PIXELS, not in logical CSS properties:
// RTL and LTR then differ only in which edge is preferred, and the clamp is the same
// arithmetic either way.
//
// TOTAL BY REQUIREMENT. A layout-effect measurement legitimately runs before layout
// settles, so this is called with zeros and occasionally NaN. Returning NaN would set
// `left: NaN`, remove the element from the page, and reproduce the original bug with
// new code — so every degenerate input resolves to something drawable, on screen.
import { popoverPlacement, POPOVER_GUTTER_PX } from '../apps/creator-web/src/lib/popoverPlacement';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}
const G = POPOVER_GUTTER_PX;

/** Is this placement fully inside the viewport, gutters included? */
function inside(p: { left: number; width: number }, viewportWidth: number): boolean {
  return Number.isFinite(p.left) && Number.isFinite(p.width)
    && p.width >= 0
    && p.left >= -0.001
    && p.left + p.width <= viewportWidth + 0.001;
}

console.log('\npopover-placement — the popover stays on screen');

// ── 1. The exact case measured in production ─────────────────────────────────
{
  const p = popoverPlacement({
    anchorLeft: 204, anchorWidth: 0, preferredWidth: 351, viewportWidth: 375, rtl: true,
  });
  ok(`the measured 375px phone case lands on screen :: ${JSON.stringify(p)}`,
    inside(p, 375));
  ok('and it respects the gutter on the right', p.left + p.width <= 375 - G + 0.001,
    String(p.left + p.width));
  ok('and it respects the gutter on the left', p.left >= G - 0.001, String(p.left));
  ok('the placement reports that it was clamped', p.clamped === true);
  // Before the fix the box ran to 555 on a 375px viewport. Anything at all is an
  // improvement, so assert the SPECIFIC property that failed, not merely "different".
  ok('the right edge no longer runs off the viewport', p.left + p.width <= 375,
    String(p.left + p.width));
}

// ── 2. A placement that already fits is NOT moved ────────────────────────────
// The identity case matters as much as the clamp: at desktop widths the popover
// renders correctly today and this change must not move it.
{
  const p = popoverPlacement({
    anchorLeft: 900, anchorWidth: 120, preferredWidth: 351, viewportWidth: 1440, rtl: true,
  });
  eq('a roomy viewport keeps the preferred width', p.width, 351);
  eq('and does not report a clamp', p.clamped, false);
  ok('and the box is on screen', inside(p, 1440));
  // RTL prefers the anchor's logical end, which is its LEFT edge in pixels.
  eq('RTL anchors the popover at the anchor left edge', p.left, 900);

  // LTR grows LEFTWARD from the anchor's right edge, so the identity case needs an
  // anchor with 351px of room to its left. At anchorLeft 200 the preferred position
  // is 200 + 120 - 351 = -31, which is off screen — that is a CLAMP case, asserted
  // separately below, and using it here would have tested the wrong property.
  const ltr = popoverPlacement({
    anchorLeft: 800, anchorWidth: 120, preferredWidth: 351, viewportWidth: 1440, rtl: false,
  });
  eq('LTR anchors the popover at the anchor right edge, growing leftward',
    ltr.left, 800 + 120 - 351);
  ok('and the LTR box is on screen', inside(ltr, 1440));
  eq('LTR with room to its left is also unclamped', ltr.clamped, false);

  // The mirror of the reported defect: an LTR anchor too close to the left edge.
  const ltrTight = popoverPlacement({
    anchorLeft: 200, anchorWidth: 120, preferredWidth: 351, viewportWidth: 1440, rtl: false,
  });
  eq('an LTR popover that would start off the left edge is pulled back to the gutter',
    ltrTight.left, G);
  eq('and it reports the clamp', ltrTight.clamped, true);
  ok('and it is on screen', inside(ltrTight, 1440));
}

// ── 3. Both edges, both directions, across real device widths ────────────────
{
  const widths = [320, 375, 414, 768, 1024, 1440];
  let checked = 0;
  let violations = 0;
  for (const vw of widths) {
    for (const rtl of [true, false]) {
      // An anchor hard against each edge, and a zero-width one at each edge.
      for (const [anchorLeft, anchorWidth] of [
        [0, 0], [0, 100], [vw - 1, 0], [vw - 100, 100], [Math.round(vw / 2), 0],
      ] as [number, number][]) {
        const p = popoverPlacement({ anchorLeft, anchorWidth, preferredWidth: 351, viewportWidth: vw, rtl });
        checked++;
        if (!inside(p, vw)) violations++;
      }
    }
  }
  ok(`every edge case across ${widths.length} widths stays on screen :: ${checked} checked`,
    violations === 0, `${violations} violation(s)`);
}

// ── 4. Narrow before you overflow ────────────────────────────────────────────
{
  const p = popoverPlacement({
    anchorLeft: 0, anchorWidth: 0, preferredWidth: 351, viewportWidth: 300, rtl: true,
  });
  eq('a viewport narrower than the preferred width narrows the popover',
    p.width, 300 - 2 * G);
  ok('and it still sits between the gutters', inside(p, 300) && p.left >= G - 0.001);
  eq('and it reports the clamp', p.clamped, true);
  // A 276px panel that can be read beats a 351px panel that cannot.
  ok('the narrowed width is positive and usable', p.width > 0, String(p.width));
}

// ── 5. Degenerate viewports are still drawable ───────────────────────────────
{
  for (const vw of [2 * G, 2 * G - 1, 10, 1, 0]) {
    const p = popoverPlacement({
      anchorLeft: 0, anchorWidth: 0, preferredWidth: 351, viewportWidth: vw, rtl: true,
    });
    ok(`a ${vw}px viewport yields a non-negative width :: ${JSON.stringify(p)}`,
      Number.isFinite(p.width) && p.width >= 0 && Number.isFinite(p.left));
    ok(`a ${vw}px viewport never places the box off the left edge`, p.left >= -0.001);
  }
}

// ── 6. Totality — NaN here would delete the element from the page ────────────
{
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -50];
  let checked = 0;
  let violations = 0;
  for (const v of bad) {
    for (const key of ['anchorLeft', 'anchorWidth', 'preferredWidth', 'viewportWidth'] as const) {
      const input = {
        anchorLeft: 204, anchorWidth: 0, preferredWidth: 351, viewportWidth: 375, rtl: true,
        [key]: v,
      };
      let threw = false;
      let p: { left: number; width: number; clamped: boolean } | null = null;
      try { p = popoverPlacement(input); } catch { threw = true; }
      checked++;
      if (threw || !p || !Number.isFinite(p.left) || !Number.isFinite(p.width) || p.width < 0) {
        violations++;
        console.error(`    ${key}=${String(v)} -> ${threw ? 'THREW' : JSON.stringify(p)}`);
      }
    }
  }
  ok(`no degenerate input yields NaN or a throw :: ${checked} combinations`,
    violations === 0, `${violations} violation(s)`);

  for (const b of [null, undefined, 42, 'x', []]) {
    let threw = false;
    let p: { left: number; width: number } | null = null;
    try { p = popoverPlacement(b as never); } catch { threw = true; }
    ok(`a ${String(typeof b)} input does not throw and is drawable`,
      !threw && !!p && Number.isFinite(p.left) && Number.isFinite(p.width) && p.width >= 0,
      JSON.stringify(p));
  }
}

// ── 7. The invariant, swept ──────────────────────────────────────────────────
{
  let seed = 0x1f2e3d4c;
  const rnd = (n: number): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const SWEEPS = 6000;
  let violations = 0;
  let clamped = 0;
  let untouched = 0;
  for (let i = 0; i < SWEEPS; i++) {
    const viewportWidth = 240 + rnd(1400);
    const anchorLeft = rnd(viewportWidth + 200) - 100;
    const anchorWidth = rnd(300);
    const preferredWidth = 40 + rnd(600);
    const rtl = rnd(2) === 0;
    const p = popoverPlacement({ anchorLeft, anchorWidth, preferredWidth, viewportWidth, rtl });
    if (!inside(p, viewportWidth)) { violations++; continue; }
    // The gutter holds whenever the viewport is wide enough to have one.
    if (viewportWidth > 2 * G) {
      if (p.left < G - 0.001) violations++;
      else if (p.left + p.width > viewportWidth - G + 0.001) violations++;
    }
    if (p.clamped) clamped++; else untouched++;
  }
  ok(`every placement stays between the gutters :: ${SWEEPS} sweeps`,
    violations === 0, `${violations} violation(s)`);
  ok(`the sweep exercised both paths :: ${clamped} clamped, ${untouched} untouched`,
    clamped > 100 && untouched > 100);
}

// ── 8. The gutter itself ─────────────────────────────────────────────────────
{
  ok(`the gutter is a positive finite number of px :: ${G}`,
    typeof G === 'number' && Number.isFinite(G) && G > 0);
  const p = popoverPlacement({
    anchorLeft: 0, anchorWidth: 0, preferredWidth: 100, viewportWidth: 1000, rtl: true, gutter: 40,
  });
  eq('an explicit gutter overrides the default', p.left, 40);
}

console.log('');
if (failures > 0) {
  console.error(`✗ popover-placement: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ popover-placement: all assertions passed');
