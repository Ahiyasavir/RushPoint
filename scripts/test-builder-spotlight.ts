// Pure-logic test for the Builder's first-open spotlight
// (change: guided-new-game-wizard).
//
// The hardest reported problem with this product is not building a mission, it is
// understanding what the app IS. The full 15-step CreatorTour already owns the
// first-signup moment, and git history records why it must not be stretched to
// cover this one: auto-firing it on an empty dashboard described screens that did
// not exist yet (commit ae512a5). So the Builder gets its own two-or-three step
// explainer, in situ, pointing at real elements.
//
// Three rules matter enough to pin here:
//
//  1. IT ANCHORS ON THINGS THAT EXIST. Every anchor must be a `data-tour` value
//     actually present in BuilderPage.tsx, asserted by reading the file — a step
//     pointing at a removed attribute highlights empty space, and nothing else in
//     the build would catch the rename.
//  2. IT YIELDS. The full tour and Quick Setup are both guided experiences; two
//     overlays at once is worse than none. Quick Setup in particular auto-opens on
//     Builder mount for a templated game, so a guided-path creator must never get
//     both — which makes this, in practice, the SCRATCH creator's explainer, the
//     one person who gets no other guidance at all.
//  3. IT IS A SEPARATE RECORD. Sharing the tour's seen-key would mean dismissing
//     one silently dismissed the other.
//
//   npx tsx scripts/test-builder-spotlight.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPOTLIGHT_STEPS,
  SPOTLIGHT_SEEN_KEY_PREFIX,
  TOUR_SEEN_KEY_PREFIX,
  spotlightSeenKey,
  readSpotlightRecord,
  shouldStartBuilderSpotlight,
  visibleSpotlightSteps,
} from '../apps/creator-web/src/lib/creatorOnboarding';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── The steps ────────────────────────────────────────────────────────────────
console.log('\n── SPOTLIGHT_STEPS ──');

check('at most three steps', SPOTLIGHT_STEPS.length <= 3, String(SPOTLIGHT_STEPS.length));
check('at least two steps', SPOTLIGHT_STEPS.length >= 2, String(SPOTLIGHT_STEPS.length));
check('every step has an id',
  SPOTLIGHT_STEPS.every((s) => typeof s.id === 'string' && s.id.length > 0));
check('every step has an anchor',
  SPOTLIGHT_STEPS.every((s) => typeof s.anchor === 'string' && s.anchor.length > 0),
  JSON.stringify(SPOTLIGHT_STEPS.map((s) => s.anchor)));
check('step ids are unique',
  new Set(SPOTLIGHT_STEPS.map((s) => s.id)).size === SPOTLIGHT_STEPS.length);

// Every anchor must really be in the Builder. A renamed attribute would otherwise
// spotlight nothing and no other gate would notice.
const builder = readFileSync(join(process.cwd(), 'apps/creator-web/src/pages/BuilderPage.tsx'), 'utf8');
for (const s of SPOTLIGHT_STEPS) {
  check(`anchor "${s.anchor}" exists in BuilderPage.tsx`,
    builder.includes(`data-tour="${s.anchor}"`));
}

// ── The seen-record is separate from the full tour's ─────────────────────────
console.log('\n── seen record ──');
check('the spotlight key prefix differs from the tour key prefix',
  SPOTLIGHT_SEEN_KEY_PREFIX !== TOUR_SEEN_KEY_PREFIX,
  `${SPOTLIGHT_SEEN_KEY_PREFIX} vs ${TOUR_SEEN_KEY_PREFIX}`);
check('the key is scoped per creator',
  spotlightSeenKey('uid-a') !== spotlightSeenKey('uid-b'),
  `${spotlightSeenKey('uid-a')} / ${spotlightSeenKey('uid-b')}`);
check('a missing uid still yields a usable key',
  typeof spotlightSeenKey(undefined) === 'string' && spotlightSeenKey(undefined).length > 0,
  spotlightSeenKey(undefined));

