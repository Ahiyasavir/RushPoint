/**
 * Who sees the RushPoint Live band on the English home page
 * (change: rushpoint-live-english).
 *
 * The rule this pins is not "detect Israel accurately" — that is not possible from
 * a static page, and pretending otherwise is how a real applicant gets hidden from.
 * It is: **only positive evidence of somewhere else may hide it.** Every other
 * input, including every broken one, must resolve to SHOW.
 *
 * Pure lane — no browser. Run by `npm test` through the aggregator.
 */
import { ISRAEL_TIME_ZONES, showsIsraelOnlyContent } from '../apps/marketing/src/utils/israelAudience.ts';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

// ── A. In Israel ─────────────────────────────────────────────────────────────

for (const tz of ISRAEL_TIME_ZONES) {
  check(`A1 ${tz} is shown`, showsIsraelOnlyContent({ timeZone: tz, languages: ['en-US'] }));
}
check('A2 the zone match ignores case',
  showsIsraelOnlyContent({ timeZone: 'asia/jerusalem', languages: ['en-US'] }));
check('A3 surrounding whitespace does not defeat the match',
  showsIsraelOnlyContent({ timeZone: '  Asia/Jerusalem  ', languages: ['en-US'] }));

// ── B. A Hebrew reader, anywhere ─────────────────────────────────────────────
//
// An Israeli abroad is exactly the person who might fly back for this, and an
// Israeli holding a work laptop set to another zone is ordinary. The language
// signal therefore overrides the zone, never the other way round.

for (const tag of ['he', 'he-IL', 'HE', 'iw', 'iw-IL']) {
  check(`B1 a "${tag}" reader in New York is shown`,
    showsIsraelOnlyContent({ timeZone: 'America/New_York', languages: [tag] }));
}
check('B2 Hebrew anywhere in the preference list counts',
  showsIsraelOnlyContent({ timeZone: 'Europe/Berlin', languages: ['de-DE', 'en', 'he-IL'] }));

// A language that merely STARTS with the same letters is not Hebrew.
check('B3 "hen" is not Hebrew',
  !showsIsraelOnlyContent({ timeZone: 'America/New_York', languages: ['hen'] }));

// ── C. The only case that hides it ───────────────────────────────────────────

for (const tz of ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney', 'Africa/Cairo']) {
  check(`C1 ${tz} with no Hebrew is hidden`,
    !showsIsraelOnlyContent({ timeZone: tz, languages: ['en-US'] }));
}

// Neighbours are not Israel, however close. This is the check that would catch a
// lazy `startsWith('Asia/')`.
for (const tz of ['Asia/Amman', 'Asia/Beirut', 'Asia/Damascus', 'Asia/Nicosia']) {
  check(`C2 ${tz} is not treated as Israel`,
    !showsIsraelOnlyContent({ timeZone: tz, languages: ['en-US'] }));
}

// ── D. Everything unknown or broken FAILS OPEN ───────────────────────────────
//
// The expensive mistake is hiding this from a real applicant, so anything we
// cannot read must resolve to SHOW. These are the cases a hardened browser, a
// content blocker or an old device actually produces.

const OPEN: Array<[string, unknown]> = [
  ['no signals at all', null],
  ['undefined signals', undefined],
  ['an empty object', {}],
  ['a null time zone', { timeZone: null, languages: ['en-US'] }],
  ['an undefined time zone', { timeZone: undefined, languages: ['en-US'] }],
  ['an empty time zone', { timeZone: '', languages: ['en-US'] }],
  ['a whitespace time zone', { timeZone: '   ', languages: ['en-US'] }],
  ['a non-string time zone', { timeZone: 42, languages: ['en-US'] }],
  ['null languages', { timeZone: null, languages: null }],
  ['a non-array languages', { timeZone: null, languages: 'he' }],
  ['languages holding junk', { timeZone: null, languages: [null, 7, {}] }],
];
for (const [label, signals] of OPEN) {
  let shown: boolean | string;
  try {
    shown = showsIsraelOnlyContent(signals as never);
  } catch (e) {
    shown = `threw ${String(e)}`;
  }
  check(`D1 ${label} still shows`, shown === true, String(shown));
}

// The one combination that hides it needs BOTH halves; neither alone is enough.
check('D2 a foreign zone with unreadable languages still shows',
  showsIsraelOnlyContent({ timeZone: 'Europe/London', languages: null }));

// ── E. It is a decision, not a coin flip ─────────────────────────────────────

{
  const a = showsIsraelOnlyContent({ timeZone: 'Europe/London', languages: ['en-GB'] });
  const b = showsIsraelOnlyContent({ timeZone: 'Europe/London', languages: ['en-GB'] });
  check('E1 the same signals always give the same answer', a === b);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} :: ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
