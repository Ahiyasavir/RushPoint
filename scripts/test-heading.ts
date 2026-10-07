// Issue 54 (Ahiya, 7.10): "a walking direction like Google Maps": the blue beam on the player's dot
// that points where they are facing. Pure decisions in apps/play-web/src/lib/heading.ts:
// which way is the phone facing (compass), which way are they walking (GPS course), which wins,
// and how the beam turns. Every function is total: bad input is "no heading", never a throw.
//   npx tsx scripts/test-heading.ts
import { readFileSync } from 'node:fs';
import {
  normalizeDeg, compassHeadingFromEvent, gpsCourse, pickHeading, smoothHeading, beamRotation,
  COMPASS_FRESH_MS, MIN_WALK_SPEED_MPS,
} from '../apps/play-web/src/lib/heading';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 0.001;

// normalizeDeg
check('normalize 370 → 10', near(normalizeDeg(370), 10));
check('normalize -90 → 270', near(normalizeDeg(-90), 270));
check('normalize 360 → 0', near(normalizeDeg(360), 0));

// Compass: iOS gives webkitCompassHeading (clockwise from north, already a heading).
check('iOS webkitCompassHeading 90 → 90 (east)', near(compassHeadingFromEvent({ webkitCompassHeading: 90 }, 0), 90));
check('iOS heading corrected for a landscape screen (+90)', near(compassHeadingFromEvent({ webkitCompassHeading: 10 }, 90), 100));
// Android: deviceorientationabsolute alpha is counter-clockwise from north.
check('Android absolute alpha 0 → north', near(compassHeadingFromEvent({ alpha: 0, absolute: true }, 0), 0));
check('Android absolute alpha 90 → 270 (west)', near(compassHeadingFromEvent({ alpha: 90, absolute: true }, 0), 270));
check('a RELATIVE alpha is not a compass → null', compassHeadingFromEvent({ alpha: 90, absolute: false }, 0) === null);
check('missing values → null', compassHeadingFromEvent({}, 0) === null);
check('NaN → null', compassHeadingFromEvent({ alpha: NaN, absolute: true }, 0) === null);
check('null event → null, no throw', compassHeadingFromEvent(null as never, 0) === null);

// GPS course: only while really walking.
check('walking east at 1.4 m/s → 90', near(gpsCourse({ heading: 90, speed: 1.4 }), 90));
check('standing still → null (the course of a still phone is noise)', gpsCourse({ heading: 90, speed: 0.1 }) === null);
check('no speed reported → null', gpsCourse({ heading: 90, speed: null }) === null);
check('heading NaN (browsers send it while still) → null', gpsCourse({ heading: NaN, speed: 2 }) === null);
check('walk threshold is a slow walk', MIN_WALK_SPEED_MPS > 0.3 && MIN_WALK_SPEED_MPS <= 1);

// Which wins: a fresh compass (where you FACE), else the walking course, else nothing.
const now = 100_000;
check('fresh compass wins over the walking course',
  near(pickHeading({ compass: 10, compassAtMs: now - 500, course: 200, nowMs: now }), 10));
check('stale compass → the walking course',
  near(pickHeading({ compass: 10, compassAtMs: now - COMPASS_FRESH_MS - 1, course: 200, nowMs: now }), 200));
check('nothing fresh → null (no beam rather than a wrong one)',
  pickHeading({ compass: null, compassAtMs: 0, course: null, nowMs: now }) === null);

// Smoothing takes the SHORT way round north.
check('smooth 350 → 10 passes through 0, not 180', (() => { const v = smoothHeading(350, 10, 0.5); return v != null && (v > 355 || v < 5); })());
check('smooth from nothing → the new value', near(smoothHeading(null, 42, 0.3), 42));
check('smooth to nothing → nothing', smoothHeading(42, null, 0.3) === null);

// The beam turns against a rotated map.
check('heading 90 on a north-up map → 90', near(beamRotation(90, 0), 90));
check('heading 90 on a map rotated 30 → 60', near(beamRotation(90, 30), 60));

// Wiring: the player's map draws the beam, and the screen feeds it.
const nav = readFileSync(new URL('../apps/play-web/src/components/NavMap.tsx', import.meta.url), 'utf8');
check('NavMap takes a heading prop', /heading\?: number \| null/.test(nav));
check('NavMap draws a beam on the player\'s dot', /data-heading-beam/.test(nav) && /beamRotation\(/.test(nav));
const play = readFileSync(new URL('../apps/play-web/src/screens/PlayScreen.tsx', import.meta.url), 'utf8');
check('PlayScreen passes a heading to NavMap', /<NavMap[^>]*heading=\{/.test(play));
check('PlayScreen keeps the GPS course from its ONE watch', /gpsCourse\(/.test(play));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-heading)`);
process.exit(failures === 0 ? 0 : 1);
