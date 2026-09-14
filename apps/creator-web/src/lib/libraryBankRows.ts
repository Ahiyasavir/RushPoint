// The mission bank, projected into the task library (change: mission-bank-in-library).
//
// ─── The gap this closes ─────────────────────────────────────────────────────
//
// The task library — the Builder's mission picker and the Gallery's mission tab —
// lists `publicTasks`, and a `publicTasks` document exists only after some creator
// publishes a game. The ~89 hand-authored bank missions were reachable from
// "compose one for me" and from nowhere else, so a creator building a game by hand
// was shown an empty library while the most carefully written content on the
// platform sat one module away.
//
// ─── Why a read-time projection and not seeded documents ─────────────────────
//
// The obvious alternative is to publish the bank into `publicTasks` once. It
// fails the requirement that made this change worth doing: the library has to
// track the bank. `taskBank.ts` is edited in the repo and an admin edits it live
// through `missionBankOverrides`, so a seeded copy would be stale the moment
// either happened, and "re-run the seed" is a step nobody performs. Projecting at
// READ time from `loadMissionBank()` — the same accessor the composer already
// uses — makes staleness impossible by construction. It also costs no Firestore
// writes, which is not a small thing on the Spark tier (see CLAUDE.md).
//
// ─── THE SECRECY MECHANISM: COPY OUT, NEVER SPREAD ───────────────────────────
//
// This is the sharp edge, and it is sharper here than anywhere else that renders
// a mission. Every other reader of the task library receives a `publicTasks`
// document, which `publishGame` already built field-by-field from the authored
// task; the answer key never left the server. A `TaskBankEntry.build()` is the
// FULL authored mission — `smart.secretCode`, `answers`, `numericAnswer`,
// `hint`, `steps[].answer`, and the real `coordinates`. So this module is now the
// only thing standing between an answer key and the DOM.
//
// Every field below is therefore read BY NAME onto a freshly constructed object.
// Nothing is spread from `built`. A strip-list would be correct only for the
// secrets someone remembered and would silently leak the next field `Task` grows;
// copy-out leaks nothing by construction, because forgetting a field costs a
// MISSING value (visible) rather than a LEAKED one (invisible). Same reasoning,
// and the same sweep, as `lib/galleryTaskDetail.ts`.
//
// ─── Total, like everything the bank touches ─────────────────────────────────
//
// `missionBankOverlay.ts` is total because its input was typed by a person into a
// collection no test guards. This module is total for a second reason: it calls
// `build()`, arbitrary authored code, inside a modal. A throw there blanks the
// Builder behind the ErrorBoundary, so one bad entry must cost that entry and
// nothing else.
import {
  rankGalleryResults,
  applyGalleryFacets,
  type PublicTask,
  type TaskType,
  type GalleryTaskSort,
} from '@rushpoint/shared';
import { bankTagLabel } from '../bankTags';
import type { TaskBankEntry } from '../taskBank';

/**
 * Namespaced so a bank row's id can never collide with a `publicTasks` document
 * id, and so a stray id that reaches a callable fails loudly instead of
 * addressing somebody's real document.
 */
export const BANK_ROW_ID_PREFIX = 'bank:';

/**
 * A row the task library renders. Structurally a `PublicTask` either way, so both
 * mounts, the detail modal and the shared ranking all keep working unchanged —
 * `bankKey` is the ONE discriminator, present iff the row came from the bank.
 */
