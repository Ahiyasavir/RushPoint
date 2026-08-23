// Pure decision logic for the publicTasks legacy-coordinate backfill operator
// script (change: public-task-backfill-runbook).
//
// `scripts/backfill-public-tasks.mjs` is the only caller. Everything that can be
// decided WITHOUT talking to Firebase lives here so it can be unit-tested by
// `scripts/test-public-task-backfill.ts` through the `npm test` aggregator:
//
//   parseBackfillArgs — flags + the dangerous-target confirmation rule
//   decidePage        — continue / stop / fail for one page of the paged sweep
//   accumulateTotals  — running tallies for the progress report
//   describeTarget    — the loud pre-flight banner
//
// Two properties are load-bearing and are asserted by the tests:
//   1. DRY-RUN IS THE DEFAULT. Only an explicit `--execute` can mutate anything,
//      and a contradictory invocation resolves to the safe side.
//   2. THE LOOP IS BOUNDED. Every page must either finish, advance the cursor, or
//      fail — a malformed response or a stalled cursor can never spin forever.

/** The local emulator's project id (matches .firebaserc + scripts/seed-local.mjs). */
export const EMULATOR_PROJECT_ID = 'rushpoint-pwa-7daaa';

/** Page size handed to the callable. Its own server-side clamp is 1…1000. */
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;

/** Hard bound on how many pages one invocation will drive. 200 × 500 = 100k docs. */
export const DEFAULT_MAX_PAGES = 200;

const NUMERIC_KEYS = ['scanned', 'repaired', 'cleared', 'orphaned'];

function parseIntFlag(raw, name, { min, max }, errors) {
  if (!/^-?\d+$/.test(String(raw).trim())) {
    errors.push(`--${name}: "${raw}" is not an integer`);
    return null;
  }
  const n = Number(raw);
  if (n < min || (max !== undefined && n > max)) {
    errors.push(`--${name}: ${n} is out of range (${min}…${max ?? '∞'})`);
    return null;
  }
  return n;
}

/**
 * Parse argv (flags only, no positionals) against the environment.
 *
 * Always returns a fully-populated result — `ok:false` carries `errors[]` AND a
 * safe (`dryRun:true`) configuration, so a caller that ignores `ok` still cannot
 * mutate anything.
 */
export function parseBackfillArgs(argv = [], env = {}) {
  const errors = [];
  let help = false;
  let execute = false;
  let explicitDryRun = false;
  let projectFlag = null;   // null = not supplied
  let confirmProject = null;
  let limit = DEFAULT_LIMIT;
  let maxPages = DEFAULT_MAX_PAGES;
  let startAfter = null;

  for (const arg of argv) {
    const [flag, ...rest] = String(arg).split('=');
    const value = rest.join('=');
    switch (flag) {
      case '--help': case '-h': help = true; break;
      case '--execute': execute = true; break;
      case '--dry-run': explicitDryRun = true; break;
      case '--project': projectFlag = value; break;
      case '--confirm-project': confirmProject = value; break;
      case '--start-after': startAfter = value || null; break;
      case '--limit': {
        const n = parseIntFlag(value, 'limit', { min: 1, max: MAX_LIMIT }, errors);
        if (n !== null) limit = n;
        break;
      }
      case '--max-pages': {
        const n = parseIntFlag(value, 'max-pages', { min: 1 }, errors);
        if (n !== null) maxPages = n;
        break;
      }
      default:
        errors.push(`unknown flag: ${arg}`);
    }
  }

  // `--project` with no value is a mistake, not "use the default".
  if (projectFlag !== null && projectFlag.trim() === '') {
    errors.push('--project requires a project id (e.g. --project=rushpoint-pwa-7daaa)');
  }

  const envProject = typeof env.RUSHPOINT_BACKFILL_PROJECT === 'string'
    ? env.RUSHPOINT_BACKFILL_PROJECT.trim()
    : '';
  const namedProject = (projectFlag && projectFlag.trim()) || envProject || '';
  const target = namedProject ? 'project' : 'emulator';
  const projectId = namedProject || EMULATOR_PROJECT_ID;

  if (execute && explicitDryRun) {
    errors.push('--execute and --dry-run contradict each other; pass exactly one');
  }

  // THE GUARD: a real project may only be WRITTEN to when the operator retypes
  // its id. A dry-run against a real project is read-only and needs no confirmation.
  const wantsWrite = execute && !explicitDryRun;
  if (wantsWrite && target === 'project' && confirmProject !== projectId) {
    errors.push(
      `refusing to execute against the real project "${projectId}" without `
      + `--confirm-project=${projectId}`,
    );
  }

  const ok = errors.length === 0;
  const dryRun = !(ok && wantsWrite);

  return {
    ok, errors, help,
    mode: dryRun ? 'dry-run' : 'execute',
    dryRun,
    target, projectId,
    limit, maxPages, startAfter,
  };
}

