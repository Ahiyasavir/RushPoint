// Pure-logic tests for expose-enforced-settings — the validators and the consent
// partition behind fields the SERVER enforces. Run by scripts/run-unit-tests.mjs
// via `npm test`.
//
// WHY THESE EXIST
// `updateGame` used to write `safeZone` with a bare `updates.safeZone = safeZone`,
// straight onto a field two safety paths read (updateLocation and the routing
// soft-pause). And `startTeams` filtered consent-held teams out of a count nobody
// could see. Both are decisions, so both are pure functions with enumerated cases
// here, before any of it is wired to a callable.
// Imported from SOURCE, not from `@rushpoint/shared`, matching test-safe-zone.ts
// and test-guardian-consent.ts: the pure lane must not depend on a built `dist`.
import {
  validateSafeZone,
  SAFE_ZONE_MAX_RADIUS_M,
  SAFE_ZONE_MIN_SUGGESTED_RADIUS_M,
  SAFE_ZONE_SUGGESTION_PADDING_M,
  suggestSafeZone,
} from '../packages/shared/src/safeZone';
import {
  validateMinAge,
  validateConsentFlag,
  partitionTeamsByConsent,
} from '../packages/shared/src/guardianConsent';
import { haversineKm } from '../packages/shared/src/geo';
import type { Stage } from '../packages/shared/src/types';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── validateSafeZone ─────────────────────────────────────────────────────────
const zone = (lat: number, lng: number, radiusMeters: number) =>
  ({ center: { lat, lng }, radiusMeters });

const good = validateSafeZone(zone(31.775, 35.235, 400));
ok(good.ok === true, 'a well formed boundary is accepted');
ok(good.ok === true && same(good.value, zone(31.775, 35.235, 400)),
  'an accepted boundary is normalized to centre + radius');

// Absent vs explicit clear — the distinction the server depends on.
const absent = validateSafeZone(undefined);
ok(absent.ok === true && absent.value === undefined, 'undefined is accepted as "no change"');
const cleared = validateSafeZone(null);
ok(cleared.ok === true && cleared.value === undefined, 'null is accepted as an explicit clear');

// Shape.
ok(validateSafeZone({}).ok === false, 'a missing centre is refused');
ok(validateSafeZone({ radiusMeters: 100 }).ok === false, 'centre-less boundary is refused');
ok(validateSafeZone({ center: 'here', radiusMeters: 100 }).ok === false, 'a non-object centre is refused');
ok(validateSafeZone({ center: { lat: 31.7, lng: 35.2 } }).ok === false, 'a radius-less boundary is refused');
ok(validateSafeZone([zone(31.7, 35.2, 100)]).ok === false, 'an array is refused');
ok(validateSafeZone('31.7,35.2,100').ok === false, 'a string is refused');
ok(validateSafeZone(400).ok === false, 'a number is refused');

// Non-finite coordinates.
ok(validateSafeZone(zone(Number.NaN, 35.2, 100)).ok === false, 'NaN latitude is refused');
ok(validateSafeZone(zone(31.7, Number.NaN, 100)).ok === false, 'NaN longitude is refused');
ok(validateSafeZone(zone(Number.POSITIVE_INFINITY, 35.2, 100)).ok === false, 'Infinity latitude is refused');
ok(validateSafeZone(zone(31.7, Number.NEGATIVE_INFINITY, 100)).ok === false, '-Infinity longitude is refused');
ok(validateSafeZone({ center: { lat: '31.7', lng: 35.2 }, radiusMeters: 100 }).ok === false,
  'a string latitude is refused (never coerced)');

// Coordinate range, including the accepted extremes.
ok(validateSafeZone(zone(91, 0, 100)).ok === false, 'latitude 91 is refused');
ok(validateSafeZone(zone(-91, 0, 100)).ok === false, 'latitude -91 is refused');
ok(validateSafeZone(zone(0, 181, 100)).ok === false, 'longitude 181 is refused');
ok(validateSafeZone(zone(0, -181, 100)).ok === false, 'longitude -181 is refused');
ok(validateSafeZone(zone(90, 180, 100)).ok === true, 'latitude 90 / longitude 180 are accepted');
ok(validateSafeZone(zone(-90, -180, 100)).ok === true, 'latitude -90 / longitude -180 are accepted');

