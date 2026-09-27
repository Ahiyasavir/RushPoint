// Pure-logic tests — is this fix good enough to prove arrival?
// (change: arrival-needs-a-usable-fix)
//
// THE ASYMMETRY THIS CLOSES. `packages/shared/src/safeZone.ts` already learned that a
// position without its error radius is not evidence — its own header records that the
// old version decided a breach "on that answer alone: no accuracy, no age" — and it
// now refuses to call a team out of bounds unless a fresh fix clears the boundary by
// MORE than its own accuracy.
//
// The arrival gate never learned it. `evaluateTrigger` compares a bare distance to a
// bare radius, the callables never accepted an accuracy, and the participant app never
// sent one, although the browser hands it over on every fix. So a phone with a poor
// fix - indoors, an urban canyon, a cold start, which is exactly a field game -
// reports a point that can land inside a 40m radius while the player is hundreds of
// metres away, and the check-in is accepted. That is what the organizer of run
// ijI9JMITSf8C9heN1Cwp reported: the button advanced them "without precise
// verification of the participants' physical location".
//
// THE DIRECTION IS THE OPPOSITE OF THE SAFE-ZONE ONE, AND THAT IS THE POINT. For a
// safety boundary an imprecise fix must not ACCUSE. For an arrival gate an imprecise
// fix must not PROVE. Same missing input, opposite fail-safe.
//
// AND IT MUST NEVER STRAND ANYONE. CLAUDE.md is emphatic that a client-side gate fails
// open and that a player is never left with no route forward. So "not proof" is
// RETRIABLE, distinct from "you are in the wrong place", and an absent accuracy
// reproduces today's behaviour exactly so an app that has not updated is unaffected.
import {
  evaluateArrivalFix, ARRIVAL_VERDICT, type ArrivalVerdict,
  ARRIVAL_RADIUS_FLOOR_M, COARSE_FIX_GRACE_MS,
} from '../packages/shared/src/arrivalFix';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

const verdict = (
  distanceM: number, radiusM: number, accuracyMeters?: number | null,
): ArrivalVerdict => evaluateArrivalFix({ distanceM, radiusM, accuracyMeters });

console.log('\narrival-fix-quality — evaluateArrivalFix');

// ── 1. The ordinary outdoor case must not change at all ──────────────────────
// A phone outdoors reports 5 to 20m. If this change made those players work harder
// it would be a worse bug than the one it fixes.
{
  eq('inside the radius with a good fix is arrival', verdict(10, 40, 8).outcome, ARRIVAL_VERDICT.arrived);
  eq('right on the spot with a good fix is arrival', verdict(0, 40, 5).outcome, ARRIVAL_VERDICT.arrived);
  eq('just inside the radius with a good fix is arrival', verdict(39, 40, 10).outcome, ARRIVAL_VERDICT.arrived);
  eq('a 20m fix inside a 40m radius is arrival', verdict(15, 40, 20).outcome, ARRIVAL_VERDICT.arrived);
  eq('a generous 150m presence radius with a 20m fix is arrival',
    verdict(100, 150, 20).outcome, ARRIVAL_VERDICT.arrived);
}

// ── 2. Genuinely too far is still too far, and says so with the distance ─────
{
  const far = verdict(500, 40, 8);
  eq('clearly outside the radius is tooFar', far.outcome, ARRIVAL_VERDICT.tooFar);
  eq('and tooFar reports the distance so the message can name it', far.distanceM, 500);
  eq('just outside with a good fix is tooFar', verdict(41, 40, 5).outcome, ARRIVAL_VERDICT.tooFar);
}

// ── 3. THE DEFECT: a fix whose own error exceeds the radius is not proof ─────
{
  // The reported field case: a 200m fix against a 40m radius. The reported POINT is
  // inside, so today this is accepted; the fix cannot actually tell.
  const blind = verdict(10, 40, 200);
  eq('a 200m fix against a 40m radius is not proof', blind.outcome, ARRIVAL_VERDICT.fixTooCoarse);
  ok('and it reports the accuracy so the player can be told what to wait for',
    blind.accuracyMeters === 200, String(blind.accuracyMeters));
  eq('a 41m fix against a 40m radius is not proof', verdict(5, 40, 41).outcome, ARRIVAL_VERDICT.fixTooCoarse);
  // The boundary belongs to the player: an accuracy EQUAL to the radius still counts.
  // A strict > keeps the common 40m-radius / 40m-fix case working.
  eq('an accuracy exactly equal to the radius is still usable',
    verdict(5, 40, 40).outcome, ARRIVAL_VERDICT.arrived);
}

