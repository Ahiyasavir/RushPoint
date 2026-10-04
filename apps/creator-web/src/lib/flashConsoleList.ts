// Which flash missions the Run Console shows in full, and which it folds into "past"
// (change: flash-console-history; scripts/test-flash-console-list.ts).
//
// Current = still running, OR a team's submission waits for approval (never fold that away,
// however old), OR it ended under RECENTLY_ENDED_MS ago with nobody rewarded, so an
// announcement-only flash ("first to the gate") can still be awarded by hand. Everything else
// is past: shown as one summary line, with no picker. Pure and total; input order is kept.
import { flashMissionState, type FlashClaim, type FlashMissionDoc } from '@rushpoint/shared';

export const RECENTLY_ENDED_MS = 15 * 60_000;

type Flash = FlashMissionDoc & { id: string };
type ClaimsByFlash = Record<string, Record<string, FlashClaim | null | undefined> | null | undefined>;

/** The teams that won a flash: its approved claims. */
export function flashWinners(claims: Record<string, FlashClaim | null | undefined> | null | undefined): string[] {
  if (!claims || typeof claims !== 'object') return [];
  return Object.entries(claims).filter(([, c]) => c?.status === 'approved').map(([teamId]) => teamId);
}

export function splitFlashes<F extends Flash>(
  flashes: readonly F[] | null | undefined,
  claimsByFlash: ClaimsByFlash | null | undefined,
  now: number,
): { current: F[]; past: F[] } {
  const current: F[] = [];
  const past: F[] = [];
  for (const f of Array.isArray(flashes) ? flashes : []) {
    if (!f || typeof f !== 'object') continue;
    const claims = claimsByFlash?.[f.id] ?? {};
    const state = flashMissionState(f, now);
    const running = state === 'open' || state === 'taken';
    const waiting = Object.values(claims ?? {}).some((c) => c?.status === 'submitted');
    const endedAt = Date.parse(f.endedAt ?? f.expiresAt ?? '');
    const justEnded = Number.isFinite(endedAt) && now - endedAt < RECENTLY_ENDED_MS;
    const nobodyRewarded = flashWinners(claims).length === 0;
    (running || waiting || (justEnded && nobodyRewarded) ? current : past).push(f);
  }
  return { current, past };
}
