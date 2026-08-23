// Pure-logic tests for the held-team notice (change: held-team-visibility).
//
// The motivating dead end: `startTeams` holds back any team that still needs
// guardian consent, tells the ORGANIZER a count, and tells the HELD TEAM nothing.
// That team sits on "waiting for the host to start the race" — a sentence that is
// false for them and that never resolves — while the field walks away.
//
// Three properties are asserted throughout:
//   1. NEVER BLANK — every input, including a reason this app version has never
//      heard of, yields a notice. A held player looking at nothing is the bug.
//   2. NEVER FABRICATED — an unrecognized reason names no cause. The function
//      reports only what the server actually said.
//   3. NO CLOCK — the decision takes state and identities, never an instant, so a
//      skewed phone clock cannot latch a hold notice on. The whole suite re-runs
//      under a stubbed Date.now (±6h) and must not budge.
//
//   npx tsx scripts/test-held-team-notice.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  heldNotice, HELD_HELP_KEY, type HeldKind, type HeldNotice,
} from '../apps/play-web/src/lib/holdNotice';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const here = dirname(fileURLToPath(import.meta.url));

// Every input this suite feeds the function, so the invariants below can sweep
// the whole space rather than the cases someone remembered to list.
type Input = Parameters<typeof heldNotice>[0];
const ALL_INPUTS: { label: string; input: Input }[] = [];
function fixture(label: string, input: Input): Input {
  ALL_INPUTS.push({ label, input });
  return input;
}

// ─── 1. The five mandated cases ───────────────────────────────────────────────
function coreCases(world: string): void {
  // (a) Not held: the run simply has not started for anybody.
  const notHeld = heldNotice(fixture('not held', { launched: false, holdReason: null }));
  check(`[${world}] a team nobody held is not held`, notHeld.kind === 'none' && !notHeld.held, notHeld.kind);
  check(`[${world}] a team nobody held gets no host prompt`, notHeld.offerHelp === false);

  // (b) Held awaiting guardian consent — the one reason that exists today.
  const consent = heldNotice(fixture('held for consent', { launched: false, holdReason: 'guardian_consent' }));
  check(`[${world}] a consent-held team is held`, consent.held === true);
  check(`[${world}] a consent-held team names the consent reason`, consent.kind === 'guardian_consent', consent.kind);
  check(`[${world}] a consent-held team is pointed at the host`, consent.offerHelp === true);
  check(`[${world}] a consent-held team is not blamed`, consent.blameless === true);

  // (c) A reason from a server that is a version ahead of this app. It must NOT
  //     invent a cause, and it must NOT go quiet — quiet is the original bug.
  for (const future of ['age_gate', 'waiver_pending', 'payment', 'GUARDIAN_CONSENT']) {
    const unknown = heldNotice(fixture(`held for future reason ${future}`, { launched: false, holdReason: future }));
    check(`[${world}] unknown reason "${future}" still reads as held`, unknown.held === true, unknown.kind);
    check(`[${world}] unknown reason "${future}" degrades to the generic notice`, unknown.kind === 'unknown', unknown.kind);
    check(`[${world}] unknown reason "${future}" still offers the host`, unknown.offerHelp === true);
  }

  // (d) Held, then released. The launch WINS over a stale/in-flight reason — a
  //     team that is now playing must never be staring at a hold card.
  for (const stale of ['guardian_consent', 'age_gate', null, undefined]) {
    const released = heldNotice(fixture(`released with reason ${String(stale)}`, { launched: true, holdReason: stale }));
    check(`[${world}] a launched team is never held (reason ${String(stale)})`, released.kind === 'none' && !released.held, released.kind);
    check(`[${world}] a launched team gets no host prompt (reason ${String(stale)})`, released.offerHelp === false);
  }

  // (e) Missing state entirely: an older client, an older server, a cold cache.
  //     No information is not evidence of a hold.
  for (const [label, input] of [
    ['undefined input', undefined],
    ['empty object', {}],
    ['explicit undefined reason', { holdReason: undefined }],
    ['launched absent, reason absent', { launched: undefined }],
  ] as [string, Input][]) {
    const silent = heldNotice(fixture(label, input));
    check(`[${world}] ${label} claims no hold`, silent.kind === 'none' && !silent.held, silent.kind);
  }
}

// ─── 2. Degradation — malformed state must never assert a hold cause ──────────
function degradationCases(world: string): void {
  // Non-string reasons. A truthy non-string must not be coerced into a cause,
  // in either direction: it is neither a known reason nor evidence of a hold.
  for (const bad of [0, 1, true, false, {}, [], NaN, Infinity, null]) {
    const r = heldNotice(fixture(`non-string reason ${JSON.stringify(bad) ?? String(bad)}`, { launched: false, holdReason: bad as unknown }));
    check(`[${world}] non-string reason ${String(bad)} claims no hold`, r.kind === 'none' && !r.held, r.kind);
  }
  // Empty and whitespace-only strings are "no reason", not "an unknown reason".
  for (const blank of ['', '   ', '\n', '\t']) {
    const r = heldNotice(fixture(`blank reason ${JSON.stringify(blank)}`, { launched: false, holdReason: blank }));
    check(`[${world}] blank reason ${JSON.stringify(blank)} claims no hold`, r.kind === 'none' && !r.held, r.kind);
  }
  // Only an explicit `true` counts as launched: a truthy non-boolean from a
  // hand-rolled payload must not silently un-hold a held team.
  for (const odd of ['true', 1, {}, [] as unknown]) {
    const r = heldNotice(fixture(`non-boolean launched ${String(odd)}`, { launched: odd as unknown as boolean, holdReason: 'guardian_consent' }));
    check(`[${world}] non-boolean launched ${String(odd)} does not clear the hold`, r.kind === 'guardian_consent' && r.held, r.kind);
  }
  // A whole junk payload still returns a notice rather than throwing.
  for (const junk of [null, 'nonsense', 42, [] as unknown]) {
    let out: HeldNotice | null = null;
    let threw = false;
    try { out = heldNotice(junk as unknown as Input); } catch { threw = true; }
    check(`[${world}] junk payload ${String(junk)} does not throw`, !threw && out !== null);
    check(`[${world}] junk payload ${String(junk)} claims no hold`, out?.kind === 'none', String(out?.kind));
  }
}

