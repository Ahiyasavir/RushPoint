// Structural guard: the Cloud Functions COST CAP cannot silently regress
// (change: cost-containment-max-instances).
//
// WHY THIS EXISTS: `functions/src/obs/log.ts` bounds all ~96 callables at
// DEFAULT_MAX_INSTANCES by construction — `loggedCallable` is the only constructor,
// and it routes every one of them through `functions.runWith(resolveRuntimeOpts(…))`.
// A property that holds by construction is exactly the property that disappears in
// one line, and until now that line was protected by NOTHING: delete
// resolveRuntimeOpts from the wrapper and every gate in this repo still reports
// green while ninety-six functions become free to scale to the project ceiling. The
// bill is the only test that would have failed, and it fails after the money is
// spent.
//
// The contract:
//   K1  obs/log.ts still declares a default maxInstances, and it is a positive,
//       finite number at or below MAX_INSTANCES_CEILING (a "cap" of 5000 is not a
//       cap — it is the project ceiling with extra steps).
//   K2  resolveRuntimeOpts still MERGES that default, caller opts spread over it.
//   K2b every entry of HOT_PATH_MAX_INSTANCES — the per-callable ceilings that
//       raise the hot paths above the (deliberately low) default — is itself a
//       positive, finite number at or below the same ceiling, and the map is
//       actually consulted when a callable is built. Raising one callable is a
//       routine edit, so the map is where a bill-sized number is most likely to be
//       typed: `requestNextTask: 1000` reads like ordinary tuning.
//   K3  loggedCallable still WIRES it — runWith(resolveRuntimeOpts(…)). A cap that
//       exists but is not wired is the silent failure this guard is named after.
//   K4  no module outside the wrapper deploys a function without a cap: no bare
//       onCall, and no runWith whose options pin no usable maxInstances (which
//       covers onRequest/schedule endpoints the callable-only guards never see).
//   K5  the guard cannot pass vacuously — see the anti-vacuity block.
//
// LAYER 1 drives every predicate in BOTH directions against SYNTHETIC text, so an
// analyzer that has stopped matching fails LOUDLY instead of agreeing that zero of
// zero call sites are uncapped. LAYER 2 then asserts the real tree passes today.
//
// DOM-free, emulator-free, network-free. Run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-cost-guards.ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSources } from './lib/callableHardening.mjs';
import {
  extractDefaultMaxInstances,
  extractHotPathMaxInstances,
  findHotPathViolations,
  wrapperConsultsHotPath,
  resolveRuntimeOptsIsCapped,
  wrapperAppliesCap,
  findUncappedOnCallSites,
  countCappedCallSites,
  MAX_INSTANCES_CEILING,
  CAPPED_CALLABLE_FLOOR,
  HOT_PATH_ENTRY_FLOOR,
  WRAPPER_MODULE,
} from './lib/costGuards.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ═════════════════════════════════════════════════════════════════════════════
// LAYER 1 — the analyzer's own decision logic, against SYNTHETIC fixtures.
// Nothing below reads the real tree.
// ═════════════════════════════════════════════════════════════════════════════

console.log('— Layer 1: analyzer decision logic (synthetic fixtures) —');

// The wrapper module as it is written today, reduced to the three lines that carry
// the cost property. Written out as a LITERAL on purpose: reading the real file and
// comparing it to itself would pass no matter what the real file said.
const CAPPED_WRAPPER = [
  `import * as functions from 'firebase-functions';`,
  ``,
  `export const DEFAULT_MAX_INSTANCES = 10;`,
  ``,
  `export function resolveRuntimeOpts(runtimeOpts?: functions.RuntimeOptions): functions.RuntimeOptions {`,
  `  return { maxInstances: DEFAULT_MAX_INSTANCES, ...runtimeOpts };`,
  `}`,
  ``,
  `export function loggedCallable(name, handler, runtimeOpts?) {`,
  `  return functions.runWith(resolveRuntimeOpts(runtimeOpts)).https.onCall(async (data, context) =>`,
  `    logCall({ callable: name }, async () => handler(data, context)),`,
  `  );`,
  `}`,
].join('\n');

