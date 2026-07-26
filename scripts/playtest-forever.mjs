// Supervisor: keep `npm run playtest:ngrok` UP forever, independent of any editor
// / agent / Claude-Code process. Launched detached (see scripts/playtest-forever.README),
// it survives the parent that started it and stays up as long as the machine is on.
//
// Behavior:
//   • Single-instance: if a live supervisor is already running (pid file → alive
//     process), this launch exits immediately. That makes it SAFE for the login
//     watchdog to (re)launch this every few minutes — it restarts a dead supervisor
//     (after sleep/hibernate/crash/reboot) and no-ops when one is already up.
//   • Run the full playtest stack; if it exits for ANY reason (crash, ngrok drop
//     that takes the stack down, transient network), free ports and relaunch after
//     a short backoff.
//   • Git auto-update: poll `origin` every few minutes. When new commits land on the
//     tracked branch (i.e. you pushed from another machine), pull them, `npm install`
//     if deps changed, and restart the stack so functions/shared/deps rebuild. The
//     ngrok link is a fixed reserved domain, so it never changes across restarts.
//   • A stop-file (or SIGINT) ends the supervisor cleanly.
//
//   node scripts/playtest-forever.mjs            # run the supervisor loop
//   node scripts/playtest-forever.mjs --stop     # ask a running supervisor to stop
//
// Logs → .firebase/playtest-forever.log  ·  PID → .firebase/playtest-forever.pid
// Stop → create .firebase/playtest-forever.stop (the loop notices and exits)

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canFastForwardApply } from './lib/gitUpdateGuard.mjs';
import { didExportSucceed, isEmulatorReady, decidePostBuildAction } from './lib/emulatorBackup.mjs';
import { depsNeedInstall } from './lib/depsGuard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.firebase');
const LOG = path.join(STATE_DIR, 'playtest-forever.log');
const PIDF = path.join(STATE_DIR, 'playtest-forever.pid');
const STOPF = path.join(STATE_DIR, 'playtest-forever.stop');
const RESTART_BACKOFF_MS = 4_000;
const GIT_POLL_MS = 3 * 60_000;   // check origin for new commits every 3 minutes
// Single-instance LOCK port. Bound on loopback for the supervisor's whole lifetime;
// the OS lets exactly one process hold it and RELEASES it automatically when that
// process dies (even a hard SIGKILL/poweroff) — so it's race-free where the pid file
// is not. NOT one of the stack's real ports; picked high to avoid collisions.
const LOCK_PORT = 47615;
// The stack to serve. Default `playtest:prod` = pre-built + minified static apps
// served via `vite preview` (dramatically faster over the tunnel than the dev
// server). Override with PLAYTEST_TARGET=playtest:ngrok to fall back to dev mode.
const TARGET = process.env.PLAYTEST_TARGET || 'playtest:prod';
const NEEDS_BUILD = TARGET === 'playtest:prod';

fs.mkdirSync(STATE_DIR, { recursive: true });

function log(line) {
  const stamp = new Date().toISOString();
  const msg = `[forever ${stamp}] ${line}\n`;
  try { fs.appendFileSync(LOG, msg); } catch { /* ignore */ }
  process.stdout.write(msg);
}

// --stop: signal a running supervisor to exit.
if (process.argv.includes('--stop')) {
  fs.writeFileSync(STOPF, String(Date.now()));
  log('stop requested (wrote .stop file); the supervisor will exit after the current stack tears down.');
  process.exit(0);
}

