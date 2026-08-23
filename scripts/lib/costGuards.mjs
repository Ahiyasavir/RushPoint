// Pure static analysis of the Cloud Functions COST CAP (change: cost-containment-max-instances).
//
// The property being defended: every deployed function is bounded by a
// `maxInstances` ceiling, so an abuse spike or a runaway loop cannot scale to
// Google's project-wide instance ceiling and turn a bug into a real bill.
//
// Today that property holds BY CONSTRUCTION rather than by discipline:
// `functions/src/obs/log.ts` defines DEFAULT_MAX_INSTANCES, `resolveRuntimeOpts()`
// merges it into every callable's runtime options, and `loggedCallable()` is the
// single constructor all ~96 callables are built through. Construction-level
// properties are the ones that rot silently — deleting one line of the wrapper
// removes the cap from ninety-six functions at once, and NOTHING else in the repo
// notices. That is what this module exists to notice.
//
// Every function here is a total function of TEXT — no I/O at all, and the one
// explicit file walk is borrowed from scripts/lib/callableHardening.mjs rather
// than re-implemented — so the guard's decision logic can be proven against
// synthetic fixtures in scripts/test-cost-guards.ts, independently of what
// functions/src currently happens to contain. That separation is the whole point:
// an analyzer whose regex quietly stops matching reports green forever, and the
// only defence is testing the analyzer itself in BOTH directions.
//
// Regexes rather than a TypeScript AST, for the same reason as callableHardening:
// the scripts/ lane has no TS-compiler dependency, and the declarations being
// parsed are two house-standard idioms used identically everywhere. Where a regex
// genuinely cannot decide (an unbalanced or exotic argument), this module reports
// the site as an OFFENCE rather than skipping it — the cheap direction to be wrong
// in is "a human looks at it", never "the bill is unbounded and nobody was told".

/** The module that legitimately defines the wrapper, so it may name raw onCall. */
export const WRAPPER_MODULE = 'obs/log.ts';

/**
 * Upper sanity bound on the default cap. A "cap" of 5000 is not a cap — it is the
 * project ceiling with extra steps, and it would sail past any guard that only
 * asked "is a number present?". Chosen well above this app's realistic peak (a few
 * hundred concurrent participants firing short, cheap callables, which
 * DEFAULT_MAX_INSTANCES = 3 already covers at ~15 req/s per callable) and well
 * below anything that could
 * produce a surprising bill. Raising it past this line should require editing this
 * constant — i.e. it should be a decision, not a diff nobody read.
 *
 * It bounds BOTH numbers that can set a ceiling: the default, and every entry in
 * HOT_PATH_MAX_INSTANCES. A typo'd `requestNextTask: 1000` in that map is exactly
 * as expensive as a typo'd default, and is likewise caught here.
 */
export const MAX_INSTANCES_CEILING = 50;

/**
 * Anti-vacuity floor for the per-callable HOT_PATH_MAX_INSTANCES map. The map is
 * the one place a ceiling is raised above the (deliberately low) default, so an
 * emptied map is a real event — it means either the hot paths lost their headroom
 * or, worse, the analyzer stopped seeing a map that is still there and is no
 * longer checking any of its numbers against the ceiling.
 */
export const HOT_PATH_ENTRY_FLOOR = 5;

/**
 * Anti-vacuity floor (mirrors CALLABLE_FLOOR in callableHardening.mjs). Well below
 * today's ~96 so ordinary additions and deletions never trip it, high enough that a
 * scan which has stopped matching cannot pass over an almost-empty set. The silent
 * non-match is the failure mode that matters most here: an analyzer that finds zero
 * call sites agrees enthusiastically that zero of them are uncapped.
 */
export const CAPPED_CALLABLE_FLOOR = 60;

// ── Text helpers (deliberately duplicated from callableHardening.mjs) ─────────
// Duplicated, not imported: these four are three-line lexical primitives, and a
// shared-helpers module between two guards would mean a bug in one silently
// rewrites the verdicts of the other. Each guard reasons about its own text.

/** True when a source line is inside a comment (line comment or block-comment body). */
function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** 1-based line number of `index` within `text`. */
function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The whole source line containing `index`. */
function lineTextAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