// ── K1: extractDefaultMaxInstances ───────────────────────────────────────────
{
  ok(extractDefaultMaxInstances(CAPPED_WRAPPER) === 10,
    'extractDefaultMaxInstances: reads the literal from the capped wrapper');
  ok(extractDefaultMaxInstances('export const DEFAULT_MAX_INSTANCES: number = 25;') === 25,
    'extractDefaultMaxInstances: tolerates an explicit type annotation');

  // (a) The constant deleted outright — the whole declaration gone.
  const deleted = CAPPED_WRAPPER.replace('export const DEFAULT_MAX_INSTANCES = 10;\n', '');
  ok(extractDefaultMaxInstances(deleted) === null,
    'extractDefaultMaxInstances: NULL when the declaration is deleted');
  ok(extractDefaultMaxInstances('// export const DEFAULT_MAX_INSTANCES = 10;\n') === null,
    'extractDefaultMaxInstances: NULL for a commented-out declaration');
  ok(extractDefaultMaxInstances(' * export const DEFAULT_MAX_INSTANCES = 10 by default.\n') === null,
    'extractDefaultMaxInstances: NULL for a doc-comment mention');
  ok(extractDefaultMaxInstances('export const DEFAULT_MAX_INSTANCES = someImportedValue;') === null,
    'extractDefaultMaxInstances: NULL for a non-literal it cannot read');
  ok(extractDefaultMaxInstances('const OTHER = 10;') === null,
    'extractDefaultMaxInstances: NULL for an unrelated file');
}

// ── K1/K2: resolveRuntimeOptsIsCapped ────────────────────────────────────────
{
  ok(resolveRuntimeOptsIsCapped(CAPPED_WRAPPER) === true,
    'resolveRuntimeOptsIsCapped: TRUE for the capped wrapper');
  ok(resolveRuntimeOptsIsCapped(CAPPED_WRAPPER.replace('= 10;', '= 1;')) === true,
    'resolveRuntimeOptsIsCapped: TRUE for any positive default within the ceiling');
  ok(resolveRuntimeOptsIsCapped(
    CAPPED_WRAPPER.replace('maxInstances: DEFAULT_MAX_INSTANCES', 'maxInstances: 12'),
  ) === true, 'resolveRuntimeOptsIsCapped: TRUE for an inline literal default');

  // (a) The constant deleted and the merge left referring to nothing readable.
  ok(resolveRuntimeOptsIsCapped(
    CAPPED_WRAPPER.replace('export const DEFAULT_MAX_INSTANCES = 10;\n', ''),
  ) === false, 'resolveRuntimeOptsIsCapped: FALSE once DEFAULT_MAX_INSTANCES is deleted');

  // The de-capping edit: the merge itself removed, opts passed straight through.
  ok(resolveRuntimeOptsIsCapped(
    CAPPED_WRAPPER.replace('{ maxInstances: DEFAULT_MAX_INSTANCES, ...runtimeOpts }', '{ ...runtimeOpts }'),
  ) === false, 'resolveRuntimeOptsIsCapped: FALSE when the default is no longer merged');

  // The whole function gone.
  ok(resolveRuntimeOptsIsCapped('export const DEFAULT_MAX_INSTANCES = 10;') === false,
    'resolveRuntimeOptsIsCapped: FALSE when the function does not exist');

  // Order inverted — the caller can no longer raise its own ceiling.
  ok(resolveRuntimeOptsIsCapped(
    CAPPED_WRAPPER.replace(
      '{ maxInstances: DEFAULT_MAX_INSTANCES, ...runtimeOpts }',
      '{ ...runtimeOpts, maxInstances: DEFAULT_MAX_INSTANCES }',
    ),
  ) === false, 'resolveRuntimeOptsIsCapped: FALSE when caller opts can no longer override');

  // A "cap" that is not a cap.
  ok(resolveRuntimeOptsIsCapped(CAPPED_WRAPPER.replace('= 10;', '= 5000;')) === false,
    `resolveRuntimeOptsIsCapped: FALSE above MAX_INSTANCES_CEILING (${MAX_INSTANCES_CEILING})`);
  ok(resolveRuntimeOptsIsCapped(CAPPED_WRAPPER.replace('= 10;', '= 0;')) === false,
    'resolveRuntimeOptsIsCapped: FALSE for a zero default');
  ok(resolveRuntimeOptsIsCapped(CAPPED_WRAPPER.replace('= 10;', '= -1;')) === false,
    'resolveRuntimeOptsIsCapped: FALSE for a negative default');
}

