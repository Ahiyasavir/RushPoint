// ─────────────────────────────────────────────────────────────────────────────
// Frees the dev ports before launch so a stale Metro/Vite/emulator process from
// a previous run (e.g. a window closed without Ctrl+C) can't block startup or
// trigger Expo's non-interactive "port in use -> skip" exit.
//
// Wired as `predev:all` so npm runs it automatically before `dev:all`.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import process from 'node:process';

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
// export takes a hub lock; overlapping exports collide). Match these by command
// line and kill them too, so each launch starts from exactly one of each.
const STALE_CMDLINE_PATTERNS = [
  'scripts/emulator-backup.mjs', // the crash-safe export loop (the wedger)
  'scripts\\emulator-backup.mjs',
  'scripts/ngrok-tunnel.mjs',
  'scripts\\ngrok-tunnel.mjs',
  'scripts/proxy.mjs',
  'scripts\\proxy.mjs',
  'cloudflared tunnel', // the cloudflared playtest tunnel
  // Emulator-gate orphans (change: emulator-gate hardening). A killed
  // emulators:exec run leaves its whole tree alive — the firebase-tools parent,
  // the emulator JVMs (their jars live under .cache/firebase/emulators), and
  // functions-runtime workers — none of which hold a swept port. 23 leaked
  // functionsEmulatorRuntime workers + a second live Firestore JVM once drove
  // this machine to 90% RAM and made every gate fail with ECONNRESET/internal.
  'functionsEmulatorRuntime',              // functions-emulator worker processes
  'emulators:exec',                        // a stale firebase-tools exec parent
  '.cache\\firebase\\emulators',           // emulator JVMs (firestore / rules runtimes)
  '.cache/firebase/emulators',
  'scripts/emulator-exec.mjs',             // our hardened exec wrapper
  'scripts\\emulator-exec.mjs',
  'scripts/simulate-browser-run.mjs',      // a stale browser-sim driver (holds Chromium)
  'scripts\\simulate-browser-run.mjs',
];

function killStaleHelpersWindows() {
  // Enumerate every process with its command line; kill the ones matching a
  // stale-helper pattern. PowerShell CIM avoids the deprecated/absent wmic.
  const ps = spawnSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ' +
    'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8' });
  let procs = [];
  try {
    const parsed = JSON.parse(ps.stdout || '[]');
    procs = Array.isArray(parsed) ? parsed : [parsed];
  } catch { return; }
  for (const p of procs) {
    const cmd = String(p.CommandLine || '');
    if (!STALE_CMDLINE_PATTERNS.some((pat) => cmd.includes(pat))) continue;
    const pid = String(p.ProcessId);
    const r = spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    if (r.status === 0) console.log(`[free-ports] Killed stale helper (PID ${pid})`);
  }
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

function killStaleHelpersUnix() {
  for (const pat of [...STALE_CMDLINE_PATTERNS, 'cloudflared']) {
    const res = spawnSync('bash', ['-c', `pgrep -f ${JSON.stringify(pat)} || true`], { encoding: 'utf8' });
    for (const pid of (res.stdout || '').split(/\s+/).filter(Boolean)) {
      if (Number(pid) === process.pid) continue;
      spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
      console.log(`[free-ports] Killed stale helper (PID ${pid})`);
    }
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
  if (isWin) { killStaleHelpersWindows(); freeWindows(); }
  else { killStaleHelpersUnix(); freeUnix(); }
  console.log('[free-ports] Ports clear.');
} catch (e) {
  console.warn('[free-ports] Skipped (non-fatal):', e.message);
}