/**
 * Body of a top-level function declaration, sliced until the next top-level
 * declaration. Bounded and deliberately shallow — same shape and same rationale as
 * callableHardening's localDeclarationBody: a cleverer call-graph walk fails by
 * "resolving" a marker that is not really on the path, i.e. it fails GREEN.
 */
function topLevelBody(text, name) {
  const decl = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]|^(?:export\\s+)?const\\s+${name}\\s*[=:]`,
    'm',
  );
  const m = decl.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /\n(?:export\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * The argument text of a call whose opening paren sits at `openIndex`, read with a
 * real paren/brace balancer (a regex cannot match nested `({ ... })`). Returns null
 * when the parens never balance — callers treat null as "cannot decide", and every
 * caller here turns "cannot decide" into an offence, never into a pass.
 */
function balancedArg(text, openIndex) {
  if (text[openIndex] !== '(') return null;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return null;
}

/**
 * The text of the statement leading up to `index`, so a call site can be judged in
 * the context of its own chain (`functions.runWith(...).https.onCall(...)` may span
 * several lines). Sliced back to the previous statement terminator, capped so a
 * minified or comment-heavy file cannot drag in an unrelated earlier `runWith`.
 */
function statementPrefix(text, index) {
  const floor = Math.max(0, index - 600);
  const semi = text.lastIndexOf(';', index);
  return text.slice(Math.max(floor, semi + 1), index);
}

// ── 1 & 2. The default itself ────────────────────────────────────────────────

/**
 * The numeric literal assigned to DEFAULT_MAX_INSTANCES in obs/log.ts, or null when
 * the declaration is absent (deleted, renamed, or commented out — all of which are
 * the same event as far as the bill is concerned).
 *
 * Only a literal is accepted. `DEFAULT_MAX_INSTANCES = someImportedThing` is
 * reported as null on purpose: this module cannot follow the import, and a value it
 * cannot read is a value it must not vouch for.
 *
 * @returns {number | null}
 */
export function extractDefaultMaxInstances(sourceText) {
  const re = /export\s+const\s+DEFAULT_MAX_INSTANCES\s*(?::\s*number\s*)?=\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(sourceText))) {
    if (isCommentLine(lineTextAt(sourceText, m.index))) continue;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Does obs/log.ts still MERGE a default maxInstances into the runtime options, and
 * is that default a plausible cap?
 *
 * All four conditions must hold:
 *   a. `resolveRuntimeOpts` still exists as a top-level declaration;
 *   b. its body sets `maxInstances` (a body of just `{ ...runtimeOpts }` is the
 *      exact de-capping edit this predicate exists to catch);
 *   c. the caller's opts are spread AFTER the default, so an explicit per-callable
 *      maxInstances still wins — losing that would break heavy callables rather
 *      than the bill, but it is part of the documented contract;
 *   d. the default resolves to a positive, finite number at or below
 *      MAX_INSTANCES_CEILING.
 */
export function resolveRuntimeOptsIsCapped(sourceText) {
  const body = topLevelBody(sourceText, 'resolveRuntimeOpts');
  if (!body) return false;

  const assign = /maxInstances\s*:\s*([A-Za-z0-9_.]+)/.exec(body);
  if (!assign) return false;

  // The default must be filled in first and the caller's opts spread over it.
  if (!/maxInstances\s*:[\s\S]*\.\.\.\s*\w+/.test(body)) return false;

  const value = assign[1];
  const n = value === 'DEFAULT_MAX_INSTANCES'
    ? extractDefaultMaxInstances(sourceText)
    : Number(value);

  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_INSTANCES_CEILING;
}

// ── 2b. The per-callable hot-path ceilings ───────────────────────────────────

/**
 * The body of the first balanced `{ ... }` starting at `openIndex`, or null when
 * the braces never balance. Same fail-closed contract as balancedArg: callers turn
 * "cannot decide" into an offence, never into a pass.
 */
function balancedBrace(text, openIndex) {
  if (text[openIndex] !== '{') return null;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return null;
}

/**
 * Every `name: number` entry of the HOT_PATH_MAX_INSTANCES map in obs/log.ts.
 *
 * Returns null when the declaration is absent — which is SAFE for the bill (every
 * callable then falls back to DEFAULT_MAX_INSTANCES) but is still reported
 * distinctly, because "the map is gone" and "the map is empty" are different
 * events from "the analyzer stopped matching a map that is still there".
 *
 * `value` is null for anything that is not a readable numeric literal. As
 * everywhere in this module, a value it cannot read is a value it must not vouch
 * for, so findHotPathViolations treats null as an offence.
 *
 * @returns {{ name: string, value: number | null }[] | null}
 */
export function extractHotPathMaxInstances(sourceText) {
  const decl = /export\s+const\s+HOT_PATH_MAX_INSTANCES\s*(?::[^=]*)?=\s*\{/.exec(sourceText);
  if (!decl) return null;
  if (isCommentLine(lineTextAt(sourceText, decl.index))) return null;

  const body = balancedBrace(sourceText, decl.index + decl[0].length - 1);
  if (body === null) return null;

  const out = [];
  const re = /(['"]?)([A-Za-z_$][\w$]*)\1\s*:\s*([^,\n}]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (isCommentLine(lineTextAt(body, m.index))) continue;
    const raw = m[3].trim();
    const n = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
    out.push({ name: m[2], value: Number.isFinite(n) ? n : null });
  }
  return out;
}

/**
 * Which hot-path entries are not themselves a plausible cap. This is the whole
 * point of parsing the map: raising a ceiling per callable is a legitimate,
 * expected edit, so the map is where a bill-sized number is MOST likely to be typed
 * — `requestNextTask: 1000` reads like an ordinary tuning change and would sail
 * past a guard that only ever checked the default.
 *
 * @param {{ name: string, value: number | null }[] | null} entries
 * @returns {{ name: string, value: number | null, detail: string }[]}
 */
export function findHotPathViolations(entries, ceiling = MAX_INSTANCES_CEILING) {
  if (!entries) return [];
  const out = [];
  for (const { name, value } of entries) {
    if (value === null) {
      out.push({ name, value, detail: 'value is not a readable numeric literal' });
    } else if (!Number.isFinite(value) || value <= 0) {
      out.push({ name, value, detail: 'value is not a positive finite number' });
    } else if (value > ceiling) {
      out.push({ name, value, detail: `value exceeds MAX_INSTANCES_CEILING (${ceiling})` });
    }
  }
  return out;
}

/**
 * Is the hot-path map actually CONSULTED when a callable is built?
 *
 * The map's failure mode mirrors K3's: a map that exists but is never read looks
 * like deliberate per-callable tuning in review, passes any test that only parses
 * its numbers, and silently leaves every hot callable pinned at the (low) default —
 * i.e. it fails as a THROTTLE in production rather than as a bill. Both halves are
 * required: loggedCallable must call the folding helper, and the helper must be the
 * thing that reads the map.
 */
export function wrapperConsultsHotPath(sourceText) {
  const wrapper = topLevelBody(sourceText, 'loggedCallable');
  if (!wrapper || !/\bwithHotPathCeiling\s*\(/.test(wrapper)) return false;
  const helper = topLevelBody(sourceText, 'withHotPathCeiling');
  if (!helper) return false;
  if (!/\bHOT_PATH_MAX_INSTANCES\b/.test(helper)) return false;
  // The caller's own opts must still be spread OVER the hot-path ceiling, so an
  // explicit per-call-site maxInstances keeps winning (documented precedence).
  return /maxInstances\s*:[\s\S]*\.\.\.\s*\w+/.test(helper);
}

// ── 3. The wiring ────────────────────────────────────────────────────────────

/**
 * Does `loggedCallable` actually hand `resolveRuntimeOpts(...)` to `runWith`?
 *
 * This is the predicate that matters most. A cap that EXISTS but is not WIRED is
 * the exact silent failure: DEFAULT_MAX_INSTANCES still sits in the file, still
 * reads as deliberate cost containment to anyone reviewing the diff, still passes
 * any test that only checks the constant — and caps nothing at all. Both halves
 * are required: `runWith` must be called, and `resolveRuntimeOpts` must be what it
 * is called with (`runWith(runtimeOpts)` is uncapped, and so is a bare
 * `functions.https.onCall`).
 */
export function wrapperAppliesCap(sourceText) {
  const body = topLevelBody(sourceText, 'loggedCallable');
  if (!body) return false;
  return /\brunWith\s*\(\s*resolveRuntimeOpts\s*\(/.test(body);
}

// ── 4. Bypasses elsewhere in the tree ────────────────────────────────────────

/**
 * True when an options-object text pins a plausible maxInstances. Accepts a literal
 * or the named DEFAULT_MAX_INSTANCES (how the real stripeWebhook is written) and
 * nothing else: an arbitrary identifier is a value this module cannot read, and an
 * unreadable value must not be treated as a cap.
 */
function optionsArePinned(argText, ceiling) {
  if (/\bresolveRuntimeOpts\s*\(/.test(argText)) return true; // delegates to the checked default
  const m = /\bmaxInstances\s*:\s*([A-Za-z0-9_.]+)/.exec(argText);
  if (!m) return false;
  if (m[1] === 'DEFAULT_MAX_INSTANCES') return true;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= ceiling;
}

/**
 * Every place in the tree that deploys a function WITHOUT a cap. Two offence kinds,
 * because there are two ways to lose the ceiling:
 *
 *   'raw-onCall'       — an `onCall(` whose own statement never calls `runWith`,
 *                        i.e. a new callable that bypassed `loggedCallable`. This
 *                        is regression (c): the wrapper is intact and every other
 *                        function stays capped, so nothing else in the repo has any
 *                        reason to complain.
 *   'uncapped-runWith' — a `runWith({...})` whose options carry no usable
 *                        maxInstances. Covers onRequest/schedule endpoints too
 *                        (stripeWebhook is exactly this shape), which the
 *                        callable-only guards never look at.
 *
 * WRAPPER_MODULE is exempt for the reason callableHardening.mjs exempts it: it is
 * the module that legitimately names these primitives, and predicates 1–3 above are
 * what hold it to account.
 *
 * @param {{ rel: string, text: string }[]} files
 * @returns {{ rel: string, line: number, kind: string, detail: string }[]}
 */
export function findUncappedOnCallSites(files, ceiling = MAX_INSTANCES_CEILING) {
  const out = [];
  for (const { rel, text } of files) {
    if (rel === WRAPPER_MODULE) continue;

    // (a) A function constructor with no runWith anywhere in its statement.
    for (const m of text.matchAll(/\bonCall\s*\(/g)) {
      if (isCommentLine(lineTextAt(text, m.index))) continue;
      if (/\brunWith\s*\(/.test(statementPrefix(text, m.index))) continue; // judged by (b)
      out.push({
        rel,
        line: lineOf(text, m.index),
        kind: 'raw-onCall',
        detail: 'deploys a callable without functions.runWith(...) — no maxInstances cap',
      });
    }

    // (b) A runWith whose options do not pin a usable maxInstances.
    for (const m of text.matchAll(/\brunWith\s*\(/g)) {
      if (isCommentLine(lineTextAt(text, m.index))) continue;
      const arg = balancedArg(text, m.index + m[0].length - 1);
      // Unbalanced/unreadable ⇒ offence, never a pass (see the module header).
      if (arg === null || !optionsArePinned(arg, ceiling)) {
        out.push({
          rel,
          line: lineOf(text, m.index),
          kind: 'uncapped-runWith',
          detail: `runWith options pin no maxInstances <= ${ceiling}`,
        });
      }
    }
  }
  return out;
}

// ── 6. Anti-vacuity ──────────────────────────────────────────────────────────

/**
 * How many call sites are capped BY CONSTRUCTION, i.e. built through the wrapper.
 * Compared against CAPPED_CALLABLE_FLOOR by the test: a scan reporting "0 uncapped
 * sites" is only good news if it also proves it can still see the capped ones.
 */
export function countCappedCallSites(files) {
  let n = 0;
  for (const { rel, text } of files) {
    if (rel === WRAPPER_MODULE) continue;
    for (const m of text.matchAll(/\bloggedCallable\s*\(/g)) {
      if (isCommentLine(lineTextAt(text, m.index))) continue;
      n++;
    }
  }
  return n;
}