// Radius.
ok(validateSafeZone(zone(31.7, 35.2, 0)).ok === false, 'a zero radius is refused');
ok(validateSafeZone(zone(31.7, 35.2, -5)).ok === false, 'a negative radius is refused');
ok(validateSafeZone(zone(31.7, 35.2, Number.NaN)).ok === false, 'a NaN radius is refused');
ok(validateSafeZone(zone(31.7, 35.2, Number.POSITIVE_INFINITY)).ok === false, 'an infinite radius is refused');
ok(validateSafeZone({ center: { lat: 31.7, lng: 35.2 }, radiusMeters: '400' }).ok === false,
  'a string radius is refused');
ok(validateSafeZone(zone(31.7, 35.2, 1)).ok === true, 'a 1 m radius is accepted');
ok(validateSafeZone(zone(31.7, 35.2, SAFE_ZONE_MAX_RADIUS_M)).ok === true,
  'exactly the maximum radius is accepted');
ok(validateSafeZone(zone(31.7, 35.2, SAFE_ZONE_MAX_RADIUS_M + 1)).ok === false,
  'one metre over the maximum radius is refused');

// Extra keys never ride into the enforcement path.
const extra = validateSafeZone({
  center: { lat: 31.7, lng: 35.2, label: 'Old City' },
  radiusMeters: 400,
  note: 'whatever',
});
ok(extra.ok === true, 'unknown keys do not make a valid boundary invalid');
ok(extra.ok === true && same(extra.value, zone(31.7, 35.2, 400)),
  'unknown keys are stripped from the stored boundary');

// Never throws, whatever it is handed.
for (const junk of [Symbol.iterator, () => 0, new Date(), Number.NaN, true]) {
  let threw = false;
  try { validateSafeZone(junk as unknown); } catch { threw = true; }
  ok(!threw, `validateSafeZone is total for ${String(junk)}`);
}

// ── validateMinAge ───────────────────────────────────────────────────────────
ok(validateMinAge(undefined).ok === true, 'an absent minimum age is "no change"');
ok(validateMinAge(0).ok === true, 'a minimum age of 0 is accepted');
ok(validateMinAge(13).ok === true, 'a minimum age of 13 is accepted');
ok(validateMinAge(120).ok === true, 'a minimum age of 120 is accepted');
ok(validateMinAge(121).ok === false, 'an absurd minimum age is refused');
ok(validateMinAge(-1).ok === false, 'a negative minimum age is refused');
ok(validateMinAge(12.5).ok === false, 'a fractional minimum age is refused');
ok(validateMinAge(Number.NaN).ok === false, 'NaN is refused');
ok(validateMinAge(Number.POSITIVE_INFINITY).ok === false, 'Infinity is refused');
ok(validateMinAge('13').ok === false, 'a numeric string is refused (never coerced)');
ok(validateMinAge(null).ok === false, 'null is refused');
ok(validateMinAge(true).ok === false, 'a boolean is refused');

// ── validateConsentFlag ──────────────────────────────────────────────────────
ok(validateConsentFlag(undefined).ok === true, 'an absent consent flag is "no change"');
ok(validateConsentFlag(true).ok === true, 'true is accepted');
ok(validateConsentFlag(false).ok === true, 'false is accepted');
ok(validateConsentFlag('true').ok === false, 'a truthy string can never arm the gate');
ok(validateConsentFlag(1).ok === false, '1 is refused');
ok(validateConsentFlag(0).ok === false, '0 is refused');
ok(validateConsentFlag(null).ok === false, 'null is refused');

// ── partitionTeamsByConsent ──────────────────────────────────────────────────
type T = { id: string; guardianConsent?: { grantedAt?: string } | null };
const granted = (id: string): T => ({ id, guardianConsent: { grantedAt: '2026-07-23T00:00:00.000Z' } });
const none    = (id: string): T => ({ id });