// --- single-instance guard (race-free, OS-enforced) ------------------------
// Authoritative check: try to hold an exclusive loopback lock port. Only one process
// can bind it, and the OS frees it the instant the holder dies — so this is immune to
// the pid-file races that let TWO supervisors run at once (delete-then-relaunch, or
// two watchdog fires seconds apart), which spawned two full stacks fighting over the
// same ports → endless `--kill-others-on-fail` crash loop. A stale pid file or a hard
// SIGKILL can't fool it: a dead holder's port is already released; a live holder's is
// not. The pid file remains, but only for `--stop` targeting + human-readable logs.
const lockServer = net.createServer();
lockServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`another supervisor already holds the single-instance lock (:${LOCK_PORT}); this launch exits. (watchdog no-op)`);
  } else {
    log(`single-instance lock error (${e.code || e.message}) — exiting to be safe rather than risk a duplicate.`);
  }
  process.exit(0);
});
// Block startup until the lock is acquired (or we've exited above). listen() resolves
// async, so gate the rest of boot on it. Keep the socket referenced so it holds the
// lock for the whole process lifetime; stop() closes it.
await new Promise((resolve) => {
  lockServer.once('listening', resolve);
  lockServer.listen(LOCK_PORT, '127.0.0.1');
});

if (fs.existsSync(STOPF)) fs.rmSync(STOPF, { force: true });
fs.writeFileSync(PIDF, String(process.pid));
log(`supervisor up (pid ${process.pid}). Keeping playtest:ngrok alive until --stop / .stop file / SIGINT.`);

let child = null;
let buildChild = null;
let stopping = false;

// --- git auto-update -------------------------------------------------------
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function headSha() { return git(['rev-parse', 'HEAD']).out; }

// Rate-limiter for the "can't fast-forward" log: because the poll runs every few
// minutes, a persistently-blocked update would otherwise log every cycle. We only
// re-log when the (reason, upstreamSha) pair changes.
let lastBlockedKey = null;
function logBlockedOnce(reason, upstreamSha, human) {
  const key = `${reason}@${upstreamSha}`;
  if (key === lastBlockedKey) return;
  lastBlockedKey = key;
  log(human);
}

