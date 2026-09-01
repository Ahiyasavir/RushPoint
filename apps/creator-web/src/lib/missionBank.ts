// The effective mission bank — `taskBank.ts` with the admin's overrides applied
// (change: admin-editable-mission-bank).
//
// Every caller that used to `import { TASK_BANK }` and hand it to the composer
// goes through `loadMissionBank()` instead. `TASK_BANK` itself stays exported and
// stays the base content: this module never replaces it, only merges over it.
//
// ─── Why a direct Firestore read and not a callable ─────────────────────────
//
// `missionBankOverrides` is world-readable to any signed-in user by design
// (firestore.rules) because the composer runs in the browser. A callable would
// add a cross-origin preflight and a token verification to a read that is one
// tiny collection — usually EMPTY, because a document exists only for a mission
// an admin has actually changed.
//
// ─── Failing OPEN is the whole contract ─────────────────────────────────────
//
// If the read fails — offline, rules change, a stray permission error — the
// composer gets the unmodified `TASK_BANK` and "compose one for me" keeps
// working. An admin's edit not being visible for one session is a cosmetic
// problem; the new-game flow dead-ending is not. Same reasoning as
// `stuckGuards.ts`: a blocking client-side dependency must fail open.
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { TASK_BANK, type TaskBankEntry } from '../taskBank';
import { applyBankOverrides, type MissionBankOverride } from './missionBankOverlay';

const OVERRIDES_COL = 'missionBankOverrides';

/** Younger than this ⇒ reuse the memo. The bank changes when an admin edits it. */
const FRESH_MS = 5 * 60_000;

let memo: { entries: TaskBankEntry[]; ts: number } | null = null;
let inFlight: Promise<TaskBankEntry[]> | null = null;

/** Drop the memo so the next read sees an edit made in this session. */
export function invalidateMissionBank(): void {
  memo = null;
  inFlight = null;
}

/** The raw override rows, straight from Firestore. Throws — callers decide. */
export async function fetchMissionBankOverrides(): Promise<MissionBankOverride[]> {
  const snap = await getDocs(collection(db, OVERRIDES_COL));
  return snap.docs.map((d) => ({ ...(d.data() as MissionBankOverride), key: d.id }));
}

/**
 * The bank the composer should draw from. Never throws, never returns empty:
 * the worst case is the authored bank exactly as it ships in the bundle.
 */
export async function loadMissionBank(): Promise<TaskBankEntry[]> {
  if (memo && Date.now() - memo.ts < FRESH_MS) return memo.entries;
  // Two callers (a page mount and a wizard open) share ONE read rather than
  // racing two, the same shape lib/templateCache.ts uses.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let entries = TASK_BANK;
    try {
      const overrides = await fetchMissionBankOverrides();
      entries = applyBankOverrides(TASK_BANK, overrides).entries;
    } catch (e) {
      // Deliberately not rethrown — see the header. Logged so a persistent
      // permission problem is findable rather than invisible.
      console.warn('[missionBank] override read failed; using the authored bank', e);
    }
    memo = { entries, ts: Date.now() };
    inFlight = null;
    return entries;
  })();

  return inFlight;
}

/**
 * The bank as of the last successful load, or the authored bank if none has
 * happened yet. For a synchronous render that must not wait — the async load
 * corrects it in place.
 */
export function missionBankNow(): TaskBankEntry[] {
  return memo?.entries ?? TASK_BANK;
}