function invariant(input: T[], res: { ready: T[]; held: T[] }, label: string) {
  ok(res.ready.length + res.held.length === input.length, `${label}: partition is total`);
  const readyIds = res.ready.map((t) => t.id);
  const heldIds = res.held.map((t) => t.id);
  ok(readyIds.every((id) => !heldIds.includes(id)), `${label}: partition is disjoint`);
  ok(same([...readyIds, ...heldIds].sort(), input.map((t) => t.id).sort()),
    `${label}: partition covers exactly the input`);
  ok(same(readyIds, input.filter((t) => readyIds.includes(t.id)).map((t) => t.id)),
    `${label}: input order is preserved`);
}

const req = { requiresGuardianConsent: true };
const notReq = { requiresGuardianConsent: false };

let r = partitionTeamsByConsent([] as T[], req);
ok(r.ready.length === 0 && r.held.length === 0, 'an empty cohort partitions to empty');
invariant([], r, 'empty');

const cohort = [none('a'), granted('b'), none('c'), granted('d')];

r = partitionTeamsByConsent(cohort, notReq);
ok(r.ready.length === 4 && r.held.length === 0,
  'consent not required: every team is ready even with no record');
invariant(cohort, r, 'not required');

r = partitionTeamsByConsent(cohort, {});
ok(r.ready.length === 4, 'an absent requirement behaves as not required');
invariant(cohort, r, 'absent requirement');

r = partitionTeamsByConsent([none('a'), none('c')], req);
ok(r.ready.length === 0 && r.held.length === 2, 'consent required with no records: everyone is held');
invariant([none('a'), none('c')], r, 'all held');

r = partitionTeamsByConsent(cohort, req);
ok(same(r.ready.map((t) => t.id), ['b', 'd']), 'consented teams are ready');
ok(same(r.held.map((t) => t.id), ['a', 'c']), 'unconsented teams are held');
invariant(cohort, r, 'mixed');

const falsy = [{ id: 'e', guardianConsent: { grantedAt: '' } }, { id: 'f', guardianConsent: null }];
r = partitionTeamsByConsent(falsy as T[], req);
ok(r.held.length === 2, 'an empty grantedAt and a null consent are both held, never ready');
invariant(falsy as T[], r, 'falsy consent');

// ── suggestSafeZone ──────────────────────────────────────────────────────────
// The Builder control needs a starting boundary, and "type two decimal degrees"
// is not a control anyone can use. This derives one from the tasks the creator
// already placed. It is a DERIVATION, so it is decided here, in a pure function,
// before it is wired to a button.
//
// It deliberately counts hideLocation tasks, unlike publicTaskLocation: the safe
// zone lives on the PRIVATE game doc and is never copied into publicGames or any
// participant payload, so a hidden task's position cannot leak through it — and a
// play area that excluded the hidden stops would fence players out of the game.

const placed = (id: string, lat: number, lng: number) =>
  ({ id, title: id, type: 'field', coordinates: { lat, lng } });
const stageOf = (...tasks: unknown[]) =>
  ({ id: 's', order: 0, title: 'S', tasks } as unknown as Stage);

ok(suggestSafeZone(undefined) === undefined, 'no stages suggests nothing');
ok(suggestSafeZone([]) === undefined, 'an empty stage list suggests nothing');
ok(suggestSafeZone('stages' as unknown as Stage[]) === undefined,
  'a non-array stage list suggests nothing (never throws)');
ok(suggestSafeZone([stageOf()]) === undefined, 'a stage with no tasks suggests nothing');
ok(suggestSafeZone([null as unknown as Stage]) === undefined, 'a null stage is skipped');

// Only placed tasks count.
ok(suggestSafeZone([stageOf({ id: 'a', title: 'a', type: 'quiz' })]) === undefined,
  'a task with no coordinates contributes nothing');
ok(suggestSafeZone([stageOf({ ...placed('a', 31.7, 35.2), locationless: true })]) === undefined,
  'a locationless task contributes nothing');
