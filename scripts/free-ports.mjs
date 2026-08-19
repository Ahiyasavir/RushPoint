// ─────────────────────────────────────────────────────────────────────────────
// Frees the dev ports before launch so a stale Metro/Vite/emulator process from
// a previous run (e.g. a window closed without Ctrl+C) can't block startup or
// trigger Expo's non-interactive "port in use -> skip" exit.
//
// Wired as `predev:all` so npm runs it automatically before `dev:all`.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { reapOrphanEmulatorProcesses } from './lib/reapEmulatorExec.mjs';
import { sweepStaleHelpers } from './lib/killStaleHelpers.mjs';

const PORTS = [
  8081,                       // Metro (Expo)
  19000, 19001, 19006,        // legacy Expo
  5173, 5174, 5180, 5181,     // Vite (admin / creator / play — 5181 was missing and play-web servers survived every sweep)
  4000, 4400, 4500,           // Firebase emulator UI / hub / logging
  5001, 8080, 9099, 9199, 5002, // functions / firestore / auth / storage / hosting
  3000,                       // reverse proxy (tunnel)
];
const isWin = process.platform === 'win32';

// Orphaned helpers that DON'T listen on a port and so survive the port-based
// sweep below: a previous `playtest` relaunched without Ctrl+C leaves its
// emulator dead (port already taken) but its 2-min backup loop, tunnel, and
// reverse-proxy still running. Six accumulated backup loops all firing
// `firebase emulators:export` at the one live emulator wedges it (Firestore's
// export takes a hub lock; overlapping exports collide). Matched by command line
// via the shared pattern list (scripts/lib/staleHelperSweep.mjs's
// STALE_HELPER_PATTERNS — change: emulator-exec-port-race pulled this list and
// the kill loop out into scripts/lib/killStaleHelpers.mjs so emulator-exec.mjs's
// own pre-boot sweep uses the EXACT same safety carve-outs, not a second copy).
//
// Enumerate → decide → kill. There is deliberately NO selection logic here: every `if`
// about *whether* a process may die lives in the pure, unit-tested
// scripts/lib/staleHelperSweep.mjs (change: emulator-gate-isolation). Before that split
// this swept purely by command-line pattern, which meant an in-flight OFFSET gate run —
// which matches `emulators:exec`, `.cache\firebase\emulators`, `functionsEmulatorRuntime`
// AND `scripts/emulator-exec.mjs` — was destroyed by every playtest restart regardless of
// which ports it held. The planner now spares anything positively attributed to a
// different LIVE port block (a running emulators:exec session, an offset marker, or a
// `--port` outside the block being swept) and kills everything else exactly as before.
function killStaleHelpers() {
  sweepStaleHelpers({ sweptPorts: PORTS, label: 'free-ports' });
}

function killStaleImagesWindows() {
  // cloudflared spawns worker exes whose command line may not carry the pattern;
  // sweep any leftover by image name (dev-only; safe in this workflow).
  spawnSync('taskkill', ['/IM', 'cloudflared.exe', '/F', '/T'], { stdio: 'ignore' });
  // ngrok dials OUT (it doesn't listen on a swept port), so a leftover ngrok.exe
  // from a previous run survives the port sweep and — because the free tier allows
  // only ONE simultaneous agent session — wedges the new tunnel ("limited to 1
  // simultaneous session", retrying forever). Sweep it by image name too. No-op
  // (non-zero exit swallowed by stdio:'ignore') when no ngrok is running.
  spawnSync('taskkill', ['/IM', 'ngrok.exe', '/F', '/T'], { stdio: 'ignore' });
}

// cloudflared has no repo path in its command line and no session to belong to, so it
// keeps the blunt pattern sweep it always had. (The Windows side does the same by image
// name, above.)
function killCloudflaredUnix() {
  const res = spawnSync('bash', ['-c', 'pgrep -f cloudflared || true'], { encoding: 'utf8' });
  for (const pid of (res.stdout || '').split(/\s+/).filter(Boolean)) {
    if (Number(pid) === process.pid) continue;
    spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
    console.log(`[free-ports] Killed stale helper (PID ${pid})`);
  }
}

function freeWindows() {
  const res = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  const portSet = new Set(PORTS.map(String));
  const byPid = new Map(); // pid -> Set(ports)

  for (const line of (res.stdout || '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // Proto  Local  Foreign  State  PID
    if (cols.length < 5 || cols[0] !== 'TCP' || !/LISTENING/i.test(cols[3])) continue;
    const local = cols[1];
    const port = local.slice(local.lastIndexOf(':') + 1);
    if (!portSet.has(port)) continue;
    const pid = cols[4];
    if (!pid || pid === '0') continue;
    if (!byPid.has(pid)) byPid.set(pid, new Set());
    byPid.get(pid).add(port);
  }

  for (const [pid, ports] of byPid) {
    const r = spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    if (r.status === 0) console.log(`[free-ports] Freed ${[...ports].join(', ')} (PID ${pid})`);
  }
}

function freeUnix() {
  for (const port of PORTS) {
    const res = spawnSync('bash', ['-c', `lsof -ti tcp:${port} || true`], { encoding: 'utf8' });
    for (const pid of (res.stdout || '').split(/\s+/).filter(Boolean)) {
      spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
      console.log(`[free-ports] Freed ${port} (PID ${pid})`);
    }
  }
}

try {
  // Guarded reap FIRST (change: emulator-exec-orphan-reap) — collects debris from an
  // emulators:exec run whose own end-of-run cleanup never executed (closed terminal,
  // crash). Unlike the blunt STALE_CMDLINE_PATTERNS sweep below, this one only touches
  // processes positively attributed to a FINISHED exec session of THIS repo; it is
  // additive, and deliberately does not replace either sweep.
  const reaped = reapOrphanEmulatorProcesses({ label: 'free-ports' });
  if (reaped > 0) console.log(`[free-ports] Reaped ${reaped} orphaned emulator-exec process(es).`);

  killStaleHelpers();
  if (isWin) { killStaleImagesWindows(); freeWindows(); }
  else { killCloudflaredUnix(); freeUnix(); }
  console.log('[free-ports] Ports clear.');
} catch (e) {
  console.warn('[free-ports] Skipped (non-fatal):', e.message);
}
