// Flash missions v2: taken, done, scored, and a way back (change: flash-missions-v2).
//
// Field report 2026-09-27: a flash mission was a banner nobody could act on. Now a team presses
// "לקחתי", does it, and returns to the mission it was on, whose time limit did not run meanwhile.
// The organizer chooses per flash mission whether only the FIRST team or ANY team may take it
// (decision 2026-09-28). A flash mission is its own run-scoped object, never a stage task, so none
// of this touches routing, stage completion or the template. Pure and total.

export type FlashClaimMode = 'first' | 'many';
export type FlashDoneBy = 'announce' | 'button' | 'photo' | 'video';
export type FlashClaimStatus = 'claimed' | 'submitted' | 'approved' | 'rejected' | 'released';

export interface FlashClaim {
  at?: string;
  status: FlashClaimStatus;
  mediaUrl?: string;
  posterUrl?: string;
  /** When the team sent it (the console's inbox ages a waiting approval from here). */
  submittedAt?: string;
  reviewedAt?: string;
}

export interface FlashMissionDoc {
  isActive?: boolean;
  expiresAt?: string;
  endedAt?: string;
  claimMode?: FlashClaimMode;
  doneBy?: FlashDoneBy;
  requiresApproval?: boolean;
  bonusPoints?: number;
  /**
   * First-team mode: the team holding it (claimed, sent or won). Cleared when that team gives it
   * back, is not approved, or is removed. The claims themselves live on each TEAM
   * (`RunTeam.flashClaims`, design D6): every phone listens to this document, so a claims map here
   * made each claim a read on every phone.
   */
  takenBy?: string | null;
}

/** A claim that still holds the mission: released and rejected ones let it go. */
function holds(c: FlashClaim | undefined | null): boolean {
  return !!c && (c.status === 'claimed' || c.status === 'submitted' || c.status === 'approved');
}

export function flashMissionState(doc: FlashMissionDoc | null | undefined, nowMs: number): 'open' | 'taken' | 'ended' | 'expired' {
  if (!doc || typeof doc !== 'object' || doc.isActive !== true) return 'ended';
  const exp = typeof doc.expiresAt === 'string' ? Date.parse(doc.expiresAt) : NaN;
  if (Number.isFinite(exp) && nowMs >= exp) return 'expired';
  if (doc.claimMode === 'first' && typeof doc.takenBy === 'string' && doc.takenBy !== '') return 'taken';
  return 'open';
}

export type FlashClaimVerdict =
  | 'ok' | 'ended' | 'expired' | 'taken' | 'alreadyClaimed' | 'announceOnly' | 'busyWithFlash' | 'teamCannotPlay';

export function flashClaimVerdict(input: {
  flash: FlashMissionDoc | null | undefined;
  flashId: string;
  teamId: string;
  team: {
    held?: boolean; removed?: boolean; flashSuspension?: { flashId?: string } | null;
    flashClaims?: Record<string, FlashClaim | null | undefined> | null;
  } | null | undefined;
  nowMs: number;
}): FlashClaimVerdict {
  const { flash, flashId, team, nowMs } = input ?? ({} as never);
  if (!flash || typeof flash !== 'object') return 'ended';
  // A flash mission written before v2 has no claim mode: it is an announcement, as it always was.
  if (!flash.claimMode || !flash.doneBy || flash.doneBy === 'announce') return 'announceOnly';
  const mine = typeof flashId === 'string' ? team?.flashClaims?.[flashId] : undefined;
  if (holds(mine)) return 'alreadyClaimed';
  const state = flashMissionState(flash, nowMs);
  if (state === 'ended' || state === 'expired') return state;
  if (team?.removed === true || team?.held === true) return 'teamCannotPlay';
  if (team?.flashSuspension?.flashId) return 'busyWithFlash';
  if (state === 'taken') return 'taken';
  return 'ok';
}

/**
 * The suspended mission's new `startedAt` when the team comes back from a flash mission: moved
 * forward by the time spent away, so its time limit (counted from `startedAt`) and its measured
 * duration both exclude the flash mission. Never moves it backwards. Null when there is no start.
 */
export function resumedStartedAt(startedAt: unknown, suspendedAt: unknown, nowMs: number): string | null {
  const start = typeof startedAt === 'string' ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const since = typeof suspendedAt === 'string' ? Date.parse(suspendedAt) : NaN;
  if (!Number.isFinite(since) || since >= nowMs) return new Date(start).toISOString();
  return new Date(start + (nowMs - since)).toISOString();
}

/**
 * What the phone says about ITS OWN claim on a flash mission. Found by playing it: after sending,
 * and even after winning, the banner kept saying "you already took this mission", which answers a
 * question nobody asked. `released` (the team gave it back) and anything unknown say nothing, so
 * the claim button logic decides. Pure and total.
 */
export function flashMyClaimLine(claim: { status?: unknown } | null | undefined): 'claimed' | 'waiting' | 'won' | 'rejected' | null {
  switch (claim?.status) {
    case 'claimed': return 'claimed';
    case 'submitted': return 'waiting';
    case 'approved': return 'won';
    case 'rejected': return 'rejected';
    default: return null;
  }
}

/**
 * Design D6: every claim lives on its TEAM (`team.flashClaims[flashId]`). The console and the staff
 * app already stream the team documents, so this turns them into "who took which flash mission":
 * `{ [flashId]: { [teamId]: FlashClaim } }`. Pure and total: junk entries are skipped.
 */
export function flashClaimsByFlash(
  teams: readonly ({ id?: unknown; flashClaims?: unknown } | null | undefined)[] | null | undefined,
): Record<string, Record<string, FlashClaim>> {
  const out: Record<string, Record<string, FlashClaim>> = {};
  if (!Array.isArray(teams)) return out;
  for (const t of teams) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string') continue;
    const claims = t.flashClaims;
    if (!claims || typeof claims !== 'object') continue;
    for (const [flashId, c] of Object.entries(claims as Record<string, unknown>)) {
      if (!c || typeof c !== 'object' || typeof (c as { status?: unknown }).status !== 'string') continue;
      (out[flashId] ??= {})[t.id] = c as FlashClaim;
    }
  }
  return out;
}