// ── 4. Too far AND a useless fix: say "too far" only when the fix can prove it ─
// Reporting "you are 500m away" from a fix with 800m of error would be asserting
// something the evidence does not support, and it is not retriable advice.
{
  eq('a coarse fix that also reads far away is reported as a coarse fix, not as too far',
    verdict(500, 40, 800).outcome, ARRIVAL_VERDICT.fixTooCoarse);
  eq('a GOOD fix that reads far away is reported as too far',
    verdict(500, 40, 10).outcome, ARRIVAL_VERDICT.tooFar);
}

// ── 5. No accuracy reported ⇒ byte-for-byte today's behaviour ───────────────
// An installed app that has not updated sends no accuracy. It must not be stranded.
{
  for (const missing of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'x' as unknown as number]) {
    eq(`accuracy ${JSON.stringify(missing)} inside the radius is arrival`,
      verdict(10, 40, missing as number).outcome, ARRIVAL_VERDICT.arrived);
    eq(`accuracy ${JSON.stringify(missing)} outside the radius is tooFar`,
      verdict(500, 40, missing as number).outcome, ARRIVAL_VERDICT.tooFar);
  }
}

// ── 6. A coarse fix is RETRIABLE, and that distinction is load-bearing ──────
{
  ok('fixTooCoarse is marked retriable', verdict(10, 40, 200).retriable === true);
  ok('tooFar is NOT marked retriable, because moving is what fixes it',
    verdict(500, 40, 10).retriable === false);
  ok('arrived is not retriable', verdict(10, 40, 8).retriable === false);
  // A refusal for a bad fix must not be charged as a wrong attempt: the player did
  // nothing wrong and a cooldown would strand them at the correct spot.
  ok('a coarse fix does not count as a failed attempt',
    verdict(10, 40, 200).countsAsAttempt === false);
  ok('being too far DOES count as an attempt', verdict(500, 40, 10).countsAsAttempt === true);
}

// ── 7. A missing or nonsensical radius falls back rather than stranding ─────
{
  for (const bad of [undefined, null, 0, -5, Number.NaN]) {
    const v = evaluateArrivalFix({ distanceM: 10, radiusM: bad as number, accuracyMeters: 15 });
    ok(`radius ${JSON.stringify(bad)} still yields a usable verdict :: ${v.outcome}`,
      v.outcome === ARRIVAL_VERDICT.arrived || v.outcome === ARRIVAL_VERDICT.tooFar
      || v.outcome === ARRIVAL_VERDICT.fixTooCoarse);
  }
}

// ── 8. Totality — this decides whether a player may progress ────────────────
{
  const bad: unknown[] = [null, undefined, 42, 'x', [], true];
  for (const b of bad) {
    let threw = false;
    let v: ArrivalVerdict | null = null;
    try { v = evaluateArrivalFix(b as never); } catch { threw = true; }
    ok(`a ${String(typeof b)} input does not throw and yields an outcome`,
      !threw && !!v && typeof v.outcome === 'string' && v.outcome.length > 0, JSON.stringify(v));
  }
  for (const d of [Number.NaN, Number.POSITIVE_INFINITY, -10]) {
    const v = evaluateArrivalFix({ distanceM: d, radiusM: 40, accuracyMeters: 10 });
    ok(`a ${String(d)} distance yields a defined outcome :: ${v.outcome}`,
      typeof v.outcome === 'string' && v.outcome.length > 0);
  }
}

