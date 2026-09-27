// The Builder's "opens at / closes at" inputs (change: mission-time-limit). A datetime-local input
// holds local wall time without a zone ("2026-09-27T10:30"); the task stores an ISO instant.
// Clearing the input yields undefined, so the save payload sends the field ABSENT.
// scripts/test-time-window-input.ts.

const pad = (n: number) => String(n).padStart(2, '0');

export function isoToLocalInput(iso: string | undefined): string {
  if (typeof iso !== 'string' || iso === '') return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}
