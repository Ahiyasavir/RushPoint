// Pure-logic tests for public-task-backfill-runbook:
//   parseBackfillArgs — flag parsing + the dangerous-target confirmation rule
//   decidePage        — the paging-loop decision (continue / stop / fail)
//   accumulateTotals  — running scanned/repaired/skipped tallies
//   describeTarget    — the loud pre-flight banner
//
// These are the ONLY parts of `scripts/backfill-public-tasks.mjs` that can be proven
// without a live Firebase project: everything else is I/O against an admin-gated
// callable. NO network, NO emulator, NO credentials are touched by this file — and
// nothing here can trigger a sweep.
//
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  parseBackfillArgs,
  decidePage,
  accumulateTotals,
  describeTarget,
  EMULATOR_PROJECT_ID,
  DEFAULT_LIMIT,
  DEFAULT_MAX_PAGES,
} from './lib/publicTaskBackfill.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const parse = (argv: string[], env: Record<string, string> = {}) => parseBackfillArgs(argv, env);

// ── The safe thing is the default ────────────────────────────────────────────
{
  const a = parse([]);
  ok(a.ok === true, 'no arguments at all is a valid invocation');
  ok(a.dryRun === true, 'DEFAULT IS DRY-RUN — no flags means nothing is mutated');
  ok(a.mode === 'dry-run', 'mode reports itself as dry-run');
  ok(a.target === 'emulator', 'default target is the local emulator, never a real project');
  ok(a.projectId === EMULATOR_PROJECT_ID, 'default project id is the emulator project');
  ok(a.limit === DEFAULT_LIMIT, `default page limit is ${DEFAULT_LIMIT}`);
  ok(a.maxPages === DEFAULT_MAX_PAGES, `default page budget is ${DEFAULT_MAX_PAGES}`);
  ok(a.startAfter === null, 'default cursor is null (start from the beginning)');
}
{
  const a = parse(['--dry-run']);
  ok(a.ok === true && a.dryRun === true, 'an explicit --dry-run is accepted and redundant');
}

// ── Executing is always an explicit act ──────────────────────────────────────
{
  const a = parse(['--execute']);
  ok(a.ok === true, '--execute against the emulator needs no confirmation');
  ok(a.dryRun === false && a.mode === 'execute', '--execute is the ONLY way to leave dry-run');
}
{
  const a = parse(['--execute', '--dry-run']);
  ok(a.ok === false, '--execute together with --dry-run is a contradiction, not a guess');
  ok(a.dryRun === true, 'a contradictory invocation still resolves to the SAFE side');
}

// ── A non-emulator target must be confirmed ──────────────────────────────────
{
  const a = parse(['--project=rushpoint-pwa-7daaa']);
  ok(a.ok === true, 'a read-only dry-run against a real project is allowed');
  ok(a.target === 'project' && a.projectId === 'rushpoint-pwa-7daaa', 'the project id is carried through');
  ok(a.dryRun === true, 'naming a project does NOT imply executing');
}
{
  const a = parse(['--project=rushpoint-pwa-7daaa', '--execute']);
  ok(a.ok === false, 'executing against a non-emulator target without confirmation is REFUSED');
  ok(a.errors.some((e: string) => /confirm-project/.test(e)), 'the refusal names the flag that would allow it');
}
{
  const a = parse(['--project=rushpoint-pwa-7daaa', '--execute', '--confirm-project=some-other-project']);
  ok(a.ok === false, 'a confirmation naming a DIFFERENT project is refused (typo / copy-paste guard)');
}
{
  const a = parse(['--project=rushpoint-pwa-7daaa', '--execute', '--confirm-project=rushpoint-pwa-7daaa']);
  ok(a.ok === true, 'a confirmation that exactly matches the target project unlocks execution');
  ok(a.dryRun === false, 'the confirmed invocation is the executing one');
}
{
  const a = parse(['--project=', '--execute']);
  ok(a.ok === false, 'an empty --project= value is an error, not a silent fall back to the emulator');
}
{
  // The reverse mistake must be harmless: confirming a project you never targeted.
  const a = parse(['--execute', '--confirm-project=rushpoint-pwa-7daaa']);
  ok(a.ok === true && a.target === 'emulator', 'a stray --confirm-project cannot switch the target to production');
}

// ── Paging / budget flags ────────────────────────────────────────────────────
{
  const a = parse(['--limit=250', '--max-pages=5', '--start-after=game_task']);
  ok(a.ok === true && a.limit === 250 && a.maxPages === 5, 'numeric flags parse');
  ok(a.startAfter === 'game_task', '--start-after supplies the resume cursor');
}
for (const bad of ['--limit=0', '--limit=-3', '--limit=abc', '--limit=1001', '--max-pages=0', '--max-pages=x']) {
  const a = parse([bad]);
  ok(a.ok === false, `${bad} is rejected loudly rather than clamped silently`);
}
{
  const a = parse(['--limit=1000']);
  ok(a.ok === true && a.limit === 1000, 'the callable\'s own maximum (1000) is accepted');
}
{
  const a = parse(['--nope']);
  ok(a.ok === false, 'an unknown flag is an error (a mistyped --execute must never run as a no-op)');
}
{
  const a = parse(['--help']);
  ok(a.help === true, '--help is recognised');
}
{
  // Env may supply the target, but the confirmation rule still applies to it.
  const a = parse(['--execute'], { RUSHPOINT_BACKFILL_PROJECT: 'prod-project' });
  ok(a.target === 'project' && a.projectId === 'prod-project', 'the env var can select the target project');
  ok(a.ok === false, 'an env-selected non-emulator target still requires --confirm-project');
}

