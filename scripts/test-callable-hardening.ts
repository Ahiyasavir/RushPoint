// Structural guard: EVERY Cloud Function callable satisfies the house hardening
// contract (change: callable-hardening-consistency).
//
// WHY THIS IS A SOURCE SCAN AND NOT 94 UNIT TESTS: the same reasoning that already
// produced functions/src/rateLimitCoverage.test.ts. A per-callable test has to be
// REMEMBERED for each new callable — exactly the discipline that already failed.
// This asserts the invariant over the whole tree, so the 95th callable ships RED
// if it skips the contract, without anyone remembering anything.
//
// The contract (openspec/changes/callable-hardening-consistency/):
//   C1  every callable is built with the observability wrapper (`loggedCallable`),
//       never the raw `functions.https.onCall` — that is what makes structured
//       logging + the maxInstances cost cap structural rather than per-call-site.
//   C2  every callable rejects an unauthenticated caller, directly or through one
//       level of same-file delegation, unless it is DECLARED public with a reason.
//   C3  every callable DECLARED privileged writes a durable auditLogs record,
//       directly or through one level of same-file delegation.
//   C4  every callable is re-exported from functions/src/index.ts, or it silently
//       never deploys (runs/ is re-exported by an explicit NAME LIST, not `export *`).
//   C5  the guard cannot pass vacuously — see the anti-vacuity block at the end.
//
// DELIBERATELY NOT IN THE CONTRACT: rate limiting. 53 of 94 callables enforce no
// bucket and that is correct — creator/staff console operations are driven by an
// authenticated human clicking a button, and several are exactly what an organizer
// must hammer when a live run goes wrong. A guard demanding uniformity there would
// be wrong 53 times, and a guard that is wrong gets overridden. The one rate-limit
// invariant that IS universal (an enforced bucket has a budget) stays owned by
// functions/src/rateLimitCoverage.test.ts.
//
// DOM-free, emulator-free, network-free. Run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-callable-hardening.ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCallables,
  hasAuthAssertion,
  hasAuditWrite,
  findDirectOnCall,
  resolveReexport,
  collectSources,
  moduleSpecifierFor,
  PUBLIC_CALLABLES,
  PRIVILEGED_CALLABLES,
  CALLABLE_FLOOR,
  WRAPPER_MODULE,
} from './lib/callableHardening.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ═════════════════════════════════════════════════════════════════════════════
// LAYER 1 — the analyzer's own decision logic, against SYNTHETIC fixtures.
//
// Nothing below reads the real tree. This is what makes the guard trustworthy:
// a static analyzer whose regex quietly stops matching reports green forever, so
// every decision is asserted in BOTH directions against text we control.
// ═════════════════════════════════════════════════════════════════════════════

console.log('— Layer 1: analyzer decision logic (synthetic fixtures) —');

// ── parseCallables ───────────────────────────────────────────────────────────
{
  const one = `import x from 'y';\nexport const alpha = loggedCallable('alpha', async (data, context) => {\n  return 1;\n});\n`;
  const got = parseCallables(one);
  ok(got.length === 1, 'parseCallables: finds a single declaration');
  ok(got[0]?.name === 'alpha', 'parseCallables: reports the registered name');
  ok(got[0]?.line === 2, 'parseCallables: reports a 1-based line number');

  const two = `export const alpha = loggedCallable('alpha', async (d, c) => {\n  MARKER_A;\n});\n\nexport const beta = loggedCallable('beta', async (d, c) => {\n  MARKER_B;\n});\n`;
  const got2 = parseCallables(two);
  ok(got2.length === 2, 'parseCallables: finds several declarations');
  ok(got2[0].body.includes('MARKER_A'), 'parseCallables: first body holds its own content');
  ok(!got2[0].body.includes('MARKER_B'),
    'parseCallables: a body is sliced at the NEXT declaration, not at end-of-file');
  ok(got2[1].body.includes('MARKER_B'), 'parseCallables: last body runs to end-of-file');

  // The real backfillPublicTaskCoordinatesNow is formatted exactly like this.
  const wrapped = `export const gamma = loggedCallable(\n  'gamma',\n  async (data, context) => {\n    return 1;\n  },\n);\n`;
  ok(parseCallables(wrapped).length === 1, 'parseCallables: tolerates a multi-line declaration');
  ok(parseCallables(wrapped)[0]?.name === 'gamma', 'parseCallables: names a multi-line declaration');

  ok(parseCallables(`// export const ghost = loggedCallable('ghost', async () => {});\n`).length === 0,
    'parseCallables: ignores a commented-out declaration');
  ok(parseCallables(` * loggedCallable(name, fn) wraps functions.https.onCall.\n`).length === 0,
    'parseCallables: ignores a doc-comment mention of the wrapper');
  ok(parseCallables('const notACallable = 1;\n').length === 0,
    'parseCallables: returns empty for a file with no declarations');
}