// ── K2b: the per-callable hot-path ceilings ──────────────────────────────────

// The hot-path half of the wrapper, again written as a LITERAL: the point is to
// drive the analyzer over text this file controls, so a regex that has stopped
// matching the real map cannot report green by reading the real map.
const HOT_WRAPPER = [
  `export const DEFAULT_MAX_INSTANCES = 3;`,
  ``,
  `export const HOT_PATH_MAX_INSTANCES: Record<string, number> = {`,
  `  // Per player, per task — the true hot loop.`,
  `  requestNextTask: 10,`,
  `  completeTask: 10,`,
  `  updateLocation: 10,`,
  `};`,
  ``,
  `export function resolveRuntimeOpts(runtimeOpts?: functions.RuntimeOptions): functions.RuntimeOptions {`,
  `  return { maxInstances: DEFAULT_MAX_INSTANCES, ...runtimeOpts };`,
  `}`,
  ``,
  `export function withHotPathCeiling(name, runtimeOpts?) {`,
  `  const hot = HOT_PATH_MAX_INSTANCES[name];`,
  `  if (typeof hot !== 'number') return runtimeOpts;`,
  `  return { maxInstances: hot, ...runtimeOpts };`,
  `}`,
  ``,
  `export function loggedCallable(name, handler, runtimeOpts?) {`,
  `  return functions.runWith(resolveRuntimeOpts(withHotPathCeiling(name, runtimeOpts))).https.onCall(h);`,
  `}`,
].join('\n');

{
  const entries = extractHotPathMaxInstances(HOT_WRAPPER);
  ok(Array.isArray(entries) && entries.length === 3,
    `extractHotPathMaxInstances: reads every entry (got ${entries?.length})`);
  ok(entries?.[0]?.name === 'requestNextTask' && entries?.[0]?.value === 10,
    'extractHotPathMaxInstances: reads name and numeric value');
  ok(entries?.some((e) => e.name === 'updateLocation'),
    'extractHotPathMaxInstances: reads the last entry too');
  ok(!entries?.some((e) => e.name === 'Per' || e.name === 'task'),
    'extractHotPathMaxInstances: does not mistake a comment inside the map for an entry');
  ok(extractHotPathMaxInstances(CAPPED_WRAPPER) === null,
    'extractHotPathMaxInstances: NULL when the map is not declared at all');
  ok(extractHotPathMaxInstances(`// export const HOT_PATH_MAX_INSTANCES = { a: 10 };\n`) === null,
    'extractHotPathMaxInstances: NULL for a commented-out declaration');
  ok(extractHotPathMaxInstances(`export const HOT_PATH_MAX_INSTANCES = { a: 10,\n`) === null,
    'extractHotPathMaxInstances: NULL when the braces never balance');
  ok(extractHotPathMaxInstances(`export const HOT_PATH_MAX_INSTANCES = {};\n`)?.length === 0,
    'extractHotPathMaxInstances: an empty map reads as zero entries, not as absent');
  ok(extractHotPathMaxInstances(`export const HOT_PATH_MAX_INSTANCES = { a: someImported };\n`)?.[0]?.value === null,
    'extractHotPathMaxInstances: a non-literal value reads as unreadable, not as a number');

  // findHotPathViolations — the assertion this block exists for.
  ok(findHotPathViolations(entries).length === 0,
    'findHotPathViolations: a map of sane ceilings is clean');
  ok(findHotPathViolations(null).length === 0,
    'findHotPathViolations: an absent map is not an offence (everything falls back to the default)');
  ok(findHotPathViolations([]).length === 0,
    'findHotPathViolations: an empty map is not an offence');

  const typo = extractHotPathMaxInstances(HOT_WRAPPER.replace('requestNextTask: 10,', 'requestNextTask: 1000,'));
  const typoHits = findHotPathViolations(typo);
  ok(typoHits.length === 1 && typoHits[0]?.name === 'requestNextTask',
    `findHotPathViolations: a typo'd 1000 in the map is an offence (ceiling ${MAX_INSTANCES_CEILING})`);
  ok(findHotPathViolations([{ name: 'x', value: MAX_INSTANCES_CEILING }]).length === 0,
    'findHotPathViolations: exactly at the ceiling is allowed');
  ok(findHotPathViolations([{ name: 'x', value: MAX_INSTANCES_CEILING + 1 }]).length === 1,
    'findHotPathViolations: one over the ceiling is an offence');
  ok(findHotPathViolations([{ name: 'x', value: 0 }]).length === 1,
    'findHotPathViolations: a zero ceiling is an offence');
  ok(findHotPathViolations([{ name: 'x', value: -1 }]).length === 1,
    'findHotPathViolations: a negative ceiling is an offence');
  ok(findHotPathViolations([{ name: 'x', value: null }]).length === 1,
    'findHotPathViolations: an unreadable value is an offence, not a pass');

  // The map must be READ, not merely declared.
  ok(wrapperConsultsHotPath(HOT_WRAPPER) === true,
    'wrapperConsultsHotPath: TRUE when loggedCallable folds the map in via withHotPathCeiling');
  ok(wrapperConsultsHotPath(CAPPED_WRAPPER) === false,
    'wrapperConsultsHotPath: FALSE for a wrapper that has no hot-path helper at all');
  ok(wrapperConsultsHotPath(
    HOT_WRAPPER.replace('resolveRuntimeOpts(withHotPathCeiling(name, runtimeOpts))', 'resolveRuntimeOpts(runtimeOpts)'),
  ) === false, 'wrapperConsultsHotPath: FALSE when loggedCallable stops calling the helper');
  ok(wrapperConsultsHotPath(
    HOT_WRAPPER.replace('const hot = HOT_PATH_MAX_INSTANCES[name];', 'const hot = undefined;'),
  ) === false, 'wrapperConsultsHotPath: FALSE when the helper stops reading the map');
  ok(wrapperConsultsHotPath(
    HOT_WRAPPER.replace('{ maxInstances: hot, ...runtimeOpts }', '{ ...runtimeOpts, maxInstances: hot }'),
  ) === false, 'wrapperConsultsHotPath: FALSE when an explicit call-site maxInstances can no longer win');

  // The hot-path change must not have disturbed K2/K3 on the same text.
  ok(resolveRuntimeOptsIsCapped(HOT_WRAPPER) === true,
    'resolveRuntimeOptsIsCapped: still TRUE for the hot-path-aware wrapper');
  ok(wrapperAppliesCap(HOT_WRAPPER) === true,
    'wrapperAppliesCap: still TRUE for the hot-path-aware wrapper');
}

