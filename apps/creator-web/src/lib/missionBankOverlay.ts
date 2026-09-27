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
import { isBankTagId, withDifficultyBand, type BankTagId } from '../bankTags';

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

  // ── Curation bookkeeping, NOT content ─────────────────────────────────────
  //
  // Two independent things an admin can say about a mission while working
  // through 103 of them, and they are deliberately separate because they are
  // checked by different people at different moments:
  //
  //   • `reviewedCopy`    — the words have been read: title, instructions, tone.
  //   • `verifiedSetup`   — the whole mission has been stood up for real,
  //                         including its Quick Setup prompts and whatever the
  //                         creator is asked to bring or arrange.
  //
  // Neither touches what a player is offered, so `applyBankOverrides` ignores
  // both. They exist so a curation pass can be resumed rather than restarted,
  // which is the actual problem after an evening of editing.
  reviewedCopy?: boolean;
  verifiedSetup?: boolean;
}

/**
 * Does this row change what a PLAYER sees, as opposed to only recording that
 * somebody has looked at the mission?
 *
 * The page needs the distinction: a mission that has been ticked as reviewed but
 * never edited is not an "edited" mission, and showing it as one would make the
 * edited filter useless within a single curation pass.
 */
export function hasContentEdit(o: MissionBankOverride | null | undefined): boolean {
  if (!o) return false;
  return o.deleted === true
    || o.title !== undefined || o.description !== undefined || o.tags !== undefined
    || o.difficulty !== undefined || o.minAge !== undefined || o.transitMinutes !== undefined;
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
  /**
   * Keys whose `start`/`finish` tag was put BACK because removing it would have
   * left the composer with no opener or no finale. Same guard as
   * `refusedDeletions`, for the quieter of the two ways to empty a pool.
   */
  restoredBookends: string[];
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

  // Only `true` is stored. A false tick is the absence of a tick, and keeping
  // `false` around would leave a row that marks a mission as touched while
  // saying nothing about it.
  if (raw.reviewedCopy === true) { out.reviewedCopy = true; hasField = true; }
  if (raw.verifiedSetup === true) { out.verifiedSetup = true; hasField = true; }

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

  // ─── Pass 1: keep a bookend at each end, whatever the rows say ─────────────
  //
  // The composer cannot build a game without a `start` mission and a `finish`
  // one, so this pass decides over the WHOLE bank before anything is applied —
  // two rows that are each individually harmless must not combine into an empty
  // pool. When a pool would empty, every row that emptied it is refused rather
  // than arbitrarily keeping whichever entry came first: the admin gets an
  // honest "this would break the composer", not a silent partial result.
  //
  // TWO ways to empty a pool, and the second one is easy to miss. Deleting the
  // last opener is the obvious one. UNTAGGING it is the quiet one — a tag
  // override replaces the whole set, so an admin re-tagging the last `start`
  // mission for its content (which is exactly what happened to open-team-motto,
  // moved from `start` to `finish` in the first editing pass) strands the
  // composer just as completely, with nothing marked deleted anywhere.
  const refused = new Set<string>();
  const restored = new Set<string>();
  for (const tag of REQUIRED_BOOKENDS) {
    // Holders in the AUTHORED bank: what the pool would be with no rows at all.
    const sourceHolders = source.filter((e) => Array.isArray(e.tags) && e.tags.includes(tag));
    if (sourceHolders.length === 0) continue; // the bank never had one; not this module's problem
    // Holders that survive both kinds of edit.
    const survivors = source.filter((e) => {
      const o = byKey.get(e.key);
      return o?.deleted !== true && tagsAfter(e, o).includes(tag);
    });
    if (survivors.length > 0) continue;
    for (const e of sourceHolders) {
      const o = byKey.get(e.key);
      if (o?.deleted === true) refused.add(e.key);
      if (!tagsAfter(e, o).includes(tag)) restored.add(e.key);
    }
  }
  /** Bookend tags that must be put back on a given key, because the pool emptied. */
  const restoreTags = new Map<string, BankTagId[]>();
  for (const key of restored) {
    const e = source.find((x) => x.key === key);
    if (!e) continue;
    const o = byKey.get(key);
    restoreTags.set(key, REQUIRED_BOOKENDS.filter(
      (t) => Array.isArray(e.tags) && e.tags.includes(t) && !tagsAfter(e, o).includes(t),
    ));
  }

  // ─── Pass 2: apply ─────────────────────────────────────────────────────────
  const entries: TaskBankEntry[] = [];
  for (const entry of source) {
    const override = byKey.get(entry.key);
    if (!override) { entries.push(entry); continue; }
    if (override.deleted === true && !refused.has(entry.key)) continue;

    // A row that only carries curation ticks says nothing about the mission's
    // content, so it must be a true no-op here — not even the tag repairs below.
    // Otherwise ticking "I have read this one" would quietly rewrite the
    // mission's tags, which is exactly the kind of invisible change this module
    // exists to prevent.
    if (!hasContentEdit(override)) { entries.push(entry); continue; }

    const next: TaskBankEntry = { ...entry };

    const tags = tagsOf(override.tags);
    if (tags) next.tags = tags;

    // Put back a bookend tag whose removal would have emptied its pool (pass 1).
    for (const tag of restoreTags.get(entry.key) ?? []) {
      if (!next.tags.includes(tag)) next.tags = [...next.tags, tag];
    }

    // `camera` is DERIVED, not picked. It means "this mission is handed in as a
    // photo or a video", which is a property of the mission's task type — and the
    // task type is the one thing the admin editor cannot change (there is no
    // `build()` behind an override). An admin who drops it, or adds it to a
    // mission that submits a typed answer, is editing a fact rather than an
    // opinion, so the source entry stays authoritative in both directions.
    //
    // Without this the source fix that added `camera` to eleven missions would
    // have been invisible for exactly the ones an admin had already re-tagged:
    // a tag override REPLACES the set, so the-hidden-key would have kept coming
    // back camera-less however many times the bank was corrected.
    const sourceHasCamera = Array.isArray(entry.tags) && entry.tags.includes('camera');
    const nextHasCamera = next.tags.includes('camera');
    if (sourceHasCamera && !nextHasCamera) next.tags = [...next.tags, 'camera'];
    else if (!sourceHasCamera && nextHasCamera) next.tags = next.tags.filter((t) => t !== 'camera');

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

    // The band tag (`easy`/`medium`/`hard`) and the number are ONE fact written
    // twice, so the merge re-derives the band from whatever difficulty this
    // entry ended up with rather than trusting the two independent controls the
    // admin form offers. The first real editing pass drifted them apart twice in
    // one day — a mission moved to 8 and left tagged `medium`, another moved to
    // 4 and left tagged `easy` — and neither is visible anywhere: the composed
    // game paces off the number while the creator filters on the tag.
    //
    // Only entries that carry an override are re-banded. The authored bank is
    // already a fixed point of this repair (scripts/test-task-bank-tag-laws.ts
    // asserts exactly that), so touching untouched entries would allocate a new
    // array per mission per compose for nothing.
    next.tags = withDifficultyBand(next.tags, next.difficulty);

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

  return {
    entries,
    refusedDeletions: source.map((e) => e.key).filter((k) => refused.has(k)),
    restoredBookends: source.map((e) => e.key).filter((k) => restored.has(k)),
  };
}