// ── 9. The invariant, swept ────────────────────────────────────────────────
//
// The sweep is written against the EFFECTIVE radius, never the authored one. The
// first version compared to `radiusM` and went on passing after the floor was added,
// because the combination that would have caught it (an authored radius under the
// floor AND a distance landing between the two) is about one sweep in a thousand.
// It was asserting a property the module no longer had, and reporting success —
// exactly the "a check that examined nothing prints the same line as a check that
// found no problem" trap in CLAUDE.md. Hence the denominators printed below.
{
  let seed = 0x5bf03635;
  const rnd = (n: number): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const SWEEPS = 20000;
  let violations = 0;
  const seen: Record<string, number> = {};
  // Denominators: a sweep that never builds the interesting case proves nothing.
  let tinyRadius = 0;      // authored below the floor — the 4m-mission case
  let windowOpen = 0;      // grace elapsed on a genuinely coarse fix
  let windowRefusedFar = 0; // …and the distance check still refused it
  for (let i = 0; i < SWEEPS; i++) {
    const radiusM = 1 + rnd(200);
    const distanceM = rnd(400);
    const accuracyMeters = rnd(2) === 0 ? rnd(500) : undefined;
    // A third of sweeps carry an already-open window, a third a fresh clock, a
    // third none at all.
    const mode = rnd(3);
    const nowMs = 5_000_000;
    const coarseSinceMs = mode === 0 ? nowMs - COARSE_FIX_GRACE_MS - rnd(50_000)
      : mode === 1 ? nowMs - rnd(COARSE_FIX_GRACE_MS)
        : null;
    const v = evaluateArrivalFix({ distanceM, radiusM, accuracyMeters, coarseSinceMs, nowMs });
    seen[v.outcome] = (seen[v.outcome] ?? 0) + 1;
    const eff = Math.max(radiusM, ARRIVAL_RADIUS_FLOOR_M);
    if (radiusM < ARRIVAL_RADIUS_FLOOR_M) tinyRadius++;

    // THE FLOOR IS THE RADIUS. Nothing may be judged against the authored one.
    if (v.effectiveRadiusM !== eff) violations++;
    // The floor only ever widens — a mission never becomes harder than authored.
    if (v.effectiveRadiusM < radiusM) violations++;

    // A PROVEN arrival requires a fix that can actually support it.
    if (v.outcome === ARRIVAL_VERDICT.arrived
      && accuracyMeters !== undefined && accuracyMeters > eff) violations++;

    // NO arrival of either kind is ever granted from outside the effective radius.
    // This is the property the grace window must not erode.
    const gotIn = v.outcome === ARRIVAL_VERDICT.arrived
      || v.outcome === ARRIVAL_VERDICT.arrivedUnverified;
    if (gotIn && distanceM > eff) violations++;

    // Only a still-refused coarse fix is retriable; only a real miss is charged.
    if (v.retriable !== (v.outcome === ARRIVAL_VERDICT.fixTooCoarse)) violations++;
    if (v.countsAsAttempt !== (v.outcome === ARRIVAL_VERDICT.tooFar)) violations++;
    // `unverified` names exactly one outcome, so a caller can key a record on it.
    if (v.unverified !== (v.outcome === ARRIVAL_VERDICT.arrivedUnverified)) violations++;
    // The clock is only ever started by a refusal that has no clock yet.
    if (v.startCoarseClock
      && !(v.outcome === ARRIVAL_VERDICT.fixTooCoarse && coarseSinceMs === null)) violations++;

    // THE GAME ALWAYS CONTINUES. With the window open, a coarse fix can no longer
    // refuse on grounds of coarseness — only on grounds of distance.
    const coarse = accuracyMeters !== undefined && accuracyMeters > eff;
    const open = coarseSinceMs !== null && nowMs - coarseSinceMs >= COARSE_FIX_GRACE_MS;
    if (coarse && open) {
      windowOpen++;
      if (v.outcome === ARRIVAL_VERDICT.fixTooCoarse) violations++;
      if (v.outcome === ARRIVAL_VERDICT.tooFar) windowRefusedFar++;
    }
  }
  ok(`no arrival is granted on evidence that cannot support it :: ${SWEEPS} sweeps`,
    violations === 0, `${violations} violation(s)`);
  ok(`the sweep reached every outcome :: ${JSON.stringify(seen)}`,
    Object.keys(seen).length === 4, JSON.stringify(seen));
  // The denominators. Each of these is a case the sweep would silently skip.
  ok(`the sweep really built sub-floor radii :: ${tinyRadius} of ${SWEEPS}`, tinyRadius > 100);
  ok(`the sweep really opened the window on a coarse fix :: ${windowOpen} of ${SWEEPS}`,
    windowOpen > 100);
  ok(`and an open window still refused distant players :: ${windowRefusedFar} of ${windowOpen}`,
    windowRefusedFar > 50);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — the correction. The first version of this rule HALTED THE GAME.
//
// `accuracy > radius ⇒ refuse` has no ceiling and no exit, so two ordinary field
// situations became permanently unwinnable:
//
//   • A mission authored with a 4m radius. Consumer GPS essentially never reports
//     4m accuracy, so the refusal is unconditional, forever.
//   • Anywhere the sky is poor — an alley, a courtyard, under trees. The team is
//     standing in exactly the right place and the button never works.
//
// Both are worse than the cheat the rule exists to stop. So: a FLOOR under the
// radius (an unprovable radius is a broken mission, not a stricter one), and a
// GRACE WINDOW after which the arrival is accepted anyway and recorded as
// unverified. The player is never told they were flagged — there must be no
// incentive to farm the window.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n— the radius floor —');

  ok(`the floor is a real distance a phone can actually resolve :: ${ARRIVAL_RADIUS_FLOOR_M}m`,
    ARRIVAL_RADIUS_FLOOR_M >= 20 && ARRIVAL_RADIUS_FLOOR_M <= 40);

  // The case Ahiya named: a 4m radius.
  const tight = evaluateArrivalFix({ distanceM: 3, radiusM: 4, accuracyMeters: 18 });
  eq('a 4m mission with an ordinary 18m fix ARRIVES rather than refusing forever',
    tight.outcome, ARRIVAL_VERDICT.arrived);

  // The floor widens the gate, so a player just outside a tiny authored radius but
  // inside the floor is IN. Honouring 4m literally is the bug.
  const justOutside = evaluateArrivalFix({ distanceM: 20, radiusM: 4, accuracyMeters: 10 });
  eq('and the floor is the radius actually enforced, not a refusal exemption',
    justOutside.outcome, ARRIVAL_VERDICT.arrived);

  // But the floor only ever RAISES. A generous authored radius is untouched.
  const generous = evaluateArrivalFix({ distanceM: 90, radiusM: 100, accuracyMeters: 30 });
  eq('a radius ABOVE the floor is left exactly as authored',
    generous.outcome, ARRIVAL_VERDICT.arrived);
  const beyond = evaluateArrivalFix({ distanceM: 140, radiusM: 100, accuracyMeters: 30 });
  eq('and being genuinely outside a large radius is still too far',
    beyond.outcome, ARRIVAL_VERDICT.tooFar);

  eq('the floor is reported so a caller never re-derives it',
    evaluateArrivalFix({ distanceM: 3, radiusM: 4, accuracyMeters: 10 }).effectiveRadiusM,
    ARRIVAL_RADIUS_FLOOR_M);
}

