// Pure-logic unit-test runner — the TDD "fast lane".
//
// Discovers and runs every scripts/test-*.ts assertion script (tsx) in one shot,
// reporting a per-file pass/fail and exiting non-zero if ANY file fails. This is
// what wires the otherwise-orphaned pure-logic tests into the `npm test` gate so
// they can never silently rot again (a stale test-projection.ts referencing a
// renamed helper went unnoticed for exactly this reason).
//
// These tests need NO emulator — they import shared/functions pure logic directly
// (scoring, geo, validation, projection, station idempotency, …). Emulator-bound
// lifecycle checks live in scripts/e2e-verify.mjs (`npm run e2e`).
//
//   node scripts/run-unit-tests.mjs
//
// ── Why this file looks the way it does (change: unit-lane-speed) ─────────────
// The suite is ~190 files of pure logic; the ASSERTIONS cost roughly 20 ms each.
// The old runner spent ~4.6 s per file anyway, because it shelled out to
// `npx tsx <file>` with `shell: true` — measured on this machine:
//     npx tsx …                 4.63 s      (npx resolution + cmd.exe + tsx boot)
//     ./node_modules/.bin/tsx … 1.90 s
//     node --import tsx …       1.02 s
// So ~98% of a 14-minute `npm test` was process startup, paid 190 times. Two
// structural fixes, neither of which touches a single assertion:
//   1. Spawn `process.execPath --import tsx` directly — no npx, no shell.
//   2. Run the files CONCURRENTLY across the cores that were sitting idle.
// ONE PROCESS PER FILE is kept deliberately. Batching many files into a shared
// tsx process would be faster still, but these scripts are top-level programs
// that end in `process.exit(...)` and import product singletons — sharing a
// process would mean shimming exit and letting one file's module state reach the
// next. Isolation is the whole point of the lane, so it stays exactly as strong
// as it was; only the wrapper around it got cheap.
//
// Because parallel output would interleave into noise, each file's stdout/stderr
// is BUFFERED and replayed: passes get one line, and any failure is replayed in
// full at the end, so a red run reads better than it did serially.
//
//   RUSHPOINT_UNIT_CONCURRENCY=1   run serially with live inherited output
//                                  (the debugging path; identical semantics)
//   RUSHPOINT_UNIT_TIMEOUT_MS=…    per-file timeout (default 120000)
//
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpus } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(here)
  .filter((f) => /^test-.*\.ts$/.test(f))
  .sort();

if (files.length === 0) {
  console.error('No scripts/test-*.ts files found.');
  process.exit(1);
}

// A pure-logic file that runs longer than this is hung, not slow. The old runner
// had no timeout at all, so one hang wedged the whole gate indefinitely.
const TIMEOUT_MS = Number(process.env.RUSHPOINT_UNIT_TIMEOUT_MS) || 120_000;

const parsedConcurrency = Number(process.env.RUSHPOINT_UNIT_CONCURRENCY);
const CONCURRENCY = Number.isFinite(parsedConcurrency) && parsedConcurrency >= 1
  ? Math.floor(parsedConcurrency)
  // Leave a core for the OS; more than 12 node boots at once just thrashes.
  : Math.max(1, Math.min(12, (cpus()?.length ?? 4) - 1));

const SERIAL = CONCURRENCY === 1;

console.log(`\n🧪 Pure-logic unit suite — ${files.length} file(s) · concurrency ${CONCURRENCY}\n`);

/** Run one file in its own tsx process. Never rejects; resolves a verdict. */
function runFile(file) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', join(here, file)], {
      // Serial mode is the debugging path: stream it live, exactly like before.
      stdio: SERIAL ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      cwd: dirname(here),
    });

    let output = '';
    if (!SERIAL) {
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    const finish = (status, spawnError) => {
      clearTimeout(timer);
      resolve({
        file,
        ok: !timedOut && !spawnError && status === 0,
        ms: Date.now() - startedAt,
        output: timedOut
          ? `${output}\n[runner] TIMED OUT after ${TIMEOUT_MS} ms — treated as a failure.`
          : spawnError
            ? `${output}\n[runner] failed to spawn: ${spawnError.message}`
            : output,
      });
    };

    child.on('error', (err) => finish(null, err));
    child.on('close', (status) => finish(status, null));
  });
}

const results = [];
let nextIndex = 0;
let done = 0;

async function worker() {
  while (nextIndex < files.length) {
    const file = files[nextIndex++];
    if (SERIAL) console.log(`\x1b[1m▶ ${file}\x1b[0m`);
    const res = await runFile(file);
    results.push(res);
    done++;
    if (SERIAL) {
      console.log('');
    } else {
      const mark = res.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const counter = String(done).padStart(String(files.length).length, ' ');
      console.log(`${mark} ${counter}/${files.length}  ${file} \x1b[90m(${res.ms} ms)\x1b[0m`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

const failures = results.filter((r) => !r.ok).sort((a, b) => a.file.localeCompare(b.file));

// A red run must be at least as readable as the serial one was: replay the full
// output of every failing file, so the assertion that broke is right there.
if (!SERIAL) {
  for (const f of failures) {
    console.error(`\n\x1b[31m${'─'.repeat(70)}\n✗ ${f.file}\n${'─'.repeat(70)}\x1b[0m`);
    console.error(f.output.trimEnd());
  }
}

// Slowest files, so a genuinely slow test can't hide inside a fast suite.
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log(`\n\x1b[90mslowest: ${slowest.map((r) => `${r.file} ${r.ms}ms`).join(' · ')}\x1b[0m`);

if (failures.length > 0) {
  console.error(`\n\x1b[31m✗ ${failures.length}/${files.length} unit file(s) FAILED: ${failures.map((f) => f.file).join(', ')}\x1b[0m`);
  process.exit(1);
}

console.log(`\x1b[32m✓ All ${files.length} pure-logic unit file(s) passed.\x1b[0m`);
