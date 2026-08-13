// Pure-logic tests — the guided tour DRIVES the creator (change: tour-auto-navigate).
//
// THE COMPLAINT: "in the tour you are not able to get inside a game and see it
// visually." The tour's founding rule was "it never navigates on its own; a step
// only OFFERS its destination" — so every step showed a card, and reaching the
// screen it described was a manual click the creator had to notice and make.
//
// Worse for the case the tour now auto-starts in (a BRAND-NEW creator, zero games):
// `tourStepTarget` returns null for all seven Builder steps because there is no
// game to open, so they degraded to centred cards narrating screens the creator
// could not see and could not get to. The tour talked about the Builder without
// ever showing it.
//
// THE RULE NOW: every step resolves to exactly one of three intents —
//   navigate    — a real destination exists, so go there (no click required)
//   awaitAction — the destination cannot exist yet because the creator has to DO
//                 something first (create a game). Point at the control that does
//                 it and wait, rather than narrating an unreachable screen.
//   stay        — already on the right surface, or the step is placeless.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  TOUR_STEPS, buildTourSteps, tourNavIntent, tourStepTarget,
  TOUR_ACTION_ANCHORS, firstGameIdKey, TOUR_FIRST_GAME_KEY,
  type TourStep,
} from '../apps/creator-web/src/lib/creatorOnboarding';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const step = (id: string): TourStep => {
  const s = TOUR_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`no such step: ${id}`);
  return s;
};
const NO_GAMES = { firstGameId: null, liveRunPath: null };
const WITH_GAME = { firstGameId: 'g1', liveRunPath: null };

console.log('\n── 1. a step with a reachable destination NAVIGATES, unprompted ──');
eq('gallery step from the dashboard navigates to /gallery',
  tourNavIntent(step('gallery'), WITH_GAME, '/'), { kind: 'navigate', to: '/gallery' });
eq('settings step navigates to /settings',
  tourNavIntent(step('settings'), WITH_GAME, '/'), { kind: 'navigate', to: '/settings' });
eq('a dashboard step navigates home from elsewhere',
  tourNavIntent(step('newGame'), WITH_GAME, '/gallery'), { kind: 'navigate', to: '/' });

console.log('\n── 2. …but never re-navigates to where it already is ────────────');
// Re-issuing the same route on every render would fight the router and, with
// `replace`, could trap the creator's Back button.
eq('already on the dashboard ⇒ stay',
  tourNavIntent(step('newGame'), WITH_GAME, '/'), { kind: 'stay' });
eq('already in the gallery ⇒ stay',
  tourNavIntent(step('gallery'), WITH_GAME, '/gallery'), { kind: 'stay' });
eq('a placeless step never moves anyone',
  tourNavIntent(step('welcome'), WITH_GAME, '/gallery'), { kind: 'stay' });
eq('the finish step never moves anyone',
  tourNavIntent(step('finish'), WITH_GAME, '/settings'), { kind: 'stay' });

console.log('\n── 3. THE FIX: Builder steps with no game ask, they do not narrate ──');
// This is the reported bug. With zero games there is no /build/<id> to open, so
// the old code produced a null target and a centred card about a screen the
// creator could not reach.
const builderSteps = TOUR_STEPS.filter((s) => s.surface === 'builder');
ok('the walkthrough really does contain Builder steps', builderSteps.length > 0);
for (const s of builderSteps) {
  eq(`'${s.id}' with no game asks the creator to create one`,
    tourNavIntent(s, NO_GAMES, '/'),
    { kind: 'awaitAction', anchor: TOUR_ACTION_ANCHORS.createGame, at: '/' });
}
// The prompt has to be issued where the button actually exists, so a creator
// standing anywhere else is first walked back to the dashboard.
eq('asking from the gallery first returns to where the button lives',
  tourNavIntent(step('builderStages'), NO_GAMES, '/gallery'),
  { kind: 'navigate', to: '/' });

console.log('\n── 4. …and the moment a game exists, it walks straight in ───────');
for (const s of builderSteps) {
  eq(`'${s.id}' with a game opens the builder`,
    tourNavIntent(s, WITH_GAME, '/'), { kind: 'navigate', to: '/build/g1' });
}
eq('already inside that builder ⇒ stay',
  tourNavIntent(step('builderStages'), WITH_GAME, '/build/g1'), { kind: 'stay' });
// A creator editing a DIFFERENT game is not dragged to the first one: they are
// already looking at a real builder, which is what the step is about.
eq('inside a different builder ⇒ stay (any builder teaches the step)',
  tourNavIntent(step('builderStages'), WITH_GAME, '/build/other'), { kind: 'stay' });

console.log('\n── 5. the run step, which also depends on state that may not exist ──');
eq('no live run ⇒ ask, do not narrate',
  tourNavIntent(step('runConsole'), NO_GAMES, '/'),
  { kind: 'awaitAction', anchor: TOUR_ACTION_ANCHORS.launchRun, at: '/' });
eq('a live run ⇒ go straight to its console',
  tourNavIntent(step('runConsole'), { firstGameId: 'g1', liveRunPath: '/run/g1/r1' }, '/'),
  { kind: 'navigate', to: '/run/g1/r1' });

console.log('\n── 6. totality — the tour must never crash the console ──────────');
let threw = false;
try {
  for (const s of buildTourSteps({ paymentsEnabled: true })) {
    for (const ctx of [NO_GAMES, WITH_GAME, {} as never, undefined as never]) {
      for (const p of ['/', '/gallery', '', undefined as never]) {
        const r = tourNavIntent(s, ctx, p);
        if (!r || typeof r.kind !== 'string') threw = true;
      }
    }
  }
} catch { threw = true; }
ok('every step × context × path yields a valid intent, never a throw', !threw);

// The action anchors must be real `data-tour` values or the spotlight points at
// nothing — the exact failure mode this change exists to remove.
ok('the declared action anchors are non-empty strings',
  Object.values(TOUR_ACTION_ANCHORS).every((a) => typeof a === 'string' && a.length > 0));

console.log('\n── 7. the remembered game id is PER CREATOR ─────────────────────');
// Found by this change, not theorised: signing up a fresh account in a browser
// that had held another one drove the new creator straight into
// /build/<the other account's game> and showed "Game not found". The key was the
// only member of its family that was global — `knownGameCountKey` and
// `tourStorageKey` were scoped from the start. While the Builder step was just an
// optional "take me there" link the same staleness was a dead link nobody
// clicked; auto-navigation turned it into a wall.
ok('two creators never share a first-game key',
  firstGameIdKey('uid-a') !== firstGameIdKey('uid-b'));
ok('the key is namespaced under the legacy global name (so it stays greppable)',
  firstGameIdKey('uid-a').startsWith(TOUR_FIRST_GAME_KEY));
eq('a signed-out reader gets a stable anon bucket, not a crash',
  firstGameIdKey(null), firstGameIdKey(undefined));
ok('the scoped key is never bare-equal to the legacy global key',
  firstGameIdKey('uid-a') !== TOUR_FIRST_GAME_KEY);

console.log('\n── 8. the old target helper still answers the same question ─────');
// tourNavIntent is layered ON TOP of tourStepTarget, not a fork of it.
eq('target for a builder step with a game is unchanged',
  tourStepTarget(step('builderStages'), WITH_GAME), '/build/g1');
eq('target for a builder step with no game is still null',
  tourStepTarget(step('builderStages'), NO_GAMES), null);

if (failures > 0) {
  console.error(`\n✗ ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ tour navigation OK\n');