{
  console.log('\n— the grace window: a bad fix delays, it never blocks —');

  ok(`the window is short enough to feel like a pause, not a punishment :: ${COARSE_FIX_GRACE_MS}ms`,
    COARSE_FIX_GRACE_MS >= 5_000 && COARSE_FIX_GRACE_MS <= 20_000);

  const NOW = 1_000_000;
  const coarse = { distanceM: 10, radiusM: 40, accuracyMeters: 300 };

  // FIRST press: refused, and the caller is told to start the clock.
  const first = evaluateArrivalFix({ ...coarse, coarseSinceMs: null, nowMs: NOW });
  eq('the first press with a useless fix is still refused', first.outcome, ARRIVAL_VERDICT.fixTooCoarse);
  ok('and the caller is told to start the clock', first.startCoarseClock === true);
  ok('it is retriable and uncharged, exactly as before',
    first.retriable === true && first.countsAsAttempt === false);

  // INSIDE the window: still refused, and the clock is NOT restarted (which would
  // make the window unreachable by pressing repeatedly).
  const inside = evaluateArrivalFix({ ...coarse, coarseSinceMs: NOW, nowMs: NOW + COARSE_FIX_GRACE_MS - 1 });
  eq('a press one millisecond inside the window is still refused',
    inside.outcome, ARRIVAL_VERDICT.fixTooCoarse);
  ok('and pressing again does NOT restart the clock', inside.startCoarseClock === false);

  // AFTER the window: through.
  const after = evaluateArrivalFix({ ...coarse, coarseSinceMs: NOW, nowMs: NOW + COARSE_FIX_GRACE_MS });
  eq('once the window has passed the arrival is ACCEPTED',
    after.outcome, ARRIVAL_VERDICT.arrivedUnverified);
  ok('accepted means accepted: not retriable, not charged',
    after.retriable === false && after.countsAsAttempt === false);

  // THE POINT OF THE WHOLE CHANGE: the game can always continue.
  const hopeless = evaluateArrivalFix({
    distanceM: 2, radiusM: 4, accuracyMeters: 900,
    coarseSinceMs: NOW, nowMs: NOW + 60_000,
  });
  ok('a 4m mission with a hopeless 900m fix still lets the team through',
    hopeless.outcome === ARRIVAL_VERDICT.arrivedUnverified);

  // AND IT IS STILL A GATE. The window forgives an imprecise fix, never a distant
  // one — a player at home does not walk in because they waited.
  const far = evaluateArrivalFix({
    distanceM: 4000, radiusM: 40, accuracyMeters: 300,
    coarseSinceMs: NOW, nowMs: NOW + 60_000,
  });
  eq('but a player genuinely far away is still refused, however long they wait',
    far.outcome, ARRIVAL_VERDICT.tooFar);

  // The verdict must be distinguishable by the caller, because it is recorded.
  ok('an unverified arrival is marked as such, a proven one is not',
    after.unverified === true
    && evaluateArrivalFix({ distanceM: 10, radiusM: 40, accuracyMeters: 10 }).unverified === false);
}

