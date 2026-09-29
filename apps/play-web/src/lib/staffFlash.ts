// The staff app's flash-mission lists (change: flash-missions-v2, overnight 2026-09-29).
//
// A marshal in the field is exactly who sees a team finish a flash mission, but only the console could
// approve one or end one early. This turns the run's recent flash missions into what the staff app
// shows: submissions waiting for approval (oldest first, ended missions included, since the points
// still wait) and missions still running (soonest to end first). Pure, clock injected, total.

export interface StaffFlashWaiting {
  flashId: string;
  title: string;
  teamId: string;
  teamName: string;
  mediaUrl?: string;
  ageMs: number;
}

export interface StaffFlashRunning {
  flashId: string;
  title: string;
  minutesLeft: number;
}

type ClaimLike = { status?: unknown; at?: unknown; submittedAt?: unknown; mediaUrl?: unknown };
type FlashLike = { id?: unknown; title?: unknown; titleHe?: unknown; isActive?: unknown; expiresAt?: unknown };

/** A team as the staff app streams it: its name and its own flash claims (design D6). */
export type StaffFlashTeam = { id: string; displayName?: string; flashClaims?: Record<string, ClaimLike | null | undefined> | null };

const parse = (iso: unknown): number => (typeof iso === 'string' ? Date.parse(iso) : NaN);

export function staffFlashLists(
  flashes: readonly unknown[] | null | undefined,
  teams: readonly (StaffFlashTeam | null | undefined)[] | null | undefined,
  nowMs: number,
  lang: 'he' | 'en',
): { waiting: StaffFlashWaiting[]; running: StaffFlashRunning[] } {
  const waiting: StaffFlashWaiting[] = [];
  const running: (StaffFlashRunning & { exp: number })[] = [];
  if (!Array.isArray(flashes) || !Number.isFinite(nowMs)) return { waiting, running };
  const teamList = (Array.isArray(teams) ? teams : []).filter((t): t is StaffFlashTeam => !!t && typeof t.id === 'string');
  for (const raw of flashes) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as FlashLike;
    if (typeof f.id !== 'string') continue;
    const title = lang === 'he' && typeof f.titleHe === 'string' && f.titleHe
      ? f.titleHe : typeof f.title === 'string' ? f.title : '';
    for (const tm of teamList) {
      const c = tm.flashClaims && typeof tm.flashClaims === 'object' ? tm.flashClaims[f.id] : undefined;
      if (!c || typeof c !== 'object' || c.status !== 'submitted') continue;
      const teamId = tm.id;
      const sent = Number.isFinite(parse(c.submittedAt)) ? parse(c.submittedAt) : parse(c.at);
      waiting.push({
        flashId: f.id, title, teamId, teamName: tm.displayName || teamId,
        ...(typeof c.mediaUrl === 'string' && c.mediaUrl ? { mediaUrl: c.mediaUrl } : {}),
        ageMs: Number.isFinite(sent) && sent <= nowMs ? nowMs - sent : 0,
      });
    }
    const exp = parse(f.expiresAt);
    if (f.isActive === true && Number.isFinite(exp) && exp > nowMs) {
      running.push({ flashId: f.id, title, minutesLeft: Math.ceil((exp - nowMs) / 60_000), exp });
    }
  }
  waiting.sort((a, b) => b.ageMs - a.ageMs);
  running.sort((a, b) => a.exp - b.exp);
  return { waiting, running: running.map(({ exp: _exp, ...r }) => r) };
}