// Fetch origin and assess whether the tracked upstream can be FAST-FORWARDED cleanly
// onto the working tree — the branch is strictly behind (not diverged) AND no file the
// incoming commits change is locally modified. This is consulted BEFORE any stack
// teardown so we never collapse for an update that would then fail to pull. Returns
// { assessed, ok, reason, behind, upstreamRef, upstreamSha }. `assessed` is false when
// we couldn't even evaluate (offline / no upstream) — treat as "do nothing".
function assessUpdate() {
  const f = git(['fetch', '--quiet', 'origin']);
  if (f.code !== 0) { log(`git fetch failed (offline?): ${f.err || f.out}`); return { assessed: false }; }

  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstream.code !== 0) { log('no upstream tracking branch configured — skipping auto-update.'); return { assessed: false }; }
  const upstreamRef = upstream.out;
  const upstreamSha = git(['rev-parse', upstreamRef]).out;

  const counts = git(['rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`]);
  const [aheadStr, behindStr] = counts.out.split(/\s+/);
  const ahead = Number.parseInt(aheadStr || '0', 10);
  const behind = Number.parseInt(behindStr || '0', 10);

  // Files the incoming commits change, vs. locally-modified TRACKED files. `status
  // --porcelain` XY codes: skip untracked ('??') — they can't block a fast-forward.
  const changedUpstreamFiles = behind > 0
    ? git(['diff', '--name-only', `HEAD..${upstreamRef}`]).out.split(/\r?\n/).filter(Boolean)
    : [];
  const dirtyFiles = git(['status', '--porcelain'])
    .out.split(/\r?\n/)
    .filter((l) => l && !l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);

  const { ok, reason } = canFastForwardApply({ ahead, behind, changedUpstreamFiles, dirtyFiles });
  return { assessed: true, ok, reason, behind, ahead, upstreamRef, upstreamSha };
}

// Perform the pull ONLY when a fast-forward is safe. Returns true if HEAD actually
// moved (→ stack should rebuild). A blocked update logs once (rate-limited) and keeps
// serving the current build rather than failing a pull every relaunch.
function updateFromGit() {
  const before = headSha();
  const a = assessUpdate();
  if (!a.assessed) return false;
  if (!a.ok) {
    if (a.reason !== 'up-to-date') {
      logBlockedOnce(a.reason, a.upstreamSha,
        a.reason === 'diverged'
          ? `update on ${a.upstreamRef} can't fast-forward: local branch has diverged (${a.ahead} commit(s) ahead). Serving current build.`
          : `update on ${a.upstreamRef} can't fast-forward: local changes to ${a.reason.slice('dirty-conflict:'.length)} would be overwritten. Commit/stash to apply. Serving current build.`);
    }
    return false;
  }

  log(`update available: ${a.behind} new commit(s) on ${a.upstreamRef} — pulling…`);
  const pull = git(['pull', '--ff-only']);
  if (pull.code !== 0) {
    // Guard said it was safe but the pull still failed — surface it and keep serving.
    log(`git pull --ff-only failed unexpectedly: ${pull.err || pull.out}. Serving current build.`);
    return false;
  }
  const after = headSha();
  if (after === before) return false;

  log(`updated ${before.slice(0, 8)} → ${after.slice(0, 8)}.`);
  lastBlockedKey = null; // moved forward — clear any prior blocked state
  // Reinstall deps only if the lockfile/manifests changed in the pulled range. Use
  // `npm ci` (installs from the lockfile, never rewrites it) so a dependency update
  // can't leave package-lock.json dirty and block the NEXT fast-forward.
  const changed = git(['diff', '--name-only', `${before}`, `${after}`]).out;
  if (/(^|\n)(package(-lock)?\.json|.*\/package\.json)(\n|$)/.test(changed)) {
    log('dependency manifests changed — running npm ci…');
    const ni = spawnSync('npm', ['ci'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
    log(ni.status === 0 ? 'npm ci ok.' : `npm ci exited ${ni.status} — serving current build.`);
  }
  return true;
}

function freePorts() {
  return new Promise((resolve) => {
    const p = spawn('node', ['scripts/free-ports.mjs'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
    p.on('exit', () => resolve());
    p.on('error', () => resolve());
  });
}

// The fixed Emulator Hub port. The Hub answers with a JSON map of the running
// emulators; `isEmulatorReady` (shared with the periodic backup loop) treats the suite
// as export-safe only once BOTH firestore and functions appear (functions load last).
const HUB_EMULATORS_URL = 'http://127.0.0.1:4400/emulators';

// Async readiness probe of the Emulator Hub, used to gate the primary export. A short
// AbortSignal.timeout keeps a hung/booting Hub from stalling teardown; ANY failure
// (offline, mid-boot 404/connection-refused, timeout, non-JSON) → not ready → the
// caller skips the export rather than risk clobbering the primary dir with a partial
// snapshot. Pure I/O only; the readiness decision itself lives in isEmulatorReady.
async function isPrimaryEmulatorReady() {
  try {
    const res = await fetch(HUB_EMULATORS_URL, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return false;
    return isEmulatorReady(await res.json());
  } catch {
    return false;   // no Hub / mid-boot / timeout → treat as not ready (never export blind)
  }
}

// Force a LIVE export of the running emulator into the PRIMARY data dir before any
// planned teardown. Critical on Windows: child.kill() hard-terminates the emulator
// (TerminateProcess), so the emulator's own --export-on-exit NEVER fires on a
// programmatic stop — without this, every restart falls back to the periodic backup,
// which can be up to one interval (~2 min) stale. `emulators:export` talks to the
// Emulator Hub of the still-running suite (no kill, no signal needed), so it captures
// the TRUE latest state; dev-emulator.mjs then imports this primary dir on relaunch
// (it's preferred over any backup). Best-effort: on failure the periodic backup loop
// still covers us, so we log and proceed with the teardown rather than block it.
//
// Success is judged by the metadata file's mtime, NOT spawnSync's exit status — on
// Windows `firebase emulators:export` hits a libuv assertion during its own shutdown
// (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, src/win/async.c) and
// returns a garbage non-zero status EVEN WHEN THE EXPORT GENUINELY SUCCEEDED. Trusting
// r.status made this log "failed" on every single call. See didExportSucceed's doc
// comment (scripts/lib/emulatorBackup.mjs) for the full mechanism.
//
// Readiness gate (see isPrimaryEmulatorReady below): we ONLY export when the suite is
// fully booted. A `!child` check alone is not enough — the git poll (every 3 min) can
// fire during a fresh 60-90s emulator boot, or a stop can land seconds after launch, so
// `child` is set but Firestore/Functions aren't up yet. Exporting then writes a partial
// or empty snapshot into the PRIMARY dir, which dev-emulator.mjs imports preferentially
// on the next boot → it becomes the "freshest" state and REAL data is lost (and a mid-boot
// export can wedge Firestore). This mirrors the periodic backup loop's Hub-readiness gate.
async function exportPrimaryNow() {
  const dest = path.join(STATE_DIR, 'emulator-data');
  // Only meaningful while the suite is up (the source of the live data). If the stack
  // is already gone, the Hub is down and export would just fail — skip quietly.
  if (!child) { log('export skipped: stack not running (nothing live to snapshot).'); return false; }
  // Skip when the emulator isn't fully booted — see the block comment above. The caller
  // then relies on the last periodic backup (which uses the same readiness gate) rather
  // than clobbering the primary dir with a partial snapshot.
  if (!(await isPrimaryEmulatorReady())) {
    log(`primary export skipped: emulator not ready (mid-boot or stopping) — periodic backup (≤${Math.round((Number(process.env.EMU_BACKUP_INTERVAL_MS || 120000)) / 1000)}s old) still covers us.`);
    return false;
  }
  log('exporting live emulator → primary data dir before teardown…');
  const metaPath = path.join(dest, 'firebase-export-metadata.json');
  const beforeMtimeMs = fs.existsSync(metaPath) ? fs.statSync(metaPath).mtimeMs : null;
  const r = spawnSync('npx', ['firebase', 'emulators:export', dest, '--force', '--project', 'rushpoint-pwa-7daaa'], {
    cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32', timeout: 90_000,
  });
  const afterExists = fs.existsSync(metaPath);
  const afterMtimeMs = afterExists ? fs.statSync(metaPath).mtimeMs : undefined;
  const ok = didExportSucceed({ beforeMtimeMs, afterExists, afterMtimeMs });
  log(ok
    ? `primary export ok (child exit status=${r.status ?? '?'}, ignored — see comment above) — next boot imports the latest state (0 data loss).`
    : `primary export failed (status=${r.status ?? '?'}${r.error ? `, ${r.error.message}` : ''}) — periodic backup (≤${Math.round((Number(process.env.EMU_BACKUP_INTERVAL_MS || 120000)) / 1000)}s old) still covers us.`);
  return ok;
}

// True once both apps have a PLAYTEST production build on disk that `vite preview`
// can serve. It must probe `dist-playtest`, not `dist` (change: playtest-build-isolation):
// `dist` is what the verification gate writes, and the playtest previews are pinned to
// `--outDir dist-playtest`. Probing `dist` would report "ready" off an artifact this
// stack never serves, so a failed playtest:build on a fresh host would take the
// launch-stale branch and boot `vite preview` onto an empty directory.
function distReady() {
  return fs.existsSync(path.join(ROOT, 'apps', 'creator-web', 'dist-playtest', 'index.html'))
    && fs.existsSync(path.join(ROOT, 'apps', 'play-web', 'dist-playtest', 'index.html'));
}

// Build the production bundles the prod stack serves. Runs once at boot and again
// after each git update. Resolves TRUE only on a clean build — the caller keeps
// needBuild armed on failure so it retries next loop instead of crash-looping on a
// missing/stale dist (a fresh host has no dist until the first build succeeds).
// Install deps if the lockfile is newer than npm's own install-state snapshot
// (node_modules/.package-lock.json), REGARDLESS of how the lockfile got here. The
// git-update path (updateFromGit, above) only runs `npm ci` when the supervisor
// itself performed the pull; a manual `git pull`/rebase/stash-restore in the same
// working tree (e.g. resolving a divergence or a dirty-file block by hand) changes
// the lockfile too but skips that check entirely — the next build then runs against
// a stale node_modules and fails on any genuinely new dependency. This runs
// unconditionally before every build attempt; the mtime comparison is two stat
// calls, so it's a no-op cost when already in sync.
function ensureDepsInstalled() {
  return new Promise((resolve) => {
    const lockPath = path.join(ROOT, 'package-lock.json');
    const markerPath = path.join(ROOT, 'node_modules', '.package-lock.json');
    const lockMtimeMs = fs.existsSync(lockPath) ? fs.statSync(lockPath).mtimeMs : NaN;
    const markerMtimeMs = fs.existsSync(markerPath) ? fs.statSync(markerPath).mtimeMs : NaN;
    if (!depsNeedInstall({ lockMtimeMs, markerMtimeMs })) { resolve(true); return; }
    log('package-lock.json is newer than the installed node_modules snapshot — running npm ci before building…');
    const ni = spawnSync('npm', ['ci'], { cwd: ROOT, stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')], shell: process.platform === 'win32' });
    log(ni.status === 0 ? 'npm ci ok.' : `npm ci exited ${ni.status ?? '?'} — build will likely fail; will retry next cycle.`);
    resolve(ni.status === 0);
  });
}

// Build everything the prod stack needs, functions FIRST as a compile gate. Returns
// { functionsOk, appsBuilt }:
//   • functionsOk — the functions workspace tsc-compiled. This is the crash-loop guard:
//     `playtest:build` only builds shared+creator+play, but `playtest:prod` boots the
//     emulator via dev-emulator.mjs which itself runs `npm run build --workspace=functions`
//     and does process.exit(1) on failure. Under `concurrently --kill-others-on-fail` that
//     tears the WHOLE stack down → 4s backoff → forever. The git ff-guard only checks that
//     a pull APPLIES cleanly, never that the pulled code COMPILES, so a non-compiling
//     functions/ push would otherwise crash-loop the stack indefinitely. Building it here
//     first lets the caller detect the break and keep serving the previous good build.
//   • appsBuilt — creator-web + play-web bundles built (npm run playtest:build).
// We only attempt the app bundles when functions compiles (no point building apps for a
// stack we won't launch). ensureDepsInstalled runs first as before.
function buildProd() {
  return ensureDepsInstalled().then(() => new Promise((resolve) => {
    // Rebuild @rushpoint/shared FIRST. functions compiles+bundles against
    // packages/shared/dist, so a pull that adds a new shared export (e.g.
    // galleryFilter) must rewrite dist BEFORE the functions build reads it — build
    // functions against a stale dist and either the compile fails (→ stack keeps
    // serving the old build) or the emulator later loads a shared missing that
    // export and the callable throws INTERNAL at runtime. playtest:build (below)
    // also builds shared, but it runs AFTER functions — too late. This honors the
    // documented "shared before functions" invariant (see CLAUDE.md). Idempotent:
    // the later shared:build inside playtest:build is a cheap no-op re-run.
    log('building @rushpoint/shared before functions (functions compiles against shared/dist)…');
    const sharedBuild = spawnSync('npm', ['run', 'shared:build'], {
      cwd: ROOT,
      stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
      shell: process.platform === 'win32',
    });
    if (sharedBuild.status !== 0) {
      log(`shared build FAILED (status=${sharedBuild.status ?? '?'}${sharedBuild.error ? `, ${sharedBuild.error.message}` : ''}) — not launching (functions would compile against a stale/broken shared); retrying next cycle.`);
      resolve({ functionsOk: false, appsBuilt: false });
      return;
    }
    log('compile-gating functions: npm run build --workspace=functions…');
    const fnBuild = spawnSync('npm', ['run', 'build', '--workspace=functions'], {
      cwd: ROOT,
      stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
      shell: process.platform === 'win32',
    });
    if (fnBuild.status !== 0) {
      // Do NOT launch: dev-emulator.mjs would exit(1) on this same failure and crash-loop
      // the stack. Signal functionsOk=false so the caller backs off and retries next cycle.
      log(`functions build FAILED (status=${fnBuild.status ?? '?'}${fnBuild.error ? `, ${fnBuild.error.message}` : ''}) — not launching (would crash-loop dev-emulator's exit(1)); retrying next cycle.`);
      resolve({ functionsOk: false, appsBuilt: false });
      return;
    }
    log('functions compile ok — building app bundles: npm run playtest:build…');
    buildChild = spawn('npm', ['run', 'playtest:build'], {
      cwd: ROOT,
      stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
      shell: process.platform === 'win32',
    });
    buildChild.on('exit', (code) => {
      log(`playtest:build finished (code=${code}).`);
      buildChild = null;
      resolve({ functionsOk: true, appsBuilt: code === 0 });
    });
    buildChild.on('error', (err) => {
      log(`playtest:build failed to spawn: ${err.message} — will retry.`);
      buildChild = null;
      resolve({ functionsOk: true, appsBuilt: false });
    });
  }));
}

function runOnce() {
  return new Promise((resolve) => {
    log(`launching: npm run ${TARGET}`);
    child = spawn('npm', ['run', TARGET], {
      cwd: ROOT,
      stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
      shell: process.platform === 'win32',
    });
    child.on('exit', (code, signal) => {
      log(`${TARGET} exited (code=${code}, signal=${signal}).`);
      child = null;
      resolve();
    });
    child.on('error', (err) => {
      log(`failed to spawn ${TARGET}: ${err.message}`);
      child = null;
      resolve();
    });
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  log('stopping supervisor…');
  if (gitTimer) clearInterval(gitTimer);
  if (stopWatch) clearInterval(stopWatch);
  // AWAIT the export before the hard kill: exportPrimaryNow is async now (it probes the
  // Hub for readiness first), and the snapshot must finish writing before child.kill()
  // TerminateProcess's the emulator out from under it.
  await exportPrimaryNow();   // capture latest live state before we hard-kill the emulator
  if (child) { try { child.kill(); } catch { /* ignore */ } }
  if (buildChild) { try { buildChild.kill(); } catch { /* ignore */ } }
  await freePorts();
  try { lockServer.close(); } catch { /* ignore */ }   // release the single-instance lock port
  try { fs.rmSync(PIDF, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(STOPF, { force: true }); } catch { /* ignore */ }
  log('supervisor stopped.');
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Background poll: while the stack is up, watch origin. When a push lands that can
// actually FAST-FORWARD, kill the running stack — the loop below then pulls and
// relaunches. Critically, we assess ff-safety BEFORE killing: a dirty tree or a
// diverged branch means the pull would fail, so we keep serving instead of collapsing
// the stack every few minutes (the old thrash-restart loop). Guarded so only one
// check runs at a time and none runs mid-teardown; blocked updates log once.
let gitTimer = null;
let checking = false;
gitTimer = setInterval(async () => {
  if (stopping || checking || !child) return;
  checking = true;
  try {
    const a = assessUpdate();
    if (!a.assessed) return;
    if (a.ok) {
      log(`poll: ${a.behind} new commit(s) upstream (fast-forward safe) — restarting stack to apply.`);
      // AWAIT the export before killing — exportPrimaryNow is async (readiness-gated) and
      // its snapshot must land before child.kill() terminates the emulator. Re-check
      // `child` after the await: a concurrent stop()/exit could have cleared it meanwhile.
      await exportPrimaryNow();   // snapshot latest live state so the relaunch imports it (not a stale backup)
      if (child) { try { child.kill(); } catch { /* the exit handler resolves runOnce */ } }
    } else if (a.reason !== 'up-to-date') {
      logBlockedOnce(a.reason, a.upstreamSha,
        a.reason === 'diverged'
          ? `poll: ${a.behind} new commit(s) upstream but local branch diverged (${a.ahead} ahead) — keeping stack up.`
          : `poll: ${a.behind} new commit(s) upstream but local changes to ${a.reason.slice('dirty-conflict:'.length)} block a fast-forward — keeping stack up. Commit/stash to apply.`);
    }
  } finally { checking = false; }
}, GIT_POLL_MS);

// Prompt stop-file watcher: `npm run playtest:stop` writes STOPF. Without this the
// running supervisor only notices STOPF *between* restart cycles (i.e. after the
// stack independently dies), so a user wanting to stop had no clean lever and would
// reach for a force-kill — the very thing that skips the emulator export and risks
// data loss. Polling STOPF every few seconds gives `playtest:stop` a prompt, CLEAN
// teardown (export → kill), so force-killing is never necessary. (Signals can't do
// this on Windows: process.kill to a detached pid terminates it without running its
// handlers, so a stop-file is the only cross-platform graceful trigger.)
let stopWatch = null;
stopWatch = setInterval(() => {
  if (stopping) return;
  if (fs.existsSync(STOPF)) { stop(); }
}, 3_000);

// Supervisor loop: pull latest, (re)build for prod when the code changed, run the
// stack, and whenever it dies, clean ports, re-pull (in case the poll above
// triggered the exit), and relaunch. A plain crash restart skips the rebuild for
// fast recovery; only a fresh boot or a real git update rebuilds.
let needBuild = NEEDS_BUILD;          // build once before the first prod launch
while (!stopping) {
  if (fs.existsSync(STOPF)) { await stop(); break; }
  // Free ports BEFORE updateFromGit(). updateFromGit() can run `npm ci`, which on Windows
  // deletes/recreates node_modules — if orphaned vite/esbuild processes from the previous
  // stack still hold handles under node_modules, that npm ci hits EPERM/EBUSY and leaves a
  // half-deleted node_modules that bricks every later build. freePorts() kills those orphans
  // first so the tree is quiescent before any dependency reinstall touches it. (The other
  // npm ci path, ensureDepsInstalled → buildProd, already runs after this freePorts.)
  await freePorts();                  // start each attempt from clean ports (kills orphan Java + vite/esbuild)
  if (updateFromGit()) needBuild = NEEDS_BUILD;   // new code pulled → rebuild (prod only)
  // Arm the build whenever there is nothing serveable, not just at boot / after a pull.
  // A plain crash restart deliberately skips the rebuild for fast recovery, which is
  // correct only while a serveable build exists. It does NOT after the playtest output
  // directory moved (change: playtest-build-isolation) or if it was deleted: the preview
  // would boot onto a missing --outDir, exit, and `concurrently --kill-others-on-fail`
  // would tear the stack down into a permanent 4s crash-loop that no later cycle escapes,
  // because needBuild stays false. Two stat calls; a no-op when a build is present.
  if (NEEDS_BUILD && !distReady()) needBuild = true;
  // Build before serving prod. Decision by decidePostBuildAction (pure, unit-tested):
  //   • retry-functions — functions didn't compile; launching would crash-loop
  //     dev-emulator's exit(1). Skip the launch, keep serving the previous good stack,
  //     back off, retry next cycle. NEVER launch on this — availability of the OLD build
  //     beats a guaranteed crash-loop of the new one.
  //   • retry-no-dist   — build failed AND no prior dist (fresh host); retry after backoff
  //     rather than crash-looping vite-preview on a missing dist.
  //   • launch-stale    — app build failed but a previous good dist exists; serve THAT
  //     (availability first — a broken app push never blacks out the site), needBuild armed.
  //   • launch-fresh    — clean build of everything.
  if (needBuild) {
    const { functionsOk, appsBuilt } = await buildProd();
    needBuild = !(functionsOk && appsBuilt);      // keep armed until BOTH are clean
    const action = decidePostBuildAction({ functionsOk, appsBuilt, distReady: distReady() });
    if (action === 'retry-functions') {
      log('functions failed to compile — skipping stack launch this cycle (would crash-loop); retrying after backoff.');
      await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
      continue;
    }
    if (action === 'retry-no-dist') {
      log('no serveable build yet (build failed, no dist) — retrying build after backoff.');
      await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
      continue;
    }
    if (action === 'launch-stale') log('app build failed — serving the previous good build; will retry on next restart/update.');
  }
  await runOnce();                    // blocks until the stack exits
  if (fs.existsSync(STOPF) || stopping) { await stop(); break; }
  log(`restarting in ${RESTART_BACKOFF_MS / 1000}s…`);
  await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
}
