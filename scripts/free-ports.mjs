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
  5173, 5174, 5180,           // Vite (admin)
  4000, 4400, 4500,           // Firebase emulator UI / hub / logging
  5001, 8080, 9099, 9199, 5002, // functions / firestore / auth / storage / hosting
  3000,                       // reverse proxy (tunnel)
];
const isWin = process.platform === 'win32';

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
  if (isWin) freeWindows();
  else freeUnix();
  console.log('[free-ports] Ports clear.');
} catch (e) {
  console.warn('[free-ports] Skipped (non-fatal):', e.message);
}
