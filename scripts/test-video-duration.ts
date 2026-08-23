// Pure-logic test for the video-mission duration contract (change: video-submission-task).
//
// TWO functions, deliberately different in temperament:
//   resolveVideoDuration  — participant HOT PATH. Total, clamping, never throws.
//     A stored value that is inverted, out of range or outright garbage must still
//     yield a recorder the player can use; failing closed here would strand a
//     blameless participant mid-mission (same rule as stuckGuards / safeZone).
//   videoDurationProblem  — AUTHORING verdict. Strict. Read by the Builder's inline
//     validation and by updateGame/importGameFile, so a bad range is refused where
//     the creator can still fix it, not silently coerced.
//   npx tsx scripts/test-video-duration.ts
import {
  VIDEO_DURATION_LIMITS,
  resolveVideoDuration,
  videoDurationProblem,
} from '../packages/shared/src/videoDuration';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const L = VIDEO_DURATION_LIMITS;

// ─── The platform range itself is PINNED ──────────────────────────────────────
// The ceiling is load-bearing: MAX_PARTICIPANT_VIDEO_BYTES in functions/uploadRoute.js
// is sized for the worst clip the platform ALLOWS, which is a ceiling-length one —
// not for the default max. Raising this without re-sizing that cap ships an upload
// path that refuses legitimately-authored missions.
check('floor is 5s', L.floorSeconds === 5);
check('ceiling is 60s', L.ceilingSeconds === 60);
check('default min is 0 (no minimum)', L.defaultMinSeconds === 0);
check('default max is 40s', L.defaultMaxSeconds === 40);
check('minimum spread is 5s', L.minSpreadSeconds === 5);

// ─── resolveVideoDuration: defaults ───────────────────────────────────────────
const d = resolveVideoDuration(undefined);
check('absent smart config → platform defaults', d.minSeconds === 0 && d.maxSeconds === 40);
const d2 = resolveVideoDuration({});
check('empty smart config → platform defaults', d2.minSeconds === 0 && d2.maxSeconds === 40);
const d3 = resolveVideoDuration({ videoMinSeconds: 10, videoMaxSeconds: 30 });
check('a valid authored pair passes through', d3.minSeconds === 10 && d3.maxSeconds === 30);
const d4 = resolveVideoDuration({ videoMaxSeconds: 20 });
check('max alone → min defaults to 0', d4.minSeconds === 0 && d4.maxSeconds === 20);
const d5 = resolveVideoDuration({ videoMinSeconds: 15 });
check('min alone → max defaults to 40', d5.minSeconds === 15 && d5.maxSeconds === 40);

// ─── resolveVideoDuration: clamping ───────────────────────────────────────────
check('over-ceiling max clamps down', resolveVideoDuration({ videoMaxSeconds: 600 }).maxSeconds === 60);
check('below-floor max clamps up', resolveVideoDuration({ videoMaxSeconds: 2 }).maxSeconds === 5);
check(
  'a nonzero below-floor min clamps up to the floor',
  resolveVideoDuration({ videoMinSeconds: 1, videoMaxSeconds: 40 }).minSeconds === 5,
);
check(
  'min 0 stays 0 (0 means "no minimum", not "below the floor")',
  resolveVideoDuration({ videoMinSeconds: 0, videoMaxSeconds: 40 }).minSeconds === 0,
);
check(
  'over-ceiling min clamps into range',
  resolveVideoDuration({ videoMinSeconds: 900, videoMaxSeconds: 60 }).minSeconds <= 60,
);

// ─── resolveVideoDuration: inverted + garbage must NOT throw ──────────────────
// An inverted pair resolves by DROPPING the minimum, never by lowering the max: a
// player can always satisfy "no minimum", but a minimum they cannot reach makes the
// submit button permanently dead with nothing they can do about it.
const inv = resolveVideoDuration({ videoMinSeconds: 50, videoMaxSeconds: 10 });
check('inverted pair does not throw and stays in range', inv.minSeconds < inv.maxSeconds);
check('inverted pair drops the minimum rather than the max', inv.minSeconds === 0 && inv.maxSeconds === 10);
const eq = resolveVideoDuration({ videoMinSeconds: 20, videoMaxSeconds: 20 });
check('min === max drops the minimum', eq.minSeconds === 0 && eq.maxSeconds === 20);

for (const junk of [NaN, Infinity, -Infinity, -10, '30' as unknown as number, null as unknown as number]) {
  const r = resolveVideoDuration({ videoMinSeconds: junk, videoMaxSeconds: junk });
  const ok = Number.isFinite(r.minSeconds) && Number.isFinite(r.maxSeconds)
    && r.minSeconds >= 0 && r.maxSeconds >= L.floorSeconds && r.maxSeconds <= L.ceilingSeconds
    && r.minSeconds < r.maxSeconds;
  check(`garbage input (${String(junk)}) resolves to a usable range`, ok, JSON.stringify(r));
}
let threw = false;
try {
  resolveVideoDuration(null as unknown as undefined);
  resolveVideoDuration('nope' as unknown as undefined);
  resolveVideoDuration({ videoMinSeconds: {} as unknown as number });
} catch {
  threw = true;
}
check('resolveVideoDuration never throws on hostile input', threw === false);

// ─── videoDurationProblem: the strict authoring verdict ───────────────────────
check('both absent → no problem', videoDurationProblem(undefined, undefined) === null);
check('a valid pair → no problem', videoDurationProblem(10, 30) === null);
check('min 0 + valid max → no problem', videoDurationProblem(0, 40) === null);
check('max alone within range → no problem', videoDurationProblem(undefined, 25) === null);
check('min alone with default max → no problem', videoDurationProblem(10, undefined) === null);

check('min === max is a problem', videoDurationProblem(20, 20) !== null);
check('min > max is a problem', videoDurationProblem(30, 20) !== null);
check('max above the ceiling is a problem', videoDurationProblem(0, 61) !== null);
check('max below the floor is a problem', videoDurationProblem(0, 4) !== null);
check('a nonzero min below the floor is a problem', videoDurationProblem(3, 40) !== null);
check('min above the ceiling is a problem', videoDurationProblem(90, 40) !== null);
check('insufficient spread is a problem', videoDurationProblem(37, 40) !== null);
check('a spread exactly at the minimum is fine', videoDurationProblem(35, 40) === null);

for (const junk of [NaN, Infinity, -1, '20' as unknown as number, {} as unknown as number]) {
  check(`non-finite min (${String(junk)}) is a problem`, videoDurationProblem(junk, 40) !== null);
  check(`non-finite max (${String(junk)}) is a problem`, videoDurationProblem(0, junk) !== null);
}
check('null clears rather than corrupts (treated as absent)', videoDurationProblem(null as unknown as undefined, null as unknown as undefined) === null);

const msg = videoDurationProblem(30, 20);
check('the problem message names the offending values', typeof msg === 'string' && msg.includes('30') && msg.includes('20'), String(msg));

console.log(`\n${failures === 0 ? 'ALL VIDEO-DURATION TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
