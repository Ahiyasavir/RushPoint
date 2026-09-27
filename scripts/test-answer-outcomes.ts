// Points by answer / by station code (change: answer-scored-question, D1-D3).
//
// The field example: an operator at a station hands out a code. "זעתר" earns 50, "מרווה" earns 100.
//   npx tsx scripts/test-answer-outcomes.ts
import { matchAnswerOutcome, answerOutcomesProblem } from '../packages/shared/src/answerOutcomes';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const station = {
  type: 'smart_station' as const,
  answerOutcomes: [
    { id: 'o1', label: 'זעתר', accepts: ['זעתר'], points: 50 },
    { id: 'o2', label: 'מרווה', accepts: ['מרווה'], points: 100, message: 'הקוד הטוב!' },
  ],
};

// ── The headline case ────────────────────────────────────────────────────────
{
  const a = matchAnswerOutcome(station, 'זעתר');
  check('"זעתר" earns 50', 'outcomeId' in a && a.outcomeId === 'o1' && a.points === 50, JSON.stringify(a));
  const b = matchAnswerOutcome(station, 'מרווה');
  check('"מרווה" earns 100 with its message', 'outcomeId' in b && b.points === 100 && b.message === 'הקוד הטוב!', JSON.stringify(b));
  const c = matchAnswerOutcome(station, '  זַעְתָּר  ');
  check('niqqud and padding still match "זעתר"', 'outcomeId' in c && c.outcomeId === 'o1', JSON.stringify(c));
  const d = matchAnswerOutcome(station, 'נענע');
  check('an unknown code is unmatched', 'unmatched' in d && d.unmatched === true, JSON.stringify(d));
}

// ── Text questions ───────────────────────────────────────────────────────────
{
  const quiz = { type: 'quiz' as const, answerOutcomes: [
    { id: 'x', accepts: ['Paris', 'פריז'], points: 50 },
    { id: 'y', accepts: ['Lyon'], points: 20 },
  ] };
  const m = matchAnswerOutcome(quiz, ' paris ');
  check('case folded, trimmed', 'outcomeId' in m && m.outcomeId === 'x');
  const w = matchAnswerOutcome(quiz, 'new   york');
  check('no match -> unmatched', 'unmatched' in w);
  const ws = matchAnswerOutcome({ type: 'quiz' as const, answerOutcomes: [{ id: 'n', accepts: ['new york'], points: 5 }, { id: 'm', accepts: ['x'], points: 1 }] }, 'new   york');
  check('internal whitespace collapsed', 'outcomeId' in ws && ws.outcomeId === 'n');
  const btn = matchAnswerOutcome({ type: 'quiz' as const, answerOutcomes: [{ id: 'a', label: 'כן', points: 10 }, { id: 'b', label: 'לא', points: 0 }] }, 'כן');
  check('a button outcome accepts its own label when no accepts list is given', 'outcomeId' in btn && btn.outcomeId === 'a');
}

// ── "Anything else earns N" ──────────────────────────────────────────────────
{
  const q = { type: 'quiz' as const, unmatchedPoints: 5, answerOutcomes: [{ id: 'a', accepts: ['x'], points: 50 }, { id: 'b', accepts: ['y'], points: 20 }] };
  const r = matchAnswerOutcome(q, 'something');
  check('unmatched earns unmatchedPoints when set', 'outcomeId' in r && r.outcomeId === 'unmatched' && r.points === 5, JSON.stringify(r));
  const empty = matchAnswerOutcome(q, '   ');
  check('an empty answer never earns the catch-all', 'unmatched' in empty);
}

