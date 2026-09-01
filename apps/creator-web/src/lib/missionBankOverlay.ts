// The admin mission-bank overlay (change: admin-editable-mission-bank).
//
// ─── Why an overlay and not a migration ──────────────────────────────────────
//
// `taskBank.ts` stays the base content: 89 missions written against a 40-rule
// authoring doctrine and pinned by three pure test suites. An admin's edits and
// deletions live in Firestore as ONE small document per changed key, and this
// module merges them at read time. Two sources of truth, deliberately — the
// alternative was moving all 89 entries into Firestore, which buys nothing the
// admin can see and costs a migration, a fallback read path, and a doctrine that
// no longer lives next to the content it governs.
//
// Nothing here is created: this overlay can EDIT and DELETE. A new mission needs
// a `build()` factory — task type, verification, capacity, quick-setup steps —
// which is authoring, not editing, and stays in `taskBank.ts`.
//
// ─── The two rules this module exists to hold ────────────────────────────────
//
//   1. TOTAL. Every value here was typed by a person into a collection no test
//      suite guards, months before it is read. A malformed field is IGNORED —
//      never applied as garbage, never thrown on. `composeGame.ts` is total for
//      the same reason and would be undone by a bank read that throws.
//   2. THE BANK'S OWN INVARIANTS SURVIVE. `entry.difficulty` and
//      `entry.build().difficulty` are two copies of one fact
//      (scripts/test-task-bank.ts asserts they agree), so a difficulty override
//      patches BOTH or neither. And a stored deletion that would empty the
//      `start` or `finish` pool is REFUSED: the composer cannot build a game
//      without a bookend at each end, and this read is the last place that can
//      stop one bad row turning "compose one for me" into a permanent dead end.
import type { TaskBankEntry } from '../taskBank';
import { isBankTagId, type BankTagId } from '../bankTags';

/**
 * One admin edit, as stored at `missionBankOverrides/{key}`.
 *
 * ABSENT means "leave the source value alone". `null` — only meaningful on the
 * two genuinely optional numbers — means "clear this field". The distinction
 * matters because the callable transport collapses `undefined` to `null`
 * (see CLAUDE.md), so "unset" has to arrive as an ABSENT key, and an explicit
 * `null` is then unambiguously a deliberate clear.
 */
export interface MissionBankOverride {
  key: string;
  /** Take this mission out of the pool entirely. */
  deleted?: boolean;
  title?: string;
  description?: string;
  /** Replaces the source set wholesale. Closed vocabulary, never free text. */
  tags?: string[];
  /** 1-10, integer. Patches the entry AND the mission it builds. */
  difficulty?: number;
  minAge?: number | null;
  transitMinutes?: number | null;
}

/** What `applyBankOverrides` returns: the effective bank, plus what it refused. */
export interface BankOverlayResult {
  entries: TaskBankEntry[];
  /**
   * Keys whose stored `deleted: true` was NOT honoured because applying it would
   * have left the composer without a `start` or a `finish` mission. Surfaced so
   * the admin page can say so instead of silently showing a mission the admin
   * believes they deleted.
   */
  refusedDeletions: string[];
}

/** The fields the admin page may change. Anything else is authoring, not editing. */
export const BANK_OVERRIDE_FIELDS = [
  'title', 'description', 'tags', 'difficulty', 'minAge', 'transitMinutes',
] as const;

/** A bookend pool that must never be emptied by a deletion. */
const REQUIRED_BOOKENDS: BankTagId[] = ['start', 'finish'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A usable, trimmed string, or undefined. */
function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** An integer in 1..10, or undefined. Rejects NaN/Infinity/fractions/strings. */
function difficultyOf(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isInteger(v)) return undefined;
  return v >= 1 && v <= 10 ? v : undefined;
}

/** A finite, non-negative number, or undefined. */
function nonNegative(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  return v;
}

/**
 * The valid, deduped members of a tag list — or undefined when nothing valid
 * survives. An entry with no tags is unreachable by every filter the composer
 * has, so "the admin cleared every tag" resolves to "leave the source set
 * alone", not to "make this mission invisible".
 */
