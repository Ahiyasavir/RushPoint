// Pure-logic test for the wizard's description blend (change: guided-new-game-wizard).
//
// The product owner asked for "a mix" — explicitly NOT the template's authored
// description with the creator's answers appended after it, and explicitly not a
// replacement that throws the authored text away. Both templates are written well,
// and both open with a claim the wizard can now contradict:
//
//   "משחק שדה מלא אנרגיה לקבוצות בגילאי 11-13: גיבוש, חידות מיקום, ..."
//
// If a creator says their players are 14-17, keeping that opening verbatim ships a
// description that is simply wrong. So the blend replaces the template's OPENING
// CLAUSE — the part that makes the audience claim — with one built from the
// answers, and keeps everything after it, which is where the template actually
// describes what the game contains.
//
// Everything user-facing comes from the caller's copy object, so this module holds
// no Hebrew or English of its own and the i18n gate stays meaningful.
//
//   npx tsx scripts/test-describe-new-game.ts
import {
  MAX_BLENDED_DESCRIPTION_LEN,
  blendGameDescription,
  derivedGameTags,
  type NewGameDescriptionCopy,
} from '../apps/creator-web/src/lib/describeNewGame';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// A stand-in for what the component builds out of `t.*`. Deliberately distinctive
// strings so an assertion can tell blended output from passthrough.
const copy: NewGameDescriptionCopy = {
  lead: ({ people, minutes, ageLabel }) => `LEAD ${people} players ${minutes}min ${ageLabel}`,
  ageLabel: (bandId) => `AGE(${bandId})`,
  ageTag: (bandId) => `tagage-${bandId}`,
  durationTag: (minutes) => `tagdur-${minutes}`,
};

const answers = { people: 24, minutes: 90, ageBandId: '14-17' };

// The real missions template's description, verbatim.
const MISSIONS_DESC = 'משחק שדה מלא אנרגיה לקבוצות בגילאי 11-13: גיבוש, חידות מיקום, אתגרי חשיבה ומשימות ערכיות. תבנית מוכנה למילוי עם המיקומים שלכם.';
// The real story template's description, verbatim.
const STORY_DESC = 'עלילת ריגול לקבוצות בגילאי 14-18: "פרוטוקול האפלה". יחידה סודית, ארכיון נעלם, שעון עצר שהסוף שלו מפתיע. תבנית מוכנה למילוי עם המיקומים שלכם.';

// ── The blend ────────────────────────────────────────────────────────────────
console.log('\n── blendGameDescription ──');

const blended = blendGameDescription(MISSIONS_DESC, answers, copy);

// The whole point of asking the questions.
const firstSentence = blended.split(/[.:]/)[0] ?? '';
check('an answer-derived value appears in the OPENING sentence',
  firstSentence.includes('24') || firstSentence.includes('90') || firstSentence.includes('AGE('),
  firstSentence);

// "A mix", not an append: the authored text must not survive as an untouched prefix.
check('the template description is not an unmodified prefix',
  !blended.startsWith(MISSIONS_DESC), blended);

// ...and not a replacement either — the authored detail is what makes it good copy.
check('the template detail survives the blend',
  blended.includes('חידות מיקום') && blended.includes('אתגרי חשיבה'), blended);

// The stale audience claim is exactly what the answers are there to correct.
check('the template stale age claim is dropped',
  !blended.includes('בגילאי 11-13'), blended);

check('one paragraph, no blank-line breaks', !/\n\s*\n/.test(blended), JSON.stringify(blended));
check('no raw newlines at all', !blended.includes('\n'), JSON.stringify(blended));

check('deterministic',
  blendGameDescription(MISSIONS_DESC, answers, copy) === blendGameDescription(MISSIONS_DESC, answers, copy));

check('bounded length', blended.length <= MAX_BLENDED_DESCRIPTION_LEN, String(blended.length));

// The story template has the same shape and must blend the same way.
{
  const s = blendGameDescription(STORY_DESC, answers, copy);
  check('the story template keeps its hook',
    s.includes('פרוטוקול האפלה'), s);
  check('the story template loses its stale age claim',
    !s.includes('בגילאי 14-18'), s);
  check('the story template is not an unmodified prefix', !s.startsWith(STORY_DESC), s);
}

// A template whose description has no leading claim to replace: nothing may be lost.
{
  const plain = 'A simple description with no colon at all';
  const out = blendGameDescription(plain, answers, copy);
  check('a description with no leading clause is kept whole', out.includes(plain), out);
  check('a description with no leading clause still leads with the answers',
    out.startsWith('LEAD'), out);
}

// A very long authored description must be trimmed, not allowed to blow the cap.
{
  const long = `${'x'.repeat(MAX_BLENDED_DESCRIPTION_LEN * 2)}: ${'y'.repeat(MAX_BLENDED_DESCRIPTION_LEN * 2)}`;
  const out = blendGameDescription(long, answers, copy);
  check('an over-long description is truncated to the cap',
    out.length <= MAX_BLENDED_DESCRIPTION_LEN, String(out.length));
  check('a truncated description still starts with the lead', out.startsWith('LEAD'), out.slice(0, 30));
}

// Totality — a creator must never lose their game to a missing description.
for (const junk of ['', '   ', undefined, null, 42, {}]) {
  const out = blendGameDescription(junk as unknown as string, answers, copy);
  check(`total on ${JSON.stringify(junk)}: still yields usable text`,
    typeof out === 'string' && out.length > 0, JSON.stringify(out));
}
for (const junk of [undefined, null, {}, { people: NaN, minutes: NaN, ageBandId: 7 }]) {
  const out = blendGameDescription(MISSIONS_DESC, junk as never, copy);
  check(`total on malformed answers ${JSON.stringify(junk)}`,
    typeof out === 'string' && out.length > 0, JSON.stringify(out).slice(0, 80));
}

// ── Derived tags ─────────────────────────────────────────────────────────────
console.log('\n── derivedGameTags ──');
{
  const tags = derivedGameTags(answers, copy);
  check('an age tag is derived', tags.includes('tagage-14-17'), JSON.stringify(tags));
  check('a duration tag is derived', tags.includes('tagdur-90'), JSON.stringify(tags));
  check('every tag is a non-empty string',
    tags.every((t) => typeof t === 'string' && t.trim() !== ''), JSON.stringify(tags));
}
for (const junk of [undefined, null, {}, 'nope']) {
  const tags = derivedGameTags(junk as never, copy);
  check(`total on ${JSON.stringify(junk)}`, Array.isArray(tags), JSON.stringify(tags));
}

console.log(`\n${failures === 0 ? 'ALL DESCRIBE-NEW-GAME TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