// ── Numeric ranges ───────────────────────────────────────────────────────────
{
  const n = { type: 'numeric' as const, answerOutcomes: [
    { id: 'close', range: { min: 90, max: 110 }, points: 50 },
    { id: 'near', range: { min: 70, max: 89 }, points: 20 },
  ] };
  const at = (v: string) => { const r = matchAnswerOutcome(n, v); return 'outcomeId' in r ? r.outcomeId : 'none'; };
  check('inside the close range', at('100') === 'close');
  check('boundaries are inclusive', at('90') === 'close' && at('110') === 'close' && at('89') === 'near' && at('70') === 'near');
  check('outside every range', at('111') === 'none' && at('69') === 'none');
  check('strict parse: trailing garbage is not a number', at('100abc') === 'none' && at('') === 'none');
}

// ── Totality ─────────────────────────────────────────────────────────────────
check('no outcomes -> unmatched', 'unmatched' in matchAnswerOutcome({ type: 'quiz' }, 'x'));
check('garbage task -> unmatched, never throws', 'unmatched' in matchAnswerOutcome(null as never, 'x'));
check('garbage answer -> unmatched', 'unmatched' in matchAnswerOutcome(station, 42 as never));

// ── Validation ───────────────────────────────────────────────────────────────
const ok = (t: unknown) => answerOutcomesProblem(t as never, 'fixed_points_speed') === null;
const why = (t: unknown, preset = 'fixed_points_speed') => answerOutcomesProblem(t as never, preset as never);
check('the station example is valid', ok(station), String(why(station)));
check('no outcomes at all is fine (the feature is off)', ok({ type: 'quiz' }));
check('one outcome is refused (use a normal question)', why({ type: 'quiz', answerOutcomes: [{ id: 'a', accepts: ['x'], points: 1 }] }) === 'count');
check('more than 10 is refused', why({ type: 'quiz', answerOutcomes: Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, accepts: [`a${i}`], points: 1 })) }) === 'count');
check('negative points are refused', why({ type: 'quiz', answerOutcomes: [{ id: 'a', accepts: ['x'], points: -5 }, { id: 'b', accepts: ['y'], points: 1 }] }) === 'points');
check('NaN / fractional points are refused', why({ type: 'quiz', answerOutcomes: [{ id: 'a', accepts: ['x'], points: 2.5 }, { id: 'b', accepts: ['y'], points: 1 }] }) === 'points');
check('the same text in two outcomes is refused (which wins must never be a guess)',
  why({ type: 'quiz', answerOutcomes: [{ id: 'a', accepts: ['Paris'], points: 5 }, { id: 'b', accepts: [' paris '], points: 1 }] }) === 'overlap');
check('overlapping ranges are refused',
  why({ type: 'numeric', answerOutcomes: [{ id: 'a', range: { min: 1, max: 10 }, points: 5 }, { id: 'b', range: { min: 10, max: 20 }, points: 1 }] }) === 'overlap');
check('an outcome with nothing to match is refused', why({ type: 'quiz', answerOutcomes: [{ id: 'a', points: 5 }, { id: 'b', accepts: ['y'], points: 1 }] }) === 'empty');
check('a station with BOTH a single code and outcomes is refused',
  why({ type: 'smart_station', smart: { secretCode: 'X' }, answerOutcomes: station.answerOutcomes }) === 'exclusive');
check('a quiz with BOTH answers and outcomes is refused',
  why({ type: 'quiz', answers: ['x'], answerOutcomes: [{ id: 'a', accepts: ['y'], points: 5 }, { id: 'b', accepts: ['z'], points: 1 }] }) === 'exclusive');
check('outcomes on an unsupported mission type are refused', why({ type: 'photo', answerOutcomes: station.answerOutcomes }) === 'type');
check('time_only: points must be 0 (points do not exist there)', why(station, 'time_only') === 'timeOnly');
check('time_only: 0-point outcomes are fine', answerOutcomesProblem({ type: 'quiz', answerOutcomes: [{ id: 'a', accepts: ['x'], points: 0 }, { id: 'b', accepts: ['y'], points: 0 }] } as never, 'time_only') === null);
check('a negative catch-all is refused', why({ ...station, unmatchedPoints: -1 }) === 'points');

console.log(failures === 0 ? '\nanswer outcomes: all passed' : `\nanswer outcomes: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