function tagsOf(v: unknown): BankTagId[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: BankTagId[] = [];
  for (const raw of v) {
    if (isBankTagId(raw) && !out.includes(raw)) out.push(raw);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Reduce an arbitrary value to the override row that may be persisted, or `null`
 * when it carries nothing usable.
 *
 * Total by construction: this is what stands between an admin's form (or a
 * hand-edited document) and a collection every creator on the platform reads.
 * Unknown fields are DROPPED rather than passed through, so the stored shape can
 * never drift ahead of the merge below.
 */
export function normalizeBankOverride(raw: unknown): MissionBankOverride | null {
  if (!isObject(raw)) return null;
  const key = text(raw.key);
  if (!key) return null;

  const out: MissionBankOverride = { key };
  let hasField = false;

  if (raw.deleted === true) { out.deleted = true; hasField = true; }

  const title = text(raw.title);
  if (title !== undefined) { out.title = title; hasField = true; }

  const description = text(raw.description);
  if (description !== undefined) { out.description = description; hasField = true; }

  const tags = tagsOf(raw.tags);
  if (tags !== undefined) { out.tags = tags; hasField = true; }

  const difficulty = difficultyOf(raw.difficulty);
  if (difficulty !== undefined) { out.difficulty = difficulty; hasField = true; }

  // `null` is a deliberate clear and must survive; anything else non-numeric is
  // dropped as noise.
  if (raw.minAge === null) { out.minAge = null; hasField = true; }
  else {
    const minAge = nonNegative(raw.minAge);
    if (minAge !== undefined) { out.minAge = minAge; hasField = true; }
  }

  if (raw.transitMinutes === null) { out.transitMinutes = null; hasField = true; }
  else {
    const transit = nonNegative(raw.transitMinutes);
    if (transit !== undefined) { out.transitMinutes = transit; hasField = true; }
  }

  return hasField ? out : null;
}

/** Does this entry, after its own tag override, still carry `tag`? */
function tagsAfter(entry: TaskBankEntry, override: MissionBankOverride | undefined): BankTagId[] {
  const replaced = override ? tagsOf(override.tags) : undefined;
  return replaced ?? (Array.isArray(entry.tags) ? entry.tags : []);
}

/**
 * The effective bank: `taskBank.ts` with every valid admin override applied.
 *
 * Order is the source bank's order — the header's bookend/family ordering has
 * authoring meaning, and the overlay is not allowed to reshuffle it.
 */
export function applyBankOverrides(
  bank: readonly TaskBankEntry[] | null | undefined,
  overrides: readonly unknown[] | null | undefined,
): BankOverlayResult {
  const source = Array.isArray(bank) ? bank.filter((e) => isObject(e) && typeof e.key === 'string') : [];
  const byKey = new Map<string, MissionBankOverride>();
  for (const raw of Array.isArray(overrides) ? overrides : []) {
    const row = normalizeBankOverride(raw);
    if (row) byKey.set(row.key, row);
  }

  // ─── Pass 1: which deletions may actually be honoured ──────────────────────
  //
  // Decided over the WHOLE bank before anything is removed, so two rows that are
  // each individually harmless cannot combine into an empty pool. When a pool
  // would empty, every deletion in that pool is refused rather than arbitrarily
  // keeping whichever entry happened to come first — the admin gets an honest
  // "this would break the composer", not a silent partial result.
  const refused = new Set<string>();
  for (const tag of REQUIRED_BOOKENDS) {
    const holders = source.filter((e) => tagsAfter(e, byKey.get(e.key)).includes(tag));
    if (holders.length === 0) continue; // the source bank has none; not this module's problem
    const survivors = holders.filter((e) => byKey.get(e.key)?.deleted !== true);
    if (survivors.length > 0) continue;
    for (const e of holders) {
      if (byKey.get(e.key)?.deleted === true) refused.add(e.key);
    }
  }

  // ─── Pass 2: apply ─────────────────────────────────────────────────────────
  const entries: TaskBankEntry[] = [];
  for (const entry of source) {
    const override = byKey.get(entry.key);
    if (!override) { entries.push(entry); continue; }
    if (override.deleted === true && !refused.has(entry.key)) continue;

    const next: TaskBankEntry = { ...entry };

    const tags = tagsOf(override.tags);
    if (tags) next.tags = tags;

    const difficulty = difficultyOf(override.difficulty);
    if (difficulty !== undefined) next.difficulty = difficulty;

    if (override.minAge === null) delete next.minAge;
    else if (typeof override.minAge === 'number') {
      const minAge = nonNegative(override.minAge);
      if (minAge !== undefined) next.minAge = minAge;
    }

    if (override.transitMinutes === null) delete next.transitMinutes;
    else if (typeof override.transitMinutes === 'number') {
      const transit = nonNegative(override.transitMinutes);
      if (transit !== undefined) next.transitMinutes = transit;
    }

    // The built mission. `build` stays a FACTORY — the composer mints a fresh
    // Task with a fresh id per use, and a patched copy would break the no-reuse
    // rule that keys on mission identity. `difficulty` is patched on the built
    // task as well as on the entry so the two copies of that one fact cannot
    // disagree (scripts/test-task-bank.ts asserts exactly that).
    const title = text(override.title);
    const description = text(override.description);
    if (title !== undefined || description !== undefined || difficulty !== undefined) {
      const build = entry.build;
      next.build = () => {
        const task = build();
        if (title !== undefined) task.title = title;
        if (description !== undefined) task.description = description;
        if (difficulty !== undefined) task.difficulty = difficulty;
        return task;
      };
    }

    entries.push(next);
  }

  return { entries, refusedDeletions: source.map((e) => e.key).filter((k) => refused.has(k)) };
}