// ── The pre-flight banner names the target ───────────────────────────────────
{
  const emu = describeTarget(parse([]));
  ok(/emulator/i.test(emu), 'the emulator banner says emulator');
  ok(emu.includes(EMULATOR_PROJECT_ID), 'the emulator banner still prints the project id');
  ok(/dry.?run/i.test(emu), 'the banner states the mode');

  const prod = describeTarget(parse(['--project=rushpoint-pwa-7daaa', '--execute', '--confirm-project=rushpoint-pwa-7daaa']));
  ok(prod.includes('rushpoint-pwa-7daaa'), 'the project banner prints the project id');
  ok(/REAL PROJECT|PRODUCTION/i.test(prod), 'the project banner is unmistakably about a real project');
  ok(/EXECUTE|WRITE/i.test(prod), 'the executing banner says writes will happen');
}

// ── decidePage: the paging loop ──────────────────────────────────────────────
const page = (over: Record<string, unknown> = {}) =>
  ({ ok: true, scanned: 500, repaired: 3, cleared: 1, orphaned: 0, cursor: 'doc-500', done: false, ...over });
const decide = (p: unknown, over: Record<string, unknown> = {}) =>
  decidePage({ page: p, previousCursor: null, pageIndex: 0, maxPages: DEFAULT_MAX_PAGES, ...over });

{
  const d = decide(page());
  ok(d.action === 'continue', 'a full page that is not done continues');
  ok(d.cursor === 'doc-500', 'the loop advances with the page\'s cursor');
}
{
  const d = decide(page({ done: true, scanned: 12, cursor: 'doc-12' }));
  ok(d.action === 'stop', 'done:true stops the loop');
}
{
  const d = decide(page({ done: true, scanned: 0, cursor: null }));
  ok(d.action === 'stop', 'a done, EMPTY page (null cursor) stops cleanly — nothing left to sweep');
}
{
  const d = decide(page(), { previousCursor: 'doc-500' });
  ok(d.action === 'fail', 'a cursor that did not move is a failure, not another lap');
  ok(/cursor/i.test(d.reason), `the failure names the cursor (reason=${d.reason})`);
}
{
  const d = decide(page({ cursor: null }));
  ok(d.action === 'fail', 'not done but no cursor to advance past → fail rather than spin');
}
{
  const d = decide(page({ cursor: '' }));
  ok(d.action === 'fail', 'an empty-string cursor is not a cursor');
}
{
  const d = decide(page({ ok: false }));
  ok(d.action === 'fail', 'ok:false aborts the sweep');
}
{
  const d = decide(page({ ok: undefined }));
  ok(d.action === 'fail', 'a response without ok:true aborts the sweep');
}
for (const junk of [null, undefined, 'not-an-object', 42, []]) {
  const d = decide(junk);
  ok(d.action === 'fail', `a malformed response (${JSON.stringify(junk) ?? 'undefined'}) aborts instead of looping`);
}
{
  const d = decide(page({ scanned: 'many' }));
  ok(d.action === 'fail', 'non-numeric counters abort (the progress report would be a lie)');
}
{
  const d = decide(page({ scanned: NaN }));
  ok(d.action === 'fail', 'NaN counters abort');
}
{
  const d = decide(page({ done: 'yes' }));
  ok(d.action === 'fail', 'a non-boolean `done` is not interpreted as truthy — it aborts');
}
{
  // THE BOUND: even a server that keeps handing back fresh cursors forever must stop.
  const d = decide(page({ cursor: 'doc-9999' }), { pageIndex: 200, maxPages: 200 });
  ok(d.action === 'fail', 'the page budget bounds the loop (a server that never says done cannot spin forever)');
  ok(/budget|page/i.test(d.reason), `the failure names the budget (reason=${d.reason})`);
}
{
  const d = decide(page({ cursor: 'doc-9999' }), { pageIndex: 199, maxPages: 200 });
  ok(d.action === 'continue', 'the last page inside the budget still runs');
}
{
  // A finite loop simulation: never more than maxPages iterations, always terminates.
  let cursor: string | null = null;
  let i = 0;
  let action = 'continue';
  while (action === 'continue' && i < 1000) {
    const d = decidePage({
      page: { ok: true, scanned: 500, repaired: 0, cleared: 0, orphaned: 0, cursor: `doc-${i}`, done: false },
      previousCursor: cursor, pageIndex: i, maxPages: 7,
    });
    action = d.action;
    cursor = d.cursor;
    i++;
  }
  ok(action === 'fail' && i === 8, `an endless server terminates at the budget (stopped after ${i} pages)`);
}

// ── accumulateTotals ─────────────────────────────────────────────────────────
{
  const t0 = accumulateTotals(null, page({ scanned: 500, repaired: 4, cleared: 2, orphaned: 1 }));
  ok(t0.scanned === 500 && t0.repaired === 4 && t0.skipped === 496, 'skipped = scanned − repaired');
  const t1 = accumulateTotals(t0, page({ scanned: 10, repaired: 0, cleared: 0, orphaned: 0, done: true }));
  ok(t1.scanned === 510 && t1.repaired === 4 && t1.cleared === 2 && t1.orphaned === 1, 'totals accumulate across pages');
  ok(t1.pages === 2, 'pages are counted');
  const t2 = accumulateTotals(t1, page({ scanned: undefined, repaired: undefined }));
  ok(t2.scanned === 510 && t2.repaired === 4, 'missing counters contribute zero, never NaN');
}

console.log(failed === 0
  ? `\n✅ ALL PUBLIC-TASK-BACKFILL TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
