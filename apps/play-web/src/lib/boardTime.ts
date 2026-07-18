// Pure helpers for the public leaderboard's per-row time (change:
// fix-live-board-elapsed-time). No React so it unit-tests with plain tsx.
//
// A leaderboard row's time means one of two very different things:
//   • a FINAL completion time  — the team has finished (`finishedAt` is set), or
//   • an ELAPSED running time   — a still-playing team on a LIVE board, for which
//     the server stamps `durationSeconds = now − startedAt` and it grows on every
//     poll.
// Rendering both identically makes a running team look "done" at a huge time next
// to a real finisher. These helpers let the UI tell them apart.

export interface BoardTimeEntry {
  finishedAt?: string;
  durationSeconds?: number; // time_only preset / elapsed
  totalMinutes?: number;
}

// A row shows a real completion time only once the team has actually finished.
export function isFinalTime(e: BoardTimeEntry): boolean {
  return !!e.finishedAt;
}

// Seconds behind the row's time value, or null when none is available.
export function boardTimeSeconds(e: BoardTimeEntry): number | null {
  if (e.durationSeconds != null) return e.durationSeconds;
  if (e.totalMinutes != null) return e.totalMinutes * 60;
  return null;
}

// m:ss (or h:mm:ss past an hour). Matches the TV / ceremony / recap boards.
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}
