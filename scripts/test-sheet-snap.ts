// Pure-logic tests for the mission sheet's snap points (change: play-screen-no-scroll).
//
// Field report 2026-09-27: "the player interface scrolls, I don't like it at all, design it so there
// is no scrolling at all". The answer every map app uses (Google Maps, Uber): a full-screen map with a
// sheet at a peek, a middle and a full height. The PAGE never scrolls; only a fully open sheet's
// content may scroll inside itself.
import { snapHeights, nextSnap, fitSnap, boxSnapHeights, type SnapPoint } from '../apps/play-web/src/lib/sheetSnap';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${a}\n      want ${e}`);
}

console.log('\n— heights for real phones —');
for (const h of [640, 667, 740, 844]) {
  const s = snapHeights(h, 56);
  eq(`${h}px: peek < half < full`, s.peek < s.half && s.half < s.full, true);
  eq(`${h}px: full leaves the header visible`, s.full, h - 56 - 12);
  eq(`${h}px: half is half the screen`, s.half, Math.round(h / 2));
}
eq('peek is 132 on a normal phone', snapHeights(844, 56).peek, 132);
{
  const land = snapHeights(360, 56); // a phone held sideways
  eq('landscape: peek clamps to 40% of the height', land.peek <= Math.round(360 * 0.4), true);
  eq('landscape: still ordered', land.peek < land.half && land.half < land.full, true);
}
eq('junk height ⇒ a sane default, never NaN', Number.isFinite(snapHeights(Number.NaN, 56).full), true);

console.log('\n— where a drag lands —');
const H = snapHeights(844, 56);
const land = (from: SnapPoint, dy: number, v = 0) => nextSnap(from, dy, v, H);
eq('no movement stays', land('half', 0), 'half');
eq('a small drag up from half stays at half', land('half', -30), 'half');
eq('a long drag up from half opens full', land('half', -300), 'full');
eq('a long drag down from half goes to peek', land('half', 250), 'peek');
eq('a fast flick up moves one step', land('peek', -10, -0.8), 'half');
eq('a fast flick down moves one step', land('full', 10, 0.8), 'half');
eq('never below peek', land('peek', 900, 2), 'peek');
eq('never above full', land('full', -900, -2), 'full');
eq('junk input ⇒ unchanged', nextSnap('half', Number.NaN, Number.NaN, H), 'half');

console.log('');
console.log('\n— fitSnap: a new mission opens tall enough to show its action (overnight 2026-09-29) —');
// Played on 375x667 and 390x844: at "half" the photo mission's "צלמו תמונה" sat below the sheet's
// visible area (content 584px, room 305px). The player saw the text but not what to press.
{
  const h = snapHeights(667, 56);
  eq('content that fits the half sheet opens at half', fitSnap(200, h), 'half');
  eq('content taller than the half sheet opens full', fitSnap(584, h), 'full');
  eq('content taller than full still opens full (it scrolls inside)', fitSnap(5000, h), 'full');
  eq('an unmeasured sheet (0 / junk) keeps the default half', [fitSnap(0, h), fitSnap(Number.NaN, h), fitSnap(-3, h)], ['half', 'half', 'half']);
  // A sealed "walk to the point" mission: the MAP is the instruction (flag, arrow, distance) and the
  // arrival is detected by itself, so it stays at half even when its card is long.
  eq('a map-first mission stays at half however long its card', fitSnap(584, h, { mapFirst: true }), 'half');
}

console.log('\n— boxSnapHeights: never taller than the sheet own container (overnight 2026-09-29) —');
// Played on 375x667: the container is 525px (y=118..643), and "full" measured from the window was
// 599px, so the sheet covered the header's SOS button.
{
  const b = boxSnapHeights(525)!;
  eq('full fits inside the container', b.full <= 525, true);
  eq('half < full, peek < half', b.peek < b.half && b.half < b.full, true);
  const tiny = boxSnapHeights(150)!;
  eq('a tiny container still keeps every height inside it', tiny.full <= 150 && tiny.half <= 150 && tiny.peek <= tiny.half, true);
  eq('an unmeasured container is unknown (null), never a guess', [boxSnapHeights(0), boxSnapHeights(Number.NaN)], [null, null]);
}

if (failures > 0) {
  console.error(`✗ sheet-snap: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ sheet-snap: all assertions passed\n');
