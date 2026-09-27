// Dynamic imports fired from a CLICK must not be able to kill the button
// (change: handler-chunk-resilience).
//
// `lazyWithRetry` guards the route-level chunks, for the reason recorded in that
// file: a redeploy renames every hashed chunk, and a tab still holding the old
// service-worker shell asks for a name that no longer exists. Routes were covered;
// event handlers were not. Four share handlers did
//
//     const { sharePodium } = await import('../lib/podiumCard');
//
// with no catch anywhere above them. `useAsyncAction.run` deliberately re-throws
// so genuine errors are never swallowed, and nothing catches it — so the rejection
// became an unhandled promise rejection and the tap did nothing whatsoever. Same
// dead button as the share-ladder bug, different path, and it fires exactly when a
// deploy lands during a live run.
//
// The route helper reloads the page. That is wrong for a handler — reloading
// because someone tapped "share" discards whatever else they were doing, and none
// of these actions are load-bearing. So a handler chunk fails SOFTLY and the
// caller reports its ordinary failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadChunk } from '../apps/play-web/src/lib/loadChunk';

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf8');

console.log('\n[handler chunks] loadChunk never rejects');
void (async () => {
  ok(await loadChunk(async () => 'mod') === 'mod', 'a working import resolves the module');

  let attempts = 0;
  const flaky = await loadChunk(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('network blip');
    return 'mod';
  });
  ok(flaky === 'mod' && attempts === 2,
    'a single blip is retried once — a chunk fetch fails momentarily far more often than it fails for good');

  attempts = 0;
  const dead = await loadChunk(async () => { attempts += 1; throw new Error('404'); });
  ok(dead === null, 'a chunk that is really gone resolves NULL rather than rejecting');
  ok(attempts === 2, 'and it gives up after the second attempt instead of retrying forever');

  const sync = await loadChunk(() => { throw new Error('threw synchronously'); });
  ok(sync === null, 'a factory that throws synchronously is caught too');

  // ── The call sites ──────────────────────────────────────────────────────────
  console.log('\n[handler chunks] every handler-level dynamic import is guarded');

  // Files that fire a dynamic import from a user action rather than from a route.
  const HANDLER_FILES = [
    'apps/play-web/src/screens/FinalScreen.tsx',
    'apps/play-web/src/screens/PlayScreen.tsx',
  ];

  for (const file of HANDLER_FILES) {
    const src = read(file);
    // A BARE `await import(...)` — i.e. not passed to loadChunk as `() => import(...)`.
    const bare = [...src.matchAll(/await\s+import\s*\(/g)];
    const lines = bare.map((m) => src.slice(0, m.index ?? 0).split('\n').length);
    ok(bare.length === 0,
      `${file} has no bare \`await import(...)\` in a handler`,
      bare.length === 0 ? '' : `line(s) ${lines.join(', ')} — route this through loadChunk() so a stale chunk degrades instead of killing the tap`);
    ok(/loadChunk\(/.test(src), `${file} routes its chunk loads through loadChunk`);
  }

  // The creator's Excel export solved this independently and correctly (a toast on
  // failure). Pin that it keeps a catch, so it cannot regress into the same hole.
  console.log('\n[handler chunks] the creator export keeps its own failure path');
  const report = read('apps/creator-web/src/pages/RunReportPage.tsx');
  ok(/catch\s*\{[\s\S]{0,400}?exportFailed/.test(report),
    'RunReportPage still reports a failed workbook export instead of silently doing nothing',
    'downloadReportWorkbook dynamic-imports write-excel-file; without this catch the export button goes dead after a redeploy');

  console.log(failures === 0 ? '\n✅ handler chunk resilience: ALL PASS\n' : `\n❌ handler chunk resilience: ${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