// ── hasAuthAssertion ─────────────────────────────────────────────────────────
{
  const noFile = '';
  for (const marker of ['requireAuth', 'assertAdmin', 'assertStaffOrOwner', 'assertController']) {
    ok(hasAuthAssertion(`{ const uid = ${marker}(context); }`, noFile),
      `hasAuthAssertion: recognises ${marker}`);
  }
  ok(hasAuthAssertion(
    `{\n  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');\n}`,
    noFile,
  ), 'hasAuthAssertion: recognises the inline !context.auth idiom');

  // One level of same-file delegation — the real pickUpTrackable/dropTrackable shape.
  const delegating = [
    `async function helper(context, action) {`,
    `  const uid = requireAuth(context);`,
    `  return uid;`,
    `}`,
    ``,
    `export const alpha = loggedCallable('alpha', async (data, context) => helper(context, 'pickup'));`,
  ].join('\n');
  const alpha = parseCallables(delegating)[0];
  ok(hasAuthAssertion(alpha.body, delegating),
    'hasAuthAssertion: resolves one level of same-file delegation');

  const delegatingNoAuth = [
    `async function helper(context, action) {`,
    `  return action;`,
    `}`,
    ``,
    `export const alpha = loggedCallable('alpha', async (data, context) => helper(context, 'x'));`,
  ].join('\n');
  ok(!hasAuthAssertion(parseCallables(delegatingNoAuth)[0].body, delegatingNoAuth),
    'hasAuthAssertion: FALSE when the delegate asserts nothing');

  const uncalledHelper = [
    `async function helper(context) { return requireAuth(context); }`,
    ``,
    `export const alpha = loggedCallable('alpha', async (data, context) => 1);`,
  ].join('\n');
  ok(!hasAuthAssertion(parseCallables(uncalledHelper)[0].body, uncalledHelper),
    'hasAuthAssertion: FALSE when the asserting helper is never called');

  ok(!hasAuthAssertion('{ return 1; }', noFile), 'hasAuthAssertion: FALSE for a bare body');
}

// ── hasAuditWrite ────────────────────────────────────────────────────────────
{
  ok(hasAuditWrite(`{ await auditBestEffort({ operatorId: uid }); }`, ''),
    'hasAuditWrite: recognises auditBestEffort');
  ok(hasAuditWrite(`{ await writeAuditLog({ operatorId: uid }); }`, ''),
    'hasAuditWrite: recognises writeAuditLog');

  // The real purgeGameNow shape: the record is written by the helper it calls.
  const viaHelper = [
    `export async function purgeTree(a, b, operatorId) {`,
    `  await auditBestEffort({ operatorId, actionType: 'x' });`,
    `}`,
    ``,
    `export const alpha = loggedCallable('alpha', async (data, context) => {`,
    `  await purgeTree(uid, gameId, uid);`,
    `});`,
  ].join('\n');
  ok(hasAuditWrite(parseCallables(viaHelper)[0].body, viaHelper),
    'hasAuditWrite: resolves one level of same-file delegation');

  const viaSilentHelper = [
    `export async function purgeTree(a, b) { await db.recursiveDelete(a); }`,
    ``,
    `export const alpha = loggedCallable('alpha', async (data, context) => {`,
    `  await purgeTree(uid, gameId);`,
    `});`,
  ].join('\n');
  ok(!hasAuditWrite(parseCallables(viaSilentHelper)[0].body, viaSilentHelper),
    'hasAuditWrite: FALSE when the delegate writes no record');
  ok(!hasAuditWrite('{ return 1; }', ''), 'hasAuditWrite: FALSE for a bare body');
}