// ── K3: wrapperAppliesCap ────────────────────────────────────────────────────
{
  ok(wrapperAppliesCap(CAPPED_WRAPPER) === true,
    'wrapperAppliesCap: TRUE when loggedCallable wires resolveRuntimeOpts into runWith');

  // (b) The regression this predicate is named after: the cap still exists, still
  // reads as deliberate cost containment in review, and caps nothing.
  ok(wrapperAppliesCap(
    CAPPED_WRAPPER.replace('functions.runWith(resolveRuntimeOpts(runtimeOpts)).https.onCall', 'functions.https.onCall'),
  ) === false, 'wrapperAppliesCap: FALSE when runWith is dropped from the wrapper');
  ok(wrapperAppliesCap(
    CAPPED_WRAPPER.replace('runWith(resolveRuntimeOpts(runtimeOpts))', 'runWith(runtimeOpts)'),
  ) === false, 'wrapperAppliesCap: FALSE when runWith bypasses resolveRuntimeOpts');
  ok(wrapperAppliesCap(
    CAPPED_WRAPPER.replace('export function loggedCallable', 'export function somethingElse'),
  ) === false, 'wrapperAppliesCap: FALSE when loggedCallable does not exist');
  // The call must be inside loggedCallable, not merely somewhere in the file.
  ok(wrapperAppliesCap(
    `const x = functions.runWith(resolveRuntimeOpts(o)).https.onRequest(h);\nexport function loggedCallable(n, h) {\n  return functions.https.onCall(h);\n}\n`,
  ) === false, 'wrapperAppliesCap: FALSE when the wiring lives outside loggedCallable');
}

