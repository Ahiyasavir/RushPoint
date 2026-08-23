// Thin, impure shell layer for executing a planStaleHelperSweep verdict
// (change: emulator-exec-port-race). Kept separate from staleHelperSweep.mjs on
// purpose — that module is pure decision logic with no fs/child_process/Date.now,
// unit-tested without touching a real process table. This file is the one place
// that actually calls taskkill/kill, shared by free-ports.mjs and emulator-exec.mjs
// so both callers apply the exact same safety carve-outs (live-exec-session,
// offset-port-block, foreign-port-block — see staleHelperSweep.mjs's own header).
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { enumerateProcesses, readExecSessions } from './reapEmulatorExec.mjs';
import { planStaleHelperSweep, STALE_HELPER_PATTERNS } from './staleHelperSweep.mjs';

const isWin = process.platform === 'win32';

/**
 * Plans and executes a stale-helper sweep scoped to `sweptPorts`, logging under
 * `label`. Returns the number of processes killed. Never throws — a snapshot or
 * kill failure just means 0 processes were reaped, exactly like an empty sweep.
 */
export function sweepStaleHelpers({ sweptPorts, label = 'sweep' }) {
  try {
    const processes = enumerateProcesses();
    if (processes.length === 0) return 0;
    const plan = planStaleHelperSweep({
      processes,
      patterns: STALE_HELPER_PATTERNS,
      sessions: readExecSessions(),
      nowMs: Date.now(),
      sweptPorts,
      selfPid: process.pid,
      protectedPids: [process.ppid].filter((p) => Number.isFinite(Number(p))),
    });
    const spared = plan.keep.filter((k) => k.reason === 'live-exec-session'
      || k.reason === 'offset-port-block' || k.reason === 'foreign-port-block');
    if (spared.length > 0) {
      console.log(`[${label}] Spared ${spared.length} process(es) belonging to a different live emulator block.`);
    }
    let killed = 0;
    for (const victim of plan.kill) {
      const pid = String(victim.pid);
      const r = isWin
        ? spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' })
        : spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
      if (r.status === 0) {
        killed++;
        console.log(`[${label}] Killed stale helper (PID ${pid})`);
      }
    }
    return killed;
  } catch (e) {
    console.warn(`[${label}] Stale-helper sweep skipped (non-fatal): ${e.message}`);
    return 0;
  }
}