ok(suggestSafeZone([stageOf(placed('a', 0, 0))]) === undefined,
  'null island is not a placed task');
ok(suggestSafeZone([stageOf(placed('a', Number.NaN, 35.2))]) === undefined,
  'NaN coordinates contribute nothing');
ok(suggestSafeZone([stageOf(placed('a', 31.7, Number.POSITIVE_INFINITY))]) === undefined,
  'infinite coordinates contribute nothing');
ok(suggestSafeZone([stageOf(placed('a', 91, 35.2))]) === undefined,
  'an out-of-range latitude contributes nothing');

// A single stop: centred on it, at the documented minimum radius.
const one = suggestSafeZone([stageOf(placed('a', 31.775, 35.235))]);
ok(!!one, 'one placed task yields a suggestion');
ok(!!one && one.center.lat === 31.775 && one.center.lng === 35.235,
  'one placed task centres the zone on that task');
ok(!!one && one.radiusMeters === SAFE_ZONE_MIN_SUGGESTED_RADIUS_M,
  'one placed task uses the minimum suggested radius, never a zero-radius zone');
ok(!!one && one.coversAllTasks === true, 'a single-task suggestion covers every task');

// Several stops across stages: every one of them must end up inside.
const spread: Stage[] = [
  stageOf(placed('a', 31.770, 35.220), placed('b', 31.780, 35.240)),
  stageOf(placed('c', 31.7755, 35.2305), { id: 'x', title: 'x', type: 'quiz' }),
];
const many = suggestSafeZone(spread);
ok(!!many, 'several placed tasks yield a suggestion');
if (many) {
  const points = [
    { lat: 31.770, lng: 35.220 },
    { lat: 31.780, lng: 35.240 },
    { lat: 31.7755, lng: 35.2305 },
  ];
  const worst = Math.max(...points.map((p) => haversineKm(p, many.center) * 1000));
  ok(worst <= many.radiusMeters, 'every placed task is inside the suggested radius');
  ok(many.radiusMeters >= worst + SAFE_ZONE_SUGGESTION_PADDING_M - 10,
    'the suggested radius adds walking padding beyond the outermost task');
  ok(many.coversAllTasks === true, 'a normal spread is reported as covering every task');
  ok(many.center.lat > 31.769 && many.center.lat < 31.781,
    'the centre sits within the extent of the tasks');
}

// Order must not matter — the same stops in any order are the same play area.
const reversed = suggestSafeZone([
  stageOf(placed('c', 31.7755, 35.2305)),
  stageOf(placed('b', 31.780, 35.240), placed('a', 31.770, 35.220)),
]);
ok(!!many && !!reversed && same(many, reversed), 'the suggestion does not depend on task order');

// A continent-wide game cannot be covered. Say so rather than emit an invalid zone.
const absurd = suggestSafeZone([stageOf(placed('a', -33.9, 18.4), placed('b', 60.2, 24.9))]);
ok(!!absurd, 'an absurdly spread game still yields a suggestion');
ok(!!absurd && absurd.radiusMeters === SAFE_ZONE_MAX_RADIUS_M,
  'an absurd spread is clamped to the maximum radius');
ok(!!absurd && absurd.coversAllTasks === false,
  'a clamped suggestion reports that it does NOT cover every task');

// The invariant that matters most: a suggestion is always storable.
for (const [label, s] of [['single', one], ['spread', many], ['clamped', absurd]] as const) {
  if (!s) continue;
  const check = validateSafeZone({ center: s.center, radiusMeters: s.radiusMeters });
  ok(check.ok === true, `the ${label} suggestion is accepted by validateSafeZone`);
}

// Total for hostile input.
for (const junk of [42, 'x', {}, [[]], [{ tasks: 'no' }], [{ tasks: [null, undefined] }]]) {
  let threw = false;
  try { suggestSafeZone(junk as unknown as Stage[]); } catch { threw = true; }
  ok(!threw, `suggestSafeZone is total for ${JSON.stringify(junk)}`);
}

console.log(`enforced-settings: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
