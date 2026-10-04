// Which flash missions the Run Console shows in full, and which it folds
// (change: flash-console-history).
//
// Every recent flash used to render in full, each with an award picker listing every team, so
// the panel grew with every flash sent and the open one sat among settled ones. Current = still
// running, or a submission waits for approval, or it ended under 15 minutes ago with nobody
// rewarded (an announcement can still be awarded by hand). Everything else folds into "past".
import { splitFlashes, flashWinners, RECENTLY_ENDED_MS } from '../apps/creator-web/src/lib/flashConsoleList';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} :: ${JSON.stringify(detail)}`); }
};

const NOW = Date.parse('2026-10-04T10:00:00Z');
const min = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const flash = (id: string, over: Record<string, unknown>) => ({ id, title: id, ...over });

const open = flash('open', { isActive: true, expiresAt: iso(NOW + 5 * min), claimMode: 'many' });
const taken = flash('taken', { isActive: true, expiresAt: iso(NOW + 5 * min), claimMode: 'first', takenBy: 't1' });
const waiting = flash('waiting', { isActive: false, endedAt: iso(NOW - 60 * min) });
const justEndedNoWinner = flash('justEndedNoWinner', { isActive: false, endedAt: iso(NOW - 5 * min) });
const justEndedWon = flash('justEndedWon', { isActive: false, endedAt: iso(NOW - 5 * min) });
const oldWon = flash('oldWon', { isActive: true, expiresAt: iso(NOW - 60 * min) });
const oldNobody = flash('oldNobody', { isActive: false, endedAt: iso(NOW - 90 * min) });

const claims = {
  waiting: { t1: { status: 'submitted' } },
  justEndedWon: { t2: { status: 'approved' } },
  oldWon: { t1: { status: 'approved' }, t3: { status: 'rejected' } },
};

console.log('\nflash console list');
const all = [open, taken, waiting, justEndedNoWinner, justEndedWon, oldWon, oldNobody];
const { current, past } = splitFlashes(all as never, claims as never, NOW);
check('current: open, taken, waiting, just ended with no winner (in order)',
  current.map((f) => f.id).join() === 'open,taken,waiting,justEndedNoWinner', current.map((f) => f.id));
check('past: just ended with a winner, old won, old nobody (in order)',
  past.map((f) => f.id).join() === 'justEndedWon,oldWon,oldNobody', past.map((f) => f.id));
check('the recently-ended window is 15 minutes', RECENTLY_ENDED_MS === 15 * min);
check('a flash that ended exactly at the window edge is past',
  splitFlashes([flash('edge', { isActive: false, endedAt: iso(NOW - RECENTLY_ENDED_MS) })] as never, {}, NOW).past.length === 1);
check('winners are the approved claims', flashWinners(claims.oldWon as never).join() === 't1');
check('no claims ⇒ no winners', flashWinners(undefined).length === 0);
check('total on junk', (() => { const r = splitFlashes(null as never, null as never, NOW); return r.current.length === 0 && r.past.length === 0; })());

console.log(failures === 0 ? '\n✅ flash console list: ALL PASS' : `\n❌ flash console list: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