export interface LibraryRow extends PublicTask {
  /** The `TaskBankEntry.key` this row was projected from. Absent for a real one. */
  bankKey?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A usable, trimmed string, or undefined. */
function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** A finite number, or `fallback`. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Project ONE bank entry into a library row, or null if it cannot be projected.
 *
 * `lang` is a parameter rather than a module-level read because the tags are
 * localized here: `entry.tags` are `BankTagId`s (`needsSetup`, `locationBased`),
 * and putting those on a Hebrew creator's screen is exactly the "English in the
 * Hebrew Builder" defect the i18n gate exists for — except data-borne, so no
 * checker would ever see it.
 */
export function bankEntryToLibraryRow(entry: TaskBankEntry, lang: 'he' | 'en'): LibraryRow | null {
  if (!isObject(entry)) return null;
  const key = text(entry.key);
  if (!key || typeof entry.build !== 'function') return null;

  let built: unknown;
  try {
    built = entry.build();
  } catch {
    // One authored mission failing must not take the library down with it.
    return null;
  }
  if (!isObject(built)) return null;

  const title = text(built.title);
  const type = text(built.type);
  if (!title || !type) return null;

  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((t) => bankTagLabel(t, lang)).filter((t): t is string => t !== '')
    : [];

  // COPY OUT, field by field. Never `...built`. See the header.
  return {
    id: `${BANK_ROW_ID_PREFIX}${key}`,
    bankKey: key,
    title,
    description: text(built.description),
    type: type as TaskType,
    // `entry.difficulty` and `built.difficulty` are two copies of one fact
    // (scripts/test-task-bank.ts asserts they agree, and the override overlay
    // patches both); the entry is the one the composer scores on, so it wins.
    difficulty: num(entry.difficulty, num(built.difficulty, 5)),
    estimatedMinutes: num(built.estimatedMinutes, 0),
    pointValue: num(built.pointValue, 0),
    tags,
    // A bank mission is UNPLACED by definition — the creator drops its pin per
    // event through Quick Setup — so there is no public point to publish, and the
    // authored `coordinates` (which for a hidden mission is the puzzle itself)
    // is never copied out at all.
    //   approxLocation: deliberately absent
    //   coordinates:    deliberately absent
    //
    // No source game is claimed, and no publish date is invented: the detail view
    // suppresses each of these rows on a blank value rather than printing an
    // empty or misleading one.
    sourceGameId: '',
    sourceGameTitle: '',
    ownerUid: '',
    createdAt: '',
    // Zero engagement, honestly. A bank mission has never been copied or liked
    // because it has never been in the gallery — which is also what keeps it
    // below genuinely popular published content on an unfiltered browse.
    copyCount: 0,
    likeCount: 0,
    popularity: 0,
  };
}

/** Project a whole bank, dropping only the entries that cannot be projected. */
export function bankRowsFor(entries: readonly TaskBankEntry[], lang: 'he' | 'en'): LibraryRow[] {
  if (!Array.isArray(entries)) return [];
  const out: LibraryRow[] = [];
  for (const entry of entries) {
    const row = bankEntryToLibraryRow(entry, lang);
    if (row) out.push(row);
  }
  return out;
}

/**
 * The identity two rows are compared on for de-duplication. Case- and
 * whitespace-insensitive, because the same mission published by a creator has
 * been through a Builder text box.
 */
export function normalizeLibraryTitle(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The ranking adapter, IDENTICAL to the one `searchTaskLibrary` uses server-side
 * (functions/src/gallery/index.ts). That is load-bearing rather than tidy: the
 * server already ranked and filtered the published rows against this same query,
 * so a client adapter that forgot `sourceGameTitle` would re-rank the merged list
 * and silently DROP every published row the server had matched on it —
 * `rankGalleryResults` discards non-matches when a query is present.
 */
const rankFields = (t: LibraryRow) => ({
  id: t.id,
  title: t.title,
  extras: [t.description, t.sourceGameTitle, ...(t.tags ?? [])],
  popularity: t.popularity,
  uses: t.copyCount,
  likes: t.likeCount,
  pinnedLast: t.pinnedLast,
  pinnedFirst: t.pinnedFirst,
});

/**
 * Merge the published window with the bank into one ranked list.
 *
 * DE-DUPLICATION is deliberately by (normalized title, type) and not by identity:
 * there is no shared id to join on — a bank mission copied into a game and
 * published becomes an ordinary `publicTasks` document with a fresh id and no
 * memory of where it came from. The published row wins, because it is the one
 * that carries real copy/like counts and a real author. The known cost is that a
 * creator who RENAMED their published copy sees both; that is the safe direction
 * (a duplicate is visible and harmless, a wrongly-hidden mission is neither) and
 * a renamed mission is arguably a different one anyway.
 *
 * Pure and total: `rankGalleryResults` never mutates its input, and a junk
 * argument yields an empty list rather than a throw.
 */
export function mergeLibraryRows(
  published: readonly LibraryRow[],
  bank: readonly LibraryRow[],
  query: string,
): LibraryRow[] {
  const pub = Array.isArray(published) ? published : [];
  const bnk = Array.isArray(bank) ? bank : [];

  const publishedIdentities = new Set(
    pub.map((t) => `${normalizeLibraryTitle(t?.title)} ${t?.type ?? ''}`),
  );
  const unpublished = bnk.filter(
    (t) => !publishedIdentities.has(`${normalizeLibraryTitle(t?.title)} ${t?.type ?? ''}`),
  );

  return rankGalleryResults<LibraryRow>(
    [...pub, ...unpublished],
    typeof query === 'string' ? query : '',
    rankFields,
  );
}

/** The Gallery's task facets, as the page holds them. */
export interface BankRowFacets {
  tags?: string[];
  type?: TaskType;
  difficulty?: number;
  hasLocation?: boolean;
  sort?: GalleryTaskSort;
}

/**
 * Apply the Gallery's task facets to bank rows, so the facet bar stays honest.
 *
 * The published rows are faceted by `searchTaskLibrary` (its `tags` filter runs
 * in Firestore, the rest through `applyGalleryFacets`); bank rows never reach
 * that callable, so the SAME shared pass is run over them here rather than
 * reimplemented — a second copy of "difficulty is at-least" or "hasLocation means
 * a usable point" would drift, and the drift would look like a filter bug.
 *
 * Only `tags` is local, because it is the one facet the server does in the
 * database. It matches on the row's LOCALIZED tag labels, which is what the
 * gallery's own chips put into the facet.
 */
export function filterBankRowsByFacets(
  rows: readonly LibraryRow[],
  facets: BankRowFacets | null | undefined,
): LibraryRow[] {
  if (!Array.isArray(rows)) return [];
  const f = isObject(facets) ? (facets as BankRowFacets) : {};

  let out: LibraryRow[] = rows.slice();
  if (Array.isArray(f.tags) && f.tags.length > 0) {
    const wanted = new Set(f.tags);
    out = out.filter((r) => (r.tags ?? []).some((t) => wanted.has(t)));
  }
  return applyGalleryFacets(out, f, 'task');
}