/** Human-readable, deliberately loud pre-flight banner. */
export function describeTarget(args) {
  const lines = [];
  const mode = args.dryRun
    ? 'DRY-RUN — reads only, nothing will be written'
    : 'EXECUTE — documents WILL be written';
  if (args.target === 'emulator') {
    lines.push('┌─ target: LOCAL EMULATOR ────────────────────────────────');
    lines.push(`│  project id : ${args.projectId} (emulator)`);
  } else {
    lines.push('┌─ target: REAL PROJECT (PRODUCTION DATA) ────────────────');
    lines.push(`│  project id : ${args.projectId}`);
  }
  lines.push(`│  mode       : ${mode}`);
  lines.push(`│  page size  : ${args.limit}   page budget: ${args.maxPages}`);
  lines.push(`│  start after: ${args.startAfter ?? '(beginning)'}`);
  lines.push('└─────────────────────────────────────────────────────────');
  return lines.join('\n');
}

/**
 * Decide what the paging loop does after one call.
 *
 * `page` is whatever `backfillPublicTaskCoordinatesNow` returned. Anything that
 * is not an unambiguous "keep going from cursor X" or "finished" is a FAILURE —
 * the loop never guesses, because guessing here means either an infinite loop or
 * a silently incomplete privacy sweep.
 *
 * @returns {{action:'continue'|'stop'|'fail', cursor:string|null, reason:string}}
 */
export function decidePage({ page, previousCursor = null, pageIndex = 0, maxPages = DEFAULT_MAX_PAGES }) {
  const fail = (reason) => ({ action: 'fail', cursor: previousCursor, reason });

  if (pageIndex >= maxPages) {
    return fail(`page budget exhausted after ${maxPages} pages — resume with --start-after=${previousCursor ?? ''}`);
  }
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    return fail('malformed response (not an object)');
  }
  if (page.ok !== true) {
    return fail('the callable did not report ok:true');
  }
  for (const key of NUMERIC_KEYS) {
    const v = page[key];
    if (v !== undefined && !Number.isFinite(v)) return fail(`malformed counter: ${key}=${String(v)}`);
  }
  if (page.done === true) {
    return { action: 'stop', cursor: page.cursor ?? previousCursor ?? null, reason: 'done' };
  }
  if (page.done !== false) {
    return fail(`malformed \`done\` flag: ${String(page.done)}`);
  }
  const cursor = page.cursor;
  if (typeof cursor !== 'string' || cursor === '') {
    return fail('not done, but no cursor to continue from');
  }
  if (previousCursor !== null && cursor === previousCursor) {
    return fail(`cursor did not advance (stuck at ${cursor})`);
  }
  return { action: 'continue', cursor, reason: 'more pages' };
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Running totals across pages. `skipped` = already-conformant documents. */
export function accumulateTotals(totals, page) {
  const base = totals ?? { pages: 0, scanned: 0, repaired: 0, cleared: 0, orphaned: 0, skipped: 0 };
  const p = page && typeof page === 'object' ? page : {};
  const scanned = num(p.scanned);
  const repaired = num(p.repaired);
  return {
    pages: base.pages + 1,
    scanned: base.scanned + scanned,
    repaired: base.repaired + repaired,
    cleared: base.cleared + num(p.cleared),
    orphaned: base.orphaned + num(p.orphaned),
    skipped: base.skipped + Math.max(0, scanned - repaired),
  };
}