// ─── 3. Invariants over EVERY fixture this suite produced ─────────────────────
function invariants(world: string): void {
  const KINDS: HeldKind[] = ['none', 'guardian_consent', 'unknown'];
  let ok = true;
  let detail = '';
  for (const { label, input } of ALL_INPUTS) {
    const r = heldNotice(input);
    const fine =
      KINDS.includes(r.kind) &&
      r.held === (r.kind !== 'none') &&
      r.offerHelp === r.held &&
      r.blameless === true;
    if (!fine) { ok = false; detail = `${label} → ${JSON.stringify(r)}`; break; }
  }
  check(`[${world}] every fixture: kind is known, held ⇔ kind≠none, offerHelp ⇔ held, blameless`, ok, detail);
  check(`[${world}] the host affordance latches onto a stable id`, typeof HELD_HELP_KEY === 'string' && HELD_HELP_KEY.length > 0, HELD_HELP_KEY);
}

function runAllCases(world: string): void {
  coreCases(world);
  degradationCases(world);
  invariants(world);
}

runAllCases('now');

// The decision must be clock-free: a phone hours off must reach the same verdict.
const realNow = Date.now;
try {
  Date.now = () => 0;
  runAllCases('clock epoch');
  Date.now = () => realNow() + 6 * 3600_000;
  runAllCases('clock +6h');
  Date.now = () => realNow() - 6 * 3600_000;
  runAllCases('clock -6h');
} finally {
  Date.now = realNow;
}

// ─── 4. Wiring guards — a pure function nobody calls fixes nothing ────────────
// play-web has no component test runner, so these source assertions are what make
// the RED phase meaningful for the React + server sides.
function read(...parts: string[]): string {
  return readFileSync(join(here, '..', ...parts), 'utf8');
}

const play = read('apps', 'play-web', 'src', 'screens', 'PlayScreen.tsx');
check('PlayScreen imports the held-notice decision', /from '\.\.\/lib\/holdNotice'/.test(play));
check('PlayScreen decides via heldNotice', play.includes('heldNotice('));
check('the held card reads the server reason off the team state', play.includes('holdReason'));
// The whole point: a held team must stop being told the host has not started yet.
const waitingBranch = play.slice(play.indexOf('if (!team.launched)'), play.indexOf('const activeStage ='));
check(
  'the waiting branch no longer shows waitingStart unconditionally',
  waitingBranch.includes('t.play.waitingStart') && /held\s*\?|!held/.test(waitingBranch),
);
check('the held card carries the held copy', waitingBranch.includes('t.play.held'));
// No self-clear: nothing on this screen may grant consent or launch the team.
check(
  'the held card offers no way to clear the hold',
  !/grantGuardianConsent|requestGuardianConsent|startTeams|setLaunched/.test(play),
);

const runs = read('functions', 'src', 'runs', 'index.ts');
check('getMyTeamState ships a holdReason', runs.includes('holdReason'));
check('the hold verdict reuses isConsentSatisfied', runs.includes('isConsentSatisfied('));
// Scoped to the listRunTeams handler: `heldForConsent` already existed as the
// startTeams RETURN COUNT, so an unscoped substring check would pass on day one.
const listRunTeamsSrc = runs.slice(
  runs.indexOf("loggedCallable('listRunTeams'"),
  runs.indexOf("loggedCallable('listRunTeams'") + 4000,
);
check('listRunTeams projects heldForConsent per row', listRunTeamsSrc.includes('heldForConsent:'));
// PII boundary: the reason is a reason, never a guardian's identity.
check(
  'no guardian name is forwarded to explain a hold',
  !/holdReason[\s\S]{0,200}guardianName/.test(runs),
);

const playI18n = read('apps', 'play-web', 'src', 'i18n.ts');
for (const key of ['heldTitle', 'heldConsent', 'heldGeneric', 'heldAskHost']) {
  const hits = playI18n.split(`${key}:`).length - 1;
  check(`play-web i18n defines ${key} in BOTH languages`, hits >= 2, `${hits} occurrence(s)`);
}
const creatorI18n = read('apps', 'creator-web', 'src', 'i18n.ts');
{
  const hits = creatorI18n.split('heldForConsentBadge:').length - 1;
  check('creator-web i18n defines heldForConsentBadge in BOTH languages', hits >= 2, `${hits} occurrence(s)`);
}
const console_ = read('apps', 'creator-web', 'src', 'pages', 'RunConsolePage.tsx');
check('the run console marks WHICH teams are held', console_.includes('team.heldForConsent'));

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
