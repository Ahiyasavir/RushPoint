// Callable wiring audit — guarantees the chain "domain module → index.ts re-export
// → app calls.ts wrapper" never breaks silently. Three independent regressions cost
// real debugging time, and NONE of them is a type error or caught by typecheck:
//
//   1. A new callable is added in a domain module (e.g. runs/index.ts) but FORGOTTEN
//      from the explicit `export { … } from './runs/index'` list in index.ts → Firebase
//      never deploys it → the app calls a function that doesn't exist (runtime
//      "not-found"). The big modules use an explicit allow-list, not `export *`,
//      precisely so deploys are intentional — which makes the omission easy to miss.
//   2. A callable is renamed/removed but its name lingers in the index.ts re-export
//      list → a dangling re-export of a symbol that no longer exists.
//   3. An app's services/calls.ts wrapper references a callable string name that is
//      not actually reachable from index.ts (typo, renamed callable, never wired) →
//      runtime "internal/not-found" the first time a user hits that button.
//
// An INTERNAL helper that must never become a trigger (completeTaskForTeam, the
// routing helpers) leaking into the export surface is also caught.
//
// Pure static source analysis — no emulator, no admin-SDK init.
//   npx tsx scripts/test-callable-exports.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FN = (p: string) => join(ROOT, 'functions/src', p);

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── The domain modules index.ts re-exports from. DISCOVERED, not declared.
//
//    This used to be a hand written list, and a hand written list of "everywhere
//    to look" has exactly one failure mode: a new module is not in it, so the
//    check silently stops covering the very code that was just added. That is
//    what happened when the contact module arrived. The list was not wrong about
//    anything it named; it was simply not asked about the new file, and a check
//    that examines nothing reports the same green as a check that passed.
//
//    So: every file under functions/src that DEFINES a callable is a module, by
//    definition. index.ts is excluded because its own callables are handled
//    separately, and routing/assignNextTask.ts falls out on its own because its
//    functions are internal helpers, never triggers, so it defines no callable.
function discoverModules(rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(FN(rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('__')) continue;
      out.push(...discoverModules(child));
    } else if (
      entry.name.endsWith('.ts')
      && !entry.name.endsWith('.test.ts')
      && !entry.name.endsWith('.d.ts')
      && child !== 'index.ts'
    ) {
      if (onCallExports(readFileSync(FN(child), 'utf8')).length > 0) out.push(child);
    }
  }
  return out;
}

// Internal helpers that must NEVER be re-exported as a Cloud Function trigger.
const MUST_STAY_INTERNAL = [
  'completeTaskForTeam', 'assignTask', 'buildRecommendations',
  'computeSkillRatio', 'releaseTask',
];

const read = (rel: string) => readFileSync(FN(rel), 'utf8');

// The deployable callables/HTTP triggers a module defines. Two forms:
//   export const NAME = functions.https.onCall( / .onRequest(   (raw)
//   export const NAME = loggedCallable('NAME', ...)             (observability wrapper)
function onCallExports(src: string): string[] {
  const out: string[] = [];
  const reRaw = /export\s+const\s+(\w+)\s*=\s*functions\.[^\n]*\.(onCall|onRequest)\s*\(/g;
  const reWrapped = /export\s+const\s+(\w+)\s*=\s*loggedCallable\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = reRaw.exec(src))) out.push(m[1]);
  while ((m = reWrapped.exec(src))) out.push(m[1]);
  return out;
}

// Every value-level export a module exposes (const / function), so we can verify
// each name in an index.ts re-export list actually resolves to a real symbol.
function allValueExports(src: string): Set<string> {
  const out = new Set<string>();
  const reConst = /export\s+const\s+(\w+)/g;
  const reFn = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = reConst.exec(src))) out.add(m[1]);
  while ((m = reFn.exec(src))) out.add(m[1]);
  return out;
}

const rootSrc = read('index.ts');