// ── findDirectOnCall ─────────────────────────────────────────────────────────
{
  const raw = `export const alpha = functions.https.onCall(async (d, c) => 1);\n`;
  ok(findDirectOnCall(raw).length === 1, 'findDirectOnCall: flags a raw onCall call site');
  ok(findDirectOnCall(raw)[0] === 1, 'findDirectOnCall: reports a 1-based line number');
  ok(findDirectOnCall(`// wraps functions.https.onCall, adding logCall.\n`).length === 0,
    'findDirectOnCall: does not flag a line comment');
  ok(findDirectOnCall(` * Drop-in replacement for functions.https.onCall that adds logging.\n`).length === 0,
    'findDirectOnCall: does not flag a block-comment line');
  ok(findDirectOnCall('const x = 1;\n').length === 0, 'findDirectOnCall: clean file yields nothing');
}

// ── resolveReexport ──────────────────────────────────────────────────────────
{
  const star = `export * from './games/index';\n`;
  ok(resolveReexport(star, './games/index')?.kind === 'star',
    'resolveReexport: recognises a wholesale re-export');
  ok(resolveReexport(star, './runs/index') === null,
    'resolveReexport: a module never referenced resolves to nothing');

  const named = `export {\n  launchRun, joinRun,\n  finalizeRun,\n} from './runs/index';\n`;
  const r = resolveReexport(named, './runs/index');
  ok(r?.kind === 'names', 'resolveReexport: recognises an explicit name list');
  ok(r?.kind === 'names' && r.names.has('launchRun') && r.names.has('finalizeRun'),
    'resolveReexport: parses a multi-line name list');
  ok(r?.kind === 'names' && !r.names.has('completeTaskForTeam'),
    'resolveReexport: an unlisted name is NOT covered');

  // Regression: functions/src/index.ts holds SEVERAL adjacent `export { … } from`
  // blocks. A lazy dot-all match spans from an earlier block's opening brace to
  // this block's closing one, gluing `} from '…';\nexport {` onto the first name
  // of the later block and dropping it — which reported launchRun and getWallet
  // as never deployed. Both directions asserted so the fix cannot silently rot.
  const adjacent = [
    `export { updateMyProfile, deleteMyAccount } from './users/index';`,
    `export {`,
    `  getWallet, purchaseCredits,`,
    `} from './payments/index';`,
  ].join('\n');
  const pay = resolveReexport(adjacent, './payments/index');
  ok(pay?.kind === 'names' && pay.names.has('getWallet'),
    'resolveReexport: the FIRST name of a later block is not swallowed');
  ok(pay?.kind === 'names' && !pay.names.has('updateMyProfile'),
    'resolveReexport: names do not bleed in from a preceding block');
}

// ═════════════════════════════════════════════════════════════════════════════
// LAYER 2 — the contract, over the REAL functions/src/**.
// ═════════════════════════════════════════════════════════════════════════════

console.log('— Layer 2: the contract over functions/src/** —');

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'functions', 'src');

// C5 (anti-vacuity, first): a wrong path makes every assertion below pass over an
// empty set. Assert the scan target exists BEFORE trusting anything it reports.
ok(existsSync(SRC), `anti-vacuity: functions source tree exists at ${SRC}`);