check('a well-formed record parses', readSpotlightRecord('{"seen":true}')?.seen === true);
for (const junk of ['', '   ', 'not json', '[]', 'null', '42', undefined, null]) {
  check(`unparseable record ${JSON.stringify(junk)} reads as never-seen`,
    readSpotlightRecord(junk as unknown as string) === null);
}

// ── When it starts ───────────────────────────────────────────────────────────
console.log('\n── shouldStartBuilderSpotlight ──');

const base = { record: null, tourRunning: false, quickSetupActive: false };
check('starts on a first Builder open', shouldStartBuilderSpotlight(base) === true);
check('does not start once seen',
  shouldStartBuilderSpotlight({ ...base, record: { seen: true } }) === false);

// Yielding — the whole point of rule 2.
check('yields to the full product tour',
  shouldStartBuilderSpotlight({ ...base, tourRunning: true }) === false);
check('yields to Quick Setup',
  shouldStartBuilderSpotlight({ ...base, quickSetupActive: true }) === false);
check('yields when both are active',
  shouldStartBuilderSpotlight({ ...base, tourRunning: true, quickSetupActive: true }) === false);

for (const junk of [null, undefined, {}, 'nope', 42]) {
  const out = shouldStartBuilderSpotlight(junk as never);
  check(`total on ${JSON.stringify(junk)}`, typeof out === 'boolean', String(out));
}

// ── Missing anchors are skipped, not highlighted ─────────────────────────────
console.log('\n── visibleSpotlightSteps ──');
{
  const all = visibleSpotlightSteps(() => true);
  check('every step shows when every anchor is mounted',
    all.length === SPOTLIGHT_STEPS.length, String(all.length));
}
{
  const none = visibleSpotlightSteps(() => false);
  check('no step shows when nothing is mounted', none.length === 0, String(none.length));
}
{
  const first = SPOTLIGHT_STEPS[0].anchor;
  const some = visibleSpotlightSteps((a) => a === first);
  check('a missing anchor skips only its own step',
    some.length === 1 && some[0].anchor === first, JSON.stringify(some.map((s) => s.anchor)));
}
for (const junk of [null, undefined, 'nope', 42]) {
  check(`total on ${JSON.stringify(junk)}`, Array.isArray(visibleSpotlightSteps(junk as never)));
}

// ── Copy exists in BOTH dictionaries ─────────────────────────────────────────
console.log('\n── copy ──');
const i18n = readFileSync(join(process.cwd(), 'apps/creator-web/src/i18n.ts'), 'utf8');
for (const s of SPOTLIGHT_STEPS) {
  const hits = i18n.split(`${s.id}:`).length - 1;
  check(`copy for "${s.id}" exists in both dictionaries`, hits >= 2, `${hits} occurrence(s)`);
}

// ── The advance guard (regression: the "5/2" counter) ────────────────────────
// `last` is captured from a render, so a burst of taps all take the "not last"
// branch and each runs `i + 1` — walking `index` past the end. The step render
// was already clamped, so the only visible symptom was a counter reading "5/2",
// while the real damage was that no further tap could reach `finish()` at all.
// Found by clicking the spotlight through faster than React could re-render.
// Component behaviour, and creator-web has no component test runner, so this is
// a source assertion — but a precise one: the increment MUST be clamped.
console.log('\n── advance guard ──');
const spotlightSrc = readFileSync(
  join(process.cwd(), 'apps/creator-web/src/components/BuilderSpotlight.tsx'), 'utf8');
check('the step increment is clamped to the last index',
  /setIndex\(\(i\) => Math\.min\(i \+ 1, steps\.length - 1\)\)/.test(spotlightSrc),
  'an unclamped `i + 1` lets a tap burst run off the end');
check('the raw index is never rendered as the step number',
  !/\{index \+ 1\}\//.test(spotlightSrc));

console.log(`\n${failures === 0 ? 'ALL BUILDER-SPOTLIGHT TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
