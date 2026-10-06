// Which state a public standings board is in, as a key into `t.board` (found 2026-10-06: the TV view
// said "live standings" on a finished run while the public board said "final results"). One pure
// choice for every surface; total, so a board still loading reads as live.
export type BoardStateKey = 'finalResults' | 'frozen' | 'live';

export function boardStateKey(data: { runStatus?: string | null; frozen?: boolean | null } | null | undefined): BoardStateKey {
  if (data?.runStatus === 'finished') return 'finalResults';
  if (data?.frozen) return 'frozen';
  return 'live';
}
