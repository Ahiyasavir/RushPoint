// Which Builder guidance surface may be on screen (change: builder-guidance-arbiter).
//
// Five guidance surfaces render into one Builder screen — the first-launch
// confirmation, הקמה מהירה, the guided tour, the first-open spotlight and the ready
// nudge — each added by a different change. Before this change only 2 of the 10
// pairs yielded to each other, by two different mechanisms, so pressing the nav's
// "?" while הקמה מהירה was mid-step put two spotlight overlays on screen pointing at
// different controls.
//
// The order is now declared ONCE, and the winner is decided by a pure function. That
// decision is tested EXHAUSTIVELY below — all 32 subsets — rather than by example,
// because a missed pair is exactly the defect this change exists to end, and no gate
// anywhere else in this repo can see an overlay.
//
// No emulator, no DOM.
//   npx tsx scripts/test-builder-guidance.ts
import {
  GUIDANCE_PRIORITY,
  GUIDANCE_SURFACES,
  activeGuidance,
  tourRequestOutcome,
  type GuidanceSurface,
} from '../apps/creator-web/src/lib/builderGuidance';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function eq<T>(label: string, got: T, want: T): void {
  ok(label, Object.is(got, want), Object.is(got, want) ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── 1. The priority order itself ────────────────────────────────────────────
console.log('\nthe declared order');

eq('launch-confirm is highest', GUIDANCE_PRIORITY[0], 'launch-confirm' as GuidanceSurface);
eq('ready-nudge is lowest', GUIDANCE_PRIORITY[GUIDANCE_PRIORITY.length - 1], 'ready-nudge' as GuidanceSurface);
eq('quick-setup outranks the tour',
  GUIDANCE_PRIORITY.indexOf('quick-setup') < GUIDANCE_PRIORITY.indexOf('tour'), true);
eq('the tour outranks the spotlight',
  GUIDANCE_PRIORITY.indexOf('tour') < GUIDANCE_PRIORITY.indexOf('spotlight'), true);

// Completeness. A sixth surface that is added to the union but never ranked would
// otherwise default to "never wins", i.e. silently never render — the failure mode
// this file exists to make loud.
{
  const ranked = new Set(GUIDANCE_PRIORITY);
  eq('every surface in the union is ranked', GUIDANCE_SURFACES.every((s) => ranked.has(s)), true);
  eq('nothing is ranked twice', ranked.size, GUIDANCE_PRIORITY.length);
  eq('the order ranks exactly the union', GUIDANCE_PRIORITY.length, GUIDANCE_SURFACES.length);
}

// ── 2. EXHAUSTIVE: every subset yields exactly one winner ───────────────────
console.log('\nevery combination of candidates (exhaustive)');

const N = GUIDANCE_SURFACES.length;
let subsetsChecked = 0;
let mismatches: string[] = [];
for (let mask = 0; mask < (1 << N); mask++) {
  const subset = GUIDANCE_SURFACES.filter((_, i) => (mask & (1 << i)) !== 0);
  const want = GUIDANCE_PRIORITY.find((s) => subset.includes(s)) ?? null;
  const got = activeGuidance(subset);
  subsetsChecked++;
  if (!Object.is(got, want)) {
    mismatches.push(`{${subset.join(',')}} -> got ${String(got)}, want ${String(want)}`);
  }
}
// Print the denominator, never a bare "no problems found": a check that examined
// nothing and a check that examined everything read identically otherwise.
eq(`all ${subsetsChecked} subsets pick the highest-priority candidate`, mismatches.length, 0);
for (const m of mismatches.slice(0, 8)) ok(`  mismatch ${m}`, false);
eq('the exhaustive sweep really covered 2^5 subsets', subsetsChecked, 32);

// The empty set is the "nothing qualifies" case the spec names explicitly.
eq('no candidates -> no surface', activeGuidance([]), null);

// Spot-check the two pairs that were the actual reported defect, so a regression
// names itself rather than hiding inside the sweep's count.
eq('quick setup beats the spotlight', activeGuidance(['spotlight', 'quick-setup']), 'quick-setup' as GuidanceSurface);
eq('quick setup beats the tour', activeGuidance(['tour', 'quick-setup']), 'quick-setup' as GuidanceSurface);
eq('the launch confirmation beats an in-progress flow',
  activeGuidance(['quick-setup', 'launch-confirm']), 'launch-confirm' as GuidanceSurface);
eq('the ready nudge loses to everything',
  GUIDANCE_SURFACES.filter((s) => s !== 'ready-nudge')
    .every((s) => activeGuidance(['ready-nudge', s]) === s), true);

// Order of the input must not matter — the caller passes a Set, whose iteration
// order is insertion order, i.e. whichever surface mounted first.
{
  let orderIndependent = true;
  for (const a of GUIDANCE_SURFACES) {
    for (const b of GUIDANCE_SURFACES) {
      if (activeGuidance([a, b]) !== activeGuidance([b, a])) orderIndependent = false;
    }
  }
  eq('the winner does not depend on mount/insertion order', orderIndependent, true);
}

// ── 3. Totality ─────────────────────────────────────────────────────────────
console.log('\nmalformed input never throws and never shows two things');

function total(label: string, run: () => unknown, want: unknown): void {
  let got: unknown;
  try { got = run(); } catch (e) { ok(label, false, `threw ${String(e)}`); return; }
  eq(label, got, want);
}
total('null -> null', () => activeGuidance(null), null);
total('undefined -> null', () => activeGuidance(undefined), null);
total('an empty iterable -> null', () => activeGuidance(new Set<GuidanceSurface>()), null);
total('a Set is accepted, not just an array',
  () => activeGuidance(new Set<GuidanceSurface>(['ready-nudge', 'tour'])), 'tour');
total('duplicates collapse', () => activeGuidance(['spotlight', 'spotlight']), 'spotlight');
total('an unrecognised name never wins',
  () => activeGuidance(['not-a-surface' as GuidanceSurface, 'ready-nudge']), 'ready-nudge');
total('an unrecognised name alone -> null',
  () => activeGuidance(['not-a-surface' as GuidanceSurface]), null);
total('a null member is ignored, not thrown on',
  () => activeGuidance([null as unknown as GuidanceSurface, 'tour']), 'tour');
total('a non-iterable is refused quietly',
  () => activeGuidance(42 as unknown as GuidanceSurface[]), null);

// ── 4. The deferred tour request ────────────────────────────────────────────
// A user-initiated action that resolves silently is a dead button (CLAUDE.md), so a
// help press that cannot run right now must be HELD. An auto-start that loses must
// be DROPPED — an unrequested tour appearing minutes later is a new bug, not a fix.
console.log('\nrequesting the tour');

const OUTCOMES: Array<[('help' | 'auto'), boolean, string]> = [
  ['help', true, 'start'],
  ['help', false, 'hold'],
  ['auto', true, 'start'],
  ['auto', false, 'drop'],
];
for (const [source, wins, want] of OUTCOMES) {
  eq(`${source} + ${wins ? 'wins' : 'loses'} -> ${want}`, tourRequestOutcome(source, wins), want);
}
total('an unknown source is treated as automatic (never held)',
  () => tourRequestOutcome('mystery' as 'help', false), 'drop');
total('a malformed source with a clear field still starts',
  () => tourRequestOutcome(undefined as unknown as 'help', true), 'start');

// ── done ────────────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.error(`❌ builder-guidance: ${failures} FAILED`);
  process.exit(1);
}
console.log('✅ builder-guidance: ALL PASS');
