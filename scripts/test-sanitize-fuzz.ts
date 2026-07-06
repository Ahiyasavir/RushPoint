// Sanitizer PROPERTY fuzz — the adversarial complement to the two example-based
// sanitizer tests (test-sanitize-task.ts = known keys stripped; test-sanitize-
// coverage.ts = type-drift guard on secret-NAMED fields). Both build ONE hand-
// authored task. This one hammers sanitizeTaskForParticipant with thousands of
// RANDOM adversarial task shapes and asserts the security + robustness invariants
// hold on EVERY one — catching leaks that only surface under a particular COMBO of
// fields, and crashes on malformed input (a throw here = getMyTeamState 500s and no
// participant can load a task).
//
// Each iteration plants a UNIQUE sentinel in every secret field that is present, so
// a leak via ANY code path (not just a new named field) is caught by a deep scan of
// the output. Deterministic: a seeded LCG drives every choice, so a failure prints
// the exact seed + offending task and reproduces on the next run.
//
// No emulator — pure function under test.
//   npx tsx scripts/test-sanitize-fuzz.ts
import { sanitizeTaskForParticipant } from '../functions/src/runs/sanitizeTask';
import type { Task, TaskType } from '../packages/shared/src/types';

const ITERATIONS = 5000;

// ── Seeded RNG (reproducible; same LCG as simulate-run.mjs) ───────────────────
let _seed = 20260705;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const chance = (p: number) => rand() < p;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const TYPES: TaskType[] = [
  'field', 'self_report', 'smart_station', 'photo', 'quiz', 'numeric', 'geofence', 'sequence',
];

// A grab-bag of hostile values to slot into fields at random, to prove the
// sanitizer never throws regardless of what a corrupt document holds.
const GARBAGE: unknown[] = [
  undefined, null, '', 0, NaN, -1, [], {}, [null], [{ answer: 'X' }],
  { lat: NaN, lng: NaN }, 'not-an-object', true, false,
];

// The secret sentinel prefix — any occurrence of this in the OUTPUT is a leak.
const SEC = 'SECRETLEAK';
// Secret object-key names that must never appear anywhere in the output.
const SECRET_KEYS = ['secretCode', 'adminNotes', 'answers', 'numericAnswer', 'hint'];
// The distinctive numeric-answer sentinel (numericAnswer is the one secret number).
const NUM_SENTINEL = 987654321;

let n = 0; // unique-sentinel counter → each planted secret is individually traceable
const secret = (tag: string) => `${SEC}_${tag}_${n++}`;

// Build a random, possibly-malformed Task. Every secret field that we DO populate
// gets a unique sentinel; a random subset of fields is garbage-filled to probe
// robustness. Returns { task, plantedHint } so the caller can assert hasHint.
function randomTask(): { task: Record<string, unknown>; plantedHintText: string | null } {
  const type = pick(TYPES);
  const t: Record<string, unknown> = {
    id: `t${int(1, 9999)}`,
    title: chance(0.9) ? `KEEPTITLE_${n}` : pick(GARBAGE),
    type,
    coordinates: chance(0.85) ? { lat: rand() * 180 - 90, lng: rand() * 360 - 180 } : pick(GARBAGE),
    difficulty: int(1, 10),
    estimatedMinutes: int(1, 90),
    pointValue: int(0, 500),
    maxConcurrentTeams: int(1, 8),
  };

  // ── Secret fields — plant sentinels only when present ──
  let plantedHintText: string | null = null;
  if (chance(0.5)) { plantedHintText = secret('hint'); t.hint = plantedHintText; }
  else if (chance(0.15)) { t.hint = pick(['', '   ']); } // present-but-empty → hasHint must be false
  if (chance(0.5)) t.answers = [secret('answer'), secret('answer')];
  if (chance(0.4)) t.numericAnswer = NUM_SENTINEL;
  if (chance(0.5)) {
    const stepCount = int(0, 4);
    t.steps = Array.from({ length: stepCount }, (_, i) => ({
      id: `s${i}`,
      prompt: `KEEPPROMPT_${n++}`,
      ...(chance(0.7) ? { answer: secret('stepanswer') } : {}),
    }));
  }

  // ── smart config — secretCode + adminNotes are the secrets ──
  if (chance(0.5)) {
    const smart: Record<string, unknown> = {
      enabled: true,
      verificationType: pick(['code_verification', 'photo_upload', 'self_report']),
    };
    if (chance(0.7)) smart.secretCode = secret('code');
    if (chance(0.5)) smart.adminNotes = secret('admin');
    if (chance(0.5)) smart.longInstructions = `KEEPINSTR_${n}`; // non-secret → should survive
    if (chance(0.4)) smart.stationCoords = { lat: rand() * 180 - 90, lng: rand() * 360 - 180 };
    if (chance(0.3)) smart.autoApprove = chance(0.5);
    if (chance(0.2)) smart[`junk${int(1, 9)}`] = pick(GARBAGE); // unknown key must be dropped
    t.smart = smart;
  }

  // ── Orthogonal flags + non-secret pass-through fields ──
  if (chance(0.4)) t.hideLocation = true;
  if (chance(0.2)) t.locationless = true;
  if (chance(0.3)) t.locationClue = `KEEPCLUE_${n}`;   // free clue — MUST survive
  if (chance(0.3)) t.choices = [`KEEPCHOICE_${n}`];    // quiz choices — MUST survive
  if (chance(0.3)) t.geofenceRadiusMeters = int(10, 500);
  if (chance(0.2)) t.numericTolerance = int(0, 5);
  if (chance(0.2)) t.media = [{ id: 'm1', kind: 'image', url: 'https://x/y.jpg', caption: `KEEPCAP_${n}` }];
  // Inject a random unknown top-level key holding garbage, to probe pass-through.
  if (chance(0.25)) t[`x${int(1, 99)}`] = pick(GARBAGE);

  return { task: t, plantedHintText };
}