// ── K4: findUncappedOnCallSites ──────────────────────────────────────────────
{
  const clean = [
    { rel: WRAPPER_MODULE, text: CAPPED_WRAPPER },
    { rel: 'runs/index.ts', text: `export const launchRun = loggedCallable('launchRun', async (d, c) => 1);\n` },
  ];
  ok(findUncappedOnCallSites(clean).length === 0,
    'findUncappedOnCallSites: a wrapper-only tree is clean');

  // (c) A new bare callable in another module — the wrapper is intact, so nothing
  // else in the repo has any reason to complain about this one.
  const bare = [
    ...clean,
    { rel: 'runs/index.ts', text: `export const oops = functions.https.onCall(async (d, c) => 1);\n` },
  ];
  const bareHits = findUncappedOnCallSites(bare);
  ok(bareHits.length === 1, 'findUncappedOnCallSites: flags a bare functions.https.onCall');
  ok(bareHits[0]?.kind === 'raw-onCall' && bareHits[0]?.rel === 'runs/index.ts' && bareHits[0]?.line === 1,
    'findUncappedOnCallSites: reports kind, module and a 1-based line');
  ok(findUncappedOnCallSites([{ rel: 'a.ts', text: `export const oops = https.onCall(h);\n` }]).length === 1,
    'findUncappedOnCallSites: flags a bare onCall written without the functions. prefix');

  // The wrapper module is allowed to name the primitives it defines.
  ok(findUncappedOnCallSites([{ rel: WRAPPER_MODULE, text: `functions.https.onCall(h);\n` }]).length === 0,
    'findUncappedOnCallSites: exempts the wrapper module');

  // Comments are not call sites.
  ok(findUncappedOnCallSites([{ rel: 'a.ts', text: `// drop-in for functions.https.onCall, adds logging\n` }]).length === 0,
    'findUncappedOnCallSites: does not flag a line comment');
  ok(findUncappedOnCallSites([{ rel: 'a.ts', text: ` * wraps functions.runWith(opts).https.onCall.\n` }]).length === 0,
    'findUncappedOnCallSites: does not flag a block-comment line');

  // runWith present but pinning nothing — the onRequest/schedule shape.
  const uncappedOpts = [{ rel: 'payments/index.ts', text: `export const hook = functions.runWith({ timeoutSeconds: 120 }).https.onRequest(h);\n` }];
  const optHits = findUncappedOnCallSites(uncappedOpts);
  ok(optHits.length === 1 && optHits[0].kind === 'uncapped-runWith',
    'findUncappedOnCallSites: flags runWith options with no maxInstances');

  ok(findUncappedOnCallSites([{ rel: 'p.ts', text: `functions.runWith({ maxInstances: DEFAULT_MAX_INSTANCES }).https.onRequest(h);\n` }]).length === 0,
    'findUncappedOnCallSites: accepts runWith pinned to DEFAULT_MAX_INSTANCES');
  ok(findUncappedOnCallSites([{ rel: 'p.ts', text: `functions.runWith({ memory: '512MB', maxInstances: 3 }).https.onCall(h);\n` }]).length === 0,
    'findUncappedOnCallSites: accepts a runWith-capped onCall');
  ok(findUncappedOnCallSites([{ rel: 'p.ts', text: `functions.runWith({ maxInstances: 5000 }).https.onCall(h);\n` }]).length === 1,
    'findUncappedOnCallSites: a cap above the ceiling is not a cap');
  ok(findUncappedOnCallSites([{ rel: 'p.ts', text: `functions.runWith({ maxInstances: whateverTheyImported }).https.onCall(h);\n` }]).length === 1,
    'findUncappedOnCallSites: an unreadable maxInstances value is an offence, not a pass');
  // Multi-line chains are the house formatting for heavier callables.
  ok(findUncappedOnCallSites([{ rel: 'p.ts', text: `export const heavy = functions\n  .runWith({ maxInstances: 4, memory: '1GB' })\n  .https.onCall(async (d, c) => 1);\n` }]).length === 0,
    'findUncappedOnCallSites: judges a multi-line runWith(...).onCall chain as one statement');
}