{
  console.log('\n— the grace window cannot be reached by accident —');
  const NOW = 2_000_000;
  // A good fix is a PROVEN arrival whether or not a stale clock is lying around:
  // the window only ever excuses a fix that is actually too coarse.
  const good = evaluateArrivalFix({
    distanceM: 10, radiusM: 40, accuracyMeters: 5, coarseSinceMs: NOW - 60_000, nowMs: NOW,
  });
  eq('a GOOD fix inside the radius is a proven arrival, stamp or no stamp',
    good.outcome, ARRIVAL_VERDICT.arrived);
  ok('and it is not marked unverified', good.unverified === false);

  // Garbage clocks must not open the gate.
  const clocks: [string, number | undefined, number | undefined][] = [
    ['a stamp in the future', NOW + 60_000, NOW],
    ['a NaN stamp', Number.NaN, NOW],
    ['a NaN clock', NOW - 60_000, Number.NaN],
    ['a missing clock', NOW - 60_000, undefined],
  ];
  for (const [label, since, now] of clocks) {
    const v = evaluateArrivalFix({
      distanceM: 10, radiusM: 40, accuracyMeters: 300,
      coarseSinceMs: since, nowMs: now,
    });
    eq(`${label} keeps the gate shut`, v.outcome, ARRIVAL_VERDICT.fixTooCoarse);
  }
}

{
  console.log('\n— an app that has not updated is still never punished —');
  // No accuracy at all ⇒ the pre-change decision, now against the floored radius.
  const noAcc = evaluateArrivalFix({ distanceM: 20, radiusM: 40 });
  eq('absent accuracy still decides on distance alone', noAcc.outcome, ARRIVAL_VERDICT.arrived);
  ok('and is never marked unverified', noAcc.unverified === false);
}

console.log('');
if (failures > 0) {
  console.error(`✗ arrival-fix-quality: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ arrival-fix-quality: all assertions passed');
