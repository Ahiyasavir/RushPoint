// ─── Tag normalization (change: game-task-tags) ───────────────────────────────
//
// THE single definition of "what a tag list is", shared by creator-web, play-web
// and functions/. It used to live only in apps/creator-web/src/lib/tags.ts, which
// is exactly why the server had no guard at all: `updateGame` did
// `updates.tags = tags` straight off the client payload, so any client could store
// ten thousand tags — or one tag a megabyte long — and every gallery reader in the
// world downloaded it.
//
// Contract (openspec/changes/game-task-tags/design.md D2–D6):
//   • TOTAL — every input, including undefined / null / wrong-typed, returns an
//     array. It never throws, because the Builder AUTOSAVES: a validation throw on
//     a tag would fail the whole save and lose unrelated edits.
//   • IDEMPOTENT — normalizeTags(normalizeTags(x)) === normalizeTags(x), which is
//     what makes it safe to apply on the client, again on write, and again on
//     publish without the layers ever disagreeing.
//   • CLAMPS, never rejects.
//
// Deliberately NOT applied here: any Unicode normalization form. See
// gameFile.ts's warning — NFKC/NFKD destroy ZWJ emoji sequences (👨‍👩‍👧 → 👨👩👧).

/** Maximum tags kept per game or task. Excess tags are dropped, not rejected. */
export const MAX_TAGS = 20;
/** Maximum characters per tag. A longer tag is truncated, not rejected. */
export const MAX_TAG_LEN = 40;

// Separators. The ASCII comma plus the two comma characters real mobile keyboards
// produce for a Hebrew-first, phone-first audience — Arabic comma U+060C (one
// long-press away on Hebrew Android/iOS layouts, and emitted on the comma key by
// several third-party IMEs) and fullwidth comma U+FF0C (arrives via paste). Neither
// is ever meaningful INSIDE a tag, so accepting them is free — and refusing them
// reproduces the reported "my comma does nothing" bug for users we cannot see.
// Line breaks split too, so pasting a one-per-line list works.
// NOT separators: the semicolon (appears in authored prose) and whitespace (that is
// what makes multi-word tags like "old city" / "העיר העתיקה" possible).
const SEPARATORS = /[,،，\r\n]/;

// Display-spoofing characters: zero-width space, the LRM/RLM marks, the bidi
// embedding/override block and the isolate block, plus the BOM. This repo already
// treats these as a spoofing vector for authored display text
// (stripUnsafeDisplayChars, applied to game titles), and a tag is authored display
// text shown to strangers in a world-readable gallery.
// U+200C (ZWNJ) and U+200D (ZWJ) are POINTEDLY excluded — ZWJ joins emoji sequences
// and ZWNJ is meaningful in several scripts.
// eslint-disable-next-line no-misleading-character-class
const SPOOFING = /[​‎‏‪-‮⁦-⁩﻿]/g;

/**
 * Truncate to at most `MAX_TAG_LEN` UTF-16 code units without leaving a lone
 * surrogate behind (slicing mid-emoji would otherwise emit a replacement glyph).
 */
function truncate(tag: string): string {
  if (tag.length <= MAX_TAG_LEN) return tag;
  let cut = tag.slice(0, MAX_TAG_LEN);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // dangling high surrogate
  return cut;
}

/**
 * Normalize a tag list from either a raw typed string or an already-split array.
 *
 * Both shapes go through the same separator rules on purpose: a client is free to
 * send `["a, b"]`, and treating it identically is the only way the client and the
 * server can agree on what was stored.
 */
export function normalizeTags(input: string | string[] | null | undefined): string[] {
  const sources: string[] =
    typeof input === 'string' ? [input]
    : Array.isArray(input) ? input.filter((v): v is string => typeof v === 'string')
    // Anything else (number, object, boolean, null, undefined) is not a tag list.
    // Non-string array members are DISCARDED rather than stringified: storing
    // "[object Object]" as a tag would be worse than dropping it.
    : [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const segment of source.split(SEPARATORS)) {
      const tag = truncate(
        segment.replace(SPOOFING, '').replace(/\s+/g, ' ').trim(),
      ).trim(); // re-trim: truncation can land on a space
      if (!tag) continue;
      // Case-insensitive de-duplication, first-seen casing preserved. toLowerCase
      // and NOT toLocaleLowerCase — the locale-aware variant would make the result
      // depend on the user's device locale (Turkish dotless i), and the client and
      // the server must reach the same answer. Hebrew is caseless, so this is
      // identity for it and cannot mangle it.
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
      // The cap counts KEPT tags, not raw segments, so discarded duplicates and
      // blanks do not consume a creator's allowance.
      if (out.length >= MAX_TAGS) return out;
    }
  }
  return out;
}

// ─── Game → task tag propagation (feature: game-tags-propagate) ────────────────
//
// A game's tags are UNIONED into EVERY mission (task) so tagging the game once makes
// its missions inherit those tags — the foundation for gallery tag-search. This runs
// on the client (keeping the Builder's dirty check honest) AND on the server
// (updateGame / importGameFile), so it MUST be idempotent and never mutate its input.
//
// Structural shape rather than the full `Stage`/`Task` types on purpose: it needs
// nothing but `tasks[].tags`, and staying structural keeps this file free of a
// (harmless but avoidable) type dependency, so a client and the server can call it
// with either the shared types or a plain payload object.
type WithTaskTags<T> = T & { tags?: string[] };
type StageLike<T> = { tasks: WithTaskTags<T>[] };

/**
 * Return a NEW stages array in which every task's `tags` is the normalized UNION of
 * the game's tags (listed FIRST, so they survive the MAX_TAGS cap) and the task's own
 * prior tags. Dedup / casing / cap all come from `normalizeTags`, so the client, the
 * write path and publish can re-apply this without ever disagreeing.
 *
 * Idempotent (re-running is a no-op) and non-mutating (each stage and task is rebuilt;
 * no input array is touched).
 */
export function propagateGameTagsToTasks<St extends StageLike<unknown>>(
  gameTags: string[] | undefined,
  stages: St[],
): St[] {
  const game = gameTags ?? [];
  return stages.map((stage) => ({
    ...stage,
    tasks: stage.tasks.map((task) => ({
      ...task,
      tags: normalizeTags([...game, ...(task.tags ?? [])]),
    })),
  }));
}
