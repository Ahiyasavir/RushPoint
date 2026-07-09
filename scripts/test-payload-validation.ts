// Unit test for the smart-station callable payload validators. No test runner is
// configured, so this is a plain tsx assertion script (matches the repo's
// test-geo-validation.ts / test-tiebreaker.ts style).
// Run: npx tsx scripts/test-payload-validation.ts
import {
  ValidationError,
  requireString,
  optionalString,
  optionalNonNegativeNumber,
  optionalBoolean,
  optionalEnum,
  optionalCoordinatePair,
  MAX_CODE_LEN,
  MAX_NOTE_LEN,
} from '../packages/shared/src/validation';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Run `fn`, return the thrown ValidationError (or undefined if it didn't throw).
function rejects(fn: () => unknown): ValidationError | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof ValidationError ? e : (e as ValidationError);
  }
}

// ── requireString ─────────────────────────────────────────────────────────────
check('requireString returns the trimmed value', requireString('  abc ', 'taskId') === 'abc');
{
  const e = rejects(() => requireString(undefined, 'taskId'));
  check('missing required field rejected', e instanceof ValidationError);
  check('  carries field name', e?.field === 'taskId');
  check('  has EN + HE messages', !!e?.message && !!e?.messageHe);
}
check('empty string rejected', rejects(() => requireString('   ', 'code')) instanceof ValidationError);
check('non-string (number) rejected', rejects(() => requireString(123, 'code')) instanceof ValidationError);
check('null rejected', rejects(() => requireString(null, 'taskId')) instanceof ValidationError);
{
  const oversized = 'x'.repeat(MAX_CODE_LEN + 1);
  const e = rejects(() => requireString(oversized, 'code', MAX_CODE_LEN));
  check('oversized string rejected', e instanceof ValidationError);
  check('  constraint names the max length', !!e && e.constraint.includes(String(MAX_CODE_LEN)));
}
check('string at the size limit accepted', requireString('x'.repeat(MAX_CODE_LEN), 'code', MAX_CODE_LEN).length === MAX_CODE_LEN);

// ── optionalString ────────────────────────────────────────────────────────────
check('optionalString absent → undefined', optionalString(undefined, 'note', MAX_NOTE_LEN) === undefined);
check('optionalString empty → undefined', optionalString('   ', 'note', MAX_NOTE_LEN) === undefined);
check('optionalString trims', optionalString('  hi ', 'note', MAX_NOTE_LEN) === 'hi');
check('optionalString oversized rejected', rejects(() => optionalString('x'.repeat(MAX_NOTE_LEN + 1), 'note', MAX_NOTE_LEN)) instanceof ValidationError);

// ── optionalNonNegativeNumber ─────────────────────────────────────────────────
check('non-negative number accepted', optionalNonNegativeNumber(3, 'missingMembers') === 3);
check('zero accepted', optionalNonNegativeNumber(0, 'missingMembers') === 0);
check('absent → undefined', optionalNonNegativeNumber(undefined, 'missingMembers') === undefined);
check('negative number rejected', rejects(() => optionalNonNegativeNumber(-1, 'missingMembers')) instanceof ValidationError);
check('NaN rejected', rejects(() => optionalNonNegativeNumber(NaN, 'missingMembers')) instanceof ValidationError);
check('Infinity rejected', rejects(() => optionalNonNegativeNumber(Infinity, 'missingMembers')) instanceof ValidationError);
check('numeric string rejected', rejects(() => optionalNonNegativeNumber('5', 'missingMembers')) instanceof ValidationError);

// ── optionalBoolean ───────────────────────────────────────────────────────────
check('boolean accepted', optionalBoolean(false, 'passed') === false);
check('boolean absent → undefined', optionalBoolean(undefined, 'passed') === undefined);
check('non-boolean rejected', rejects(() => optionalBoolean('yes', 'passed')) instanceof ValidationError);

// ── optionalEnum ──────────────────────────────────────────────────────────────
const OUTCOMES = ['passed', 'failed', 'left'] as const;
check('valid enum value accepted', optionalEnum('failed', 'outcome', OUTCOMES) === 'failed');
check('enum absent → undefined', optionalEnum(undefined, 'outcome', OUTCOMES) === undefined);
{
  const e = rejects(() => optionalEnum('exploded', 'outcome', OUTCOMES));
  check('invalid enum value rejected', e instanceof ValidationError);
  check('  message lists the allowed values', !!e && e.message.includes('passed'));
}

// ── optionalCoordinatePair ────────────────────────────────────────────────────
check('both coords absent → {}', Object.keys(optionalCoordinatePair(undefined, undefined)).length === 0);
{
  const r = optionalCoordinatePair(31.79, 35.16);
  check('valid coord pair returned', r.lat === 31.79 && r.lng === 35.16);
}
check('half a pair rejected (lat only)', rejects(() => optionalCoordinatePair(31.79, undefined)) instanceof ValidationError);
check('half a pair rejected (lng only)', rejects(() => optionalCoordinatePair(undefined, 35.16)) instanceof ValidationError);
check('NaN coords rejected', rejects(() => optionalCoordinatePair(NaN, 35.16)) instanceof ValidationError);
check('out-of-range coords rejected', rejects(() => optionalCoordinatePair(200, 999)) instanceof ValidationError);
check('string coords rejected', rejects(() => optionalCoordinatePair('31', '35')) instanceof ValidationError);

// ── toResult() wraps as { success:false, error:{...} } ────────────────────────
{
  const e = rejects(() => requireString(undefined, 'taskId'))!;
  const res = e.toResult();
  check('toResult is { success:false }', res.success === false);
  check('  error has field/constraint/message/messageHe',
    res.error.field === 'taskId' && !!res.error.constraint && !!res.error.message && !!res.error.messageHe);
}

console.log(`\n${failures === 0 ? 'ALL PAYLOAD-VALIDATION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