// ── Parse index.ts re-export statements ─────────────────────────────────────
// Wildcard re-exports: `export * from './games/index';`  → all of that module's
//   exports are public.
// Explicit re-exports: `export { a, b } from './runs/index';` (possibly multi-line)
//   → only the named symbols are public.
const wildcardModules = new Set<string>();
{
  const re = /export\s+\*\s+from\s+'\.\/([\w/]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rootSrc))) wildcardModules.add(`${m[1]}.ts`);
}

// module path → set of explicitly re-exported names
const explicitReExports = new Map<string, Set<string>>();
{
  const re = /export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+'\.\/([\w/]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rootSrc))) {
    if (m[1]) continue; // `export type { … }` is not a value re-export
    const mod = `${m[3]}.ts`;
    const names = m[2]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    const set = explicitReExports.get(mod) ?? new Set<string>();
    names.forEach((n) => set.add(n));
    explicitReExports.set(mod, set);
  }
}

// Callables defined directly inside index.ts are exported by definition.
const rootOwnCallables = new Set(onCallExports(rootSrc));

// ── The reachable export surface = wildcard-module exports + explicit re-exports
//    + index.ts's own callables. This is "what Firebase will actually deploy". ──
const reachable = new Set<string>(rootOwnCallables);

// The reach assertion. Discovery replaced a declared list, so the thing that can
// now go wrong is discovery finding nothing and every per module check below
// vacuously passing over an empty set.
const MODULES = discoverModules();
check('module discovery found the domain modules', MODULES.length >= 8, `${MODULES.length}: ${MODULES.join(', ')}`);

for (const mod of MODULES) {
  const src = read(mod);
  const callables = onCallExports(src);
  const valueExports = allValueExports(src);
  const isWildcard = wildcardModules.has(mod);
  const explicit = explicitReExports.get(mod) ?? new Set<string>();

  // (1) Every callable the module defines must be reachable from index.ts.
  for (const name of callables) {
    const exported = isWildcard || explicit.has(name);
    check(`${mod}: callable "${name}" is re-exported from index.ts`, exported,
      exported ? '' : isWildcard ? '' : 'add it to the `export { … } from` list in functions/src/index.ts');
    if (exported) reachable.add(name);
  }

  // (2) Every name in an explicit re-export list must resolve to a real export
  //     in the module (catches a renamed/removed callable left behind).
  if (!isWildcard) {
    for (const name of explicit) {
      check(`${mod}: re-exported name "${name}" exists in the module`,
        valueExports.has(name), valueExports.has(name) ? '' : 'dangling re-export — symbol not found');
    }
  } else {
    valueExports.forEach((n) => reachable.add(n));
  }
}

// ── (3) Internal helpers must never appear on the public export surface ───────
for (const name of MUST_STAY_INTERNAL) {
  check(`internal helper "${name}" is NOT re-exported as a trigger`, !reachable.has(name),
    reachable.has(name) ? 'this would deploy an internal helper as a Cloud Function' : '');
}

// ── (4) Every services/calls.ts wrapper points at a reachable callable ────────
// The callable name is the string literal passed to `callable<…>('name')`.
const APPS = ['apps/creator-web/src/services/calls.ts', 'apps/play-web/src/services/calls.ts'];
function callableRefs(src: string): string[] {
  const out: string[] = [];
  const re = /\bcallable\s*<[\s\S]*?>\s*\(\s*'([^']+)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  // also handle the no-generic form: callable('name')
  const re2 = /\bcallable\s*\(\s*'([^']+)'\s*\)/g;
  while ((m = re2.exec(src))) out.push(m[1]);
  return Array.from(new Set(out));
}
for (const app of APPS) {
  const src = readFileSync(join(ROOT, app), 'utf8');
  for (const name of callableRefs(src)) {
    check(`${app.split('/')[1]}: wrapper "${name}" maps to a reachable callable`,
      reachable.has(name), reachable.has(name) ? '' : 'no such callable is exported from functions/src/index.ts');
  }
}

console.log(`\n${failures === 0 ? 'ALL CALLABLE-WIRING TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