const sources = existsSync(SRC) ? collectSources(SRC) : [];
const indexText = existsSync(path.join(SRC, 'index.ts'))
  ? readFileSync(path.join(SRC, 'index.ts'), 'utf8')
  : '';

interface Found { rel: string; line: number; name: string; body: string; text: string }
const callables: Found[] = [];
for (const src of sources) {
  for (const c of parseCallables(src.text)) {
    callables.push({ rel: src.rel, line: c.line, name: c.name, body: c.body, text: src.text });
  }
}

// C5 (anti-vacuity): a scan that finds implausibly few callables has rotted.
ok(callables.length >= CALLABLE_FLOOR,
  `anti-vacuity: found ${callables.length} callables, expected >= ${CALLABLE_FLOOR}`);

// C1 — no raw onCall outside the module that defines the wrapper.
{
  const offenders: string[] = [];
  for (const src of sources) {
    if (src.rel === WRAPPER_MODULE) continue;
    for (const line of findDirectOnCall(src.text)) offenders.push(`${src.rel}:${line}`);
  }
  ok(offenders.length === 0,
    `C1: every callable uses the observability wrapper — raw onCall at ${offenders.join(', ')}`);
}

// C2 — identity assertion, or a declared public exemption.
{
  const offenders: string[] = [];
  for (const c of callables) {
    if (PUBLIC_CALLABLES[c.name]) continue;
    if (!hasAuthAssertion(c.body, c.text)) offenders.push(`${c.rel}:${c.line} ${c.name}`);
  }
  ok(offenders.length === 0,
    `C2: every callable asserts identity or is declared public — missing: ${offenders.join(', ')}`);
}

// C3 — declared-privileged callables write a durable audit record.
{
  const offenders: string[] = [];
  for (const c of callables) {
    if (!PRIVILEGED_CALLABLES[c.name]) continue;
    if (!hasAuditWrite(c.body, c.text)) offenders.push(`${c.rel}:${c.line} ${c.name}`);
  }
  ok(offenders.length === 0,
    `C3: every privileged callable writes an audit record — missing: ${offenders.join(', ')}`);
}

// C4 — reachable from the entry point, or it never deploys.
{
  const offenders: string[] = [];
  for (const c of callables) {
    if (c.rel === 'index.ts') continue; // the entry point exports its own directly
    const spec = moduleSpecifierFor(c.rel);
    const r = resolveReexport(indexText, spec);
    if (r === null) { offenders.push(`${c.rel}:${c.line} ${c.name} (module ${spec} not re-exported)`); continue; }
    if (r.kind === 'names' && !r.names.has(c.name)) {
      offenders.push(`${c.rel}:${c.line} ${c.name} (absent from the explicit list)`);
    }
  }
  ok(offenders.length === 0,
    `C4: every callable is re-exported from functions/src/index.ts — unreachable: ${offenders.join(', ')}`);
}

// C5 — a declared exemption that no longer names a real callable is a dead
// exemption; it must fail rather than silently keep excusing nothing.
{
  const names = new Set(callables.map((c) => c.name));
  const stalePublic = Object.keys(PUBLIC_CALLABLES).filter((n) => !names.has(n));
  const stalePriv = Object.keys(PRIVILEGED_CALLABLES).filter((n) => !names.has(n));
  ok(stalePublic.length === 0, `C5: no stale PUBLIC_CALLABLES entries — ${stalePublic.join(', ')}`);
  ok(stalePriv.length === 0, `C5: no stale PRIVILEGED_CALLABLES entries — ${stalePriv.join(', ')}`);
  const unreasoned = [...Object.entries(PUBLIC_CALLABLES), ...Object.entries(PRIVILEGED_CALLABLES)]
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 10)
    .map(([n]) => n);
  ok(unreasoned.length === 0, `C5: every exemption carries a written reason — ${unreasoned.join(', ')}`);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} callable hardening: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
