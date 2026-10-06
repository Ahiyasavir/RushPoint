// The prints page's documents and its address (issue 44, Ahiya 2026-10-06: "אני רוצה שהאפשרות
// להוציא דף מארח תהיה יותר בולטת ולא מוחבאת כל כך, כנל גם להוציא QR קודים"). One route serves all
// three; the Builder header and the run console's top bar both link here through printsUrl, so the
// two entry points cannot drift apart.

export type PrintDoc = 'host' | 'stations' | 'join';

/** Total: an unknown or missing value is the host sheet. */
export function printDocFromParam(v: string | null | undefined): PrintDoc {
  return v === 'stations' || v === 'join' ? v : 'host';
}

export function printsUrl(gameId: string, runId?: string | null, docKind: PrintDoc = 'host'): string {
  const q = new URLSearchParams();
  if (runId) q.set('run', runId);
  if (docKind !== 'host') q.set('doc', docKind);
  const qs = q.toString();
  return `/host-sheet/${encodeURIComponent(gameId)}${qs ? `?${qs}` : ''}`;
}
