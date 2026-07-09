// Pure-logic test for survey tasks (change: survey-tasks).
// A survey has NO right answer: validateSurveyResponse only enforces shape —
// trims, rejects empty/whitespace/non-string/over-500-chars; in choice mode the
// trimmed response must exactly equal one of the offered choices; free-text mode
// accepts any non-empty trimmed string. Returns the canonical (trimmed) response
// or null when invalid.
//   npx tsx scripts/test-survey.ts
import {
  validateSurveyResponse,
  SURVEY_RESPONSE_MAX_LEN,
  SURVEY_CHOICES_MIN,
  SURVEY_CHOICES_MAX,
} from '../packages/shared/src/survey';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── constants ────────────────────────────────────────────────────────────────
check('SURVEY_RESPONSE_MAX_LEN is 500', SURVEY_RESPONSE_MAX_LEN === 500);
check('SURVEY_CHOICES_MIN is 2', SURVEY_CHOICES_MIN === 2);
check('SURVEY_CHOICES_MAX is 8', SURVEY_CHOICES_MAX === 8);

// ── free-text mode (no choices) ──────────────────────────────────────────────
check('free-text accepts arbitrary non-empty text', validateSurveyResponse('the blue door') === 'the blue door');
check('free-text trims surrounding whitespace', validateSurveyResponse('  hello  ') === 'hello');
check('free-text rejects empty string', validateSurveyResponse('') === null);
check('free-text rejects whitespace-only', validateSurveyResponse('   ') === null);
check('free-text rejects non-string (number)', validateSurveyResponse(42 as unknown) === null);
check('free-text rejects non-string (null)', validateSurveyResponse(null) === null);
check('free-text rejects non-string (undefined)', validateSurveyResponse(undefined) === null);
check('free-text rejects non-string (array)', validateSurveyResponse(['x'] as unknown) === null);
check('free-text rejects 501-char response', validateSurveyResponse('a'.repeat(501)) === null);
check('free-text accepts exactly-500-char response', validateSurveyResponse('a'.repeat(500)) === 'a'.repeat(500));
check('free-text rejects a string that trims to >500 chars only after trim? (500 core stays)',
  validateSurveyResponse('  ' + 'a'.repeat(500) + '  ') === 'a'.repeat(500));

// ── choice mode ──────────────────────────────────────────────────────────────
const CHOICES = ['Pizza', 'Falafel', 'Sushi'];
check('choice mode accepts a listed choice', validateSurveyResponse('Falafel', CHOICES) === 'Falafel');
check('choice mode accepts a listed choice post-trim', validateSurveyResponse('  Pizza ', CHOICES) === 'Pizza');
check('choice mode rejects an unlisted choice', validateSurveyResponse('Tacos', CHOICES) === null);
check('choice mode is exact (case-sensitive) — "pizza" not a choice', validateSurveyResponse('pizza', CHOICES) === null);
check('choice mode rejects empty', validateSurveyResponse('', CHOICES) === null);
check('choice mode rejects non-string', validateSurveyResponse(0 as unknown, CHOICES) === null);
check('empty choices array behaves as free-text (accepts any non-empty)',
  validateSurveyResponse('anything', []) === 'anything');

console.log(`\n${failures === 0 ? 'ALL SURVEY TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
