// When should the console ask the host to END the run, and how loudly (change:
// creator-acquisition-and-return)? Ahiya, 30.10: people do not end their runs. In production
// most "live" runs were never ended, which costs the host the best minute of the product (the
// final board, the winners, the moments) and leaves the players' phones waiting forever.
//
// The old end control was a red "danger" panel at the very bottom of a long page. That is right
// for a run in full swing and wrong once the teams are done: then ending is not a risk, it is the
// reveal. So the verdict decides the CALL, the page only renders it.
//
//   'ready'  every team that started has finished: a loud hero at the top
//   'mostly' most of them have (60%+): a clear but quieter banner at the top
//   'none'   keep the bottom panel only
// Total: any malformed count reads as 0, which can only make the call quieter.

export type EndRunCall = 'none' | 'mostly' | 'ready';

export function endRunCall(input: { status?: unknown; started?: unknown; finished?: unknown } | null | undefined): EndRunCall {
  if (!input || input.status === 'finished') return 'none';
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const started = n(input.started);
  const finished = Math.min(n(input.finished), started);
  if (started === 0 || finished === 0) return 'none';
  if (finished === started) return 'ready';
  return finished / started >= 0.6 ? 'mostly' : 'none';
}