// ── K5: anti-vacuity, proven on synthetic text ───────────────────────────────
{
  ok(countCappedCallSites([{ rel: 'runs/index.ts', text: `export const a = loggedCallable('a', h);\nexport const b = loggedCallable('b', h);\n` }]) === 2,
    'countCappedCallSites: counts wrapper call sites');
  ok(countCappedCallSites([{ rel: 'runs/index.ts', text: `// export const a = loggedCallable('a', h);\n` }]) === 0,
    'countCappedCallSites: ignores a commented-out call site');
  ok(countCappedCallSites([{ rel: WRAPPER_MODULE, text: CAPPED_WRAPPER }]) === 0,
    'countCappedCallSites: does not count the wrapper module itself');
  ok(countCappedCallSites([]) === 0, 'countCappedCallSites: empty tree counts zero');
  ok(MAX_INSTANCES_CEILING > 0 && MAX_INSTANCES_CEILING <= 100,
    'MAX_INSTANCES_CEILING is a sane upper bound');
}

// ═════════════════════════════════════════════════════════════════════════════
// LAYER 2 — the contract, over the REAL functions/src/**.
// ═════════════════════════════════════════════════════════════════════════════

console.log('— Layer 2: the cost cap over functions/src/** —');

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'functions', 'src');
const WRAPPER_PATH = path.join(SRC, 'obs', 'log.ts');

// K5 (anti-vacuity, first): a wrong path makes every assertion below pass over an
// empty set. Assert the scan targets exist BEFORE trusting anything they report.
ok(existsSync(SRC), `anti-vacuity: functions source tree exists at ${SRC}`);
ok(existsSync(WRAPPER_PATH), `anti-vacuity: the wrapper module exists at ${WRAPPER_PATH}`);

const wrapperText = existsSync(WRAPPER_PATH) ? readFileSync(WRAPPER_PATH, 'utf8') : '';
const sources: { rel: string; text: string }[] = existsSync(SRC) ? collectSources(SRC) : [];

// K1 — a default exists and is a plausible cap.
const dflt = extractDefaultMaxInstances(wrapperText);
ok(dflt !== null, 'K1: obs/log.ts still declares DEFAULT_MAX_INSTANCES');
ok(dflt !== null && Number.isFinite(dflt) && dflt > 0,
  `K1: the default is a positive finite number (got ${dflt})`);
ok(dflt !== null && dflt <= MAX_INSTANCES_CEILING,
  `K1: the default (${dflt}) is at or below MAX_INSTANCES_CEILING (${MAX_INSTANCES_CEILING})`);

// K2 — resolveRuntimeOpts still merges it, caller opts spread over it.
ok(resolveRuntimeOptsIsCapped(wrapperText),
  'K2: resolveRuntimeOpts still merges a default maxInstances (caller opts win)');

// K2b — every per-callable hot-path ceiling is itself within the ceiling, and the
// map is actually consulted (a declared-but-unread map throttles the hot paths
// silently, which fails in production rather than on the bill).
{
  const entries = extractHotPathMaxInstances(wrapperText);
  ok(entries !== null, 'K2b: obs/log.ts still declares HOT_PATH_MAX_INSTANCES');
  ok((entries?.length ?? 0) >= HOT_PATH_ENTRY_FLOOR,
    `K2b anti-vacuity: found ${entries?.length ?? 0} hot-path entries, expected >= ${HOT_PATH_ENTRY_FLOOR}`);
  const bad = findHotPathViolations(entries);
  ok(bad.length === 0,
    `K2b: every hot-path ceiling is <= ${MAX_INSTANCES_CEILING} — offenders: ${bad.map((b) => `${b.name}=${b.value} (${b.detail})`).join(', ')}`);
  ok(wrapperConsultsHotPath(wrapperText),
    'K2b: loggedCallable folds HOT_PATH_MAX_INSTANCES in (explicit runtimeOpts.maxInstances still wins)');
}

// K3 — loggedCallable still wires it.
ok(wrapperAppliesCap(wrapperText),
  'K3: loggedCallable still passes resolveRuntimeOpts(...) into functions.runWith');

// K4 — nothing outside the wrapper deploys uncapped.
{
  const offenders = findUncappedOnCallSites(sources);
  ok(offenders.length === 0,
    `K4: every deployed function is capped — uncapped: ${offenders.map((o) => `${o.rel}:${o.line} (${o.kind}) ${o.detail}`).join(', ')}`);
}

// K5 — the scan can still see the population it is vouching for.
{
  const n = countCappedCallSites(sources);
  ok(n >= CAPPED_CALLABLE_FLOOR,
    `K5 anti-vacuity: found ${n} wrapper-built call sites, expected >= ${CAPPED_CALLABLE_FLOOR}`);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} cost guards: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