// Deep-walk: collect every object key name and stringify for value scanning.
function allKeys(obj: unknown, acc: string[] = []): string[] {
  if (Array.isArray(obj)) { for (const v of obj) allKeys(v, acc); }
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) { acc.push(k); allKeys(v, acc); }
  }
  return acc;
}

let failures = 0;
const seen = { hideLocation: 0, withHint: 0, withSmart: 0, withSteps: 0, garbageCoords: 0 };

for (let i = 0; i < ITERATIONS; i++) {
  const { task, plantedHintText } = randomTask();
  if (task.hideLocation) seen.hideLocation++;
  if (plantedHintText) seen.withHint++;
  if (task.smart) seen.withSmart++;
  if (Array.isArray(task.steps) && task.steps.length) seen.withSteps++;
  if (task.coordinates && typeof task.coordinates !== 'object') seen.garbageCoords++;

  let out: unknown;
  try {
    out = sanitizeTaskForParticipant(task as unknown as Task);
  } catch (e) {
    failures++;
    console.log(`FAIL  iteration ${i}: sanitizer THREW :: ${(e as Error).message}`);
    console.log(`      task = ${JSON.stringify(task)}`);
    continue;
  }

  const json = JSON.stringify(out) ?? '';

  // INVARIANT 1 — no secret sentinel value leaks anywhere in the payload.
  if (json.includes(SEC)) {
    failures++;
    console.log(`FAIL  iteration ${i}: SECRET VALUE LEAKED`);
    console.log(`      in  = ${JSON.stringify(task)}`);
    console.log(`      out = ${json}`);
  }
  // INVARIANT 2 — the numeric-answer sentinel never leaks.
  if (json.includes(String(NUM_SENTINEL))) {
    failures++;
    console.log(`FAIL  iteration ${i}: numericAnswer LEAKED :: ${json}`);
  }
  // INVARIANT 3 — no secret key name survives anywhere in the output tree.
  const keys = allKeys(out);
  for (const bad of SECRET_KEYS) {
    if (keys.includes(bad)) {
      failures++;
      console.log(`FAIL  iteration ${i}: secret KEY "${bad}" present in output :: ${json}`);
    }
  }
  // INVARIANT 4 — hidden-location tasks never expose coords/radius, and flag it.
  if (task.hideLocation) {
    const o = out as Record<string, unknown>;
    if ('coordinates' in o) { failures++; console.log(`FAIL  iteration ${i}: hideLocation but coordinates present`); }
    if (o.locationHidden !== true) { failures++; console.log(`FAIL  iteration ${i}: hideLocation but locationHidden!=true`); }
    const sm = o.smart as Record<string, unknown> | undefined;
    if (sm && 'stationCoords' in sm && sm.stationCoords !== undefined) {
      failures++; console.log(`FAIL  iteration ${i}: hideLocation but smart.stationCoords present`);
    }
  }
  // INVARIANT 5 — hasHint is true IFF a non-empty hint was planted; the text never leaks.
  const hasHint = (out as Record<string, unknown>).hasHint;
  const expectHint = !!(plantedHintText && plantedHintText.trim().length > 0);
  if (hasHint !== expectHint) {
    failures++;
    console.log(`FAIL  iteration ${i}: hasHint=${hasHint} expected ${expectHint}`);
  }
}

console.log(`\nFuzzed ${ITERATIONS} random task shapes ` +
  `(hidden=${seen.hideLocation}, hint=${seen.withHint}, smart=${seen.withSmart}, ` +
  `steps=${seen.withSteps}, garbage-coords=${seen.garbageCoords}).`);
console.log(failures === 0
  ? '✅ ALL SANITIZER-FUZZ INVARIANTS HELD — no leak, no crash, across every shape'
  : `❌ ${failures} invariant violation(s) — see above (seed 20260705 reproduces)`);
process.exit(failures === 0 ? 0 : 1);
