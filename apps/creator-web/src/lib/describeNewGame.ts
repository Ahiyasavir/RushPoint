// The new-game wizard's description blend and derived tags
// (change: guided-new-game-wizard).
//
// ─── Why this is a BLEND and not an append ───────────────────────────────────
// The product owner asked for "a mix": neither the template's authored
// description with the answers bolted on after it, nor a replacement that throws
// good copy away. There is a concrete reason the naive append is wrong. Both real
// templates open by claiming an audience:
//
//   "משחק שדה מלא אנרגיה לקבוצות בגילאי 11-13: גיבוש, חידות מיקום, ..."
//   "עלילת ריגול לקבוצות בגילאי 14-18: "פרוטוקול האפלה". יחידה סודית, ..."
//
// Both games actually play fine at any age, so the wizard lets a creator say who
// is really playing — and the moment they answer 14-17 on the first template, its
// opening line is simply false. Appending the answers after it would ship a
// description that contradicts itself in two consecutive sentences.
//
// So the blend replaces the OPENING CLAUSE — the audience claim, everything before
// the first colon — with one built from the answers, and keeps the rest, which is
// where the template stops describing its audience and starts describing the game.
// A description with no such clause is kept whole and simply led into.
//
// ─── Why the copy is injected ────────────────────────────────────────────────
// Every user-facing word comes from the caller's `NewGameDescriptionCopy`, built
// by the component out of `t.*`. This module holds no Hebrew and no English of its
// own, so the i18n gate keeps meaning something and this file stays testable with
// no React, no dictionary import and no language assumptions.
//
// Unit-tested by scripts/test-describe-new-game.ts (in `npm test`).

/** The answers this module reads. Every field is treated as untrusted. */
export interface NewGameAnswers {
  people: number;
  minutes: number;
  ageBandId: string;
}

/** The localized copy the component supplies from `t.*`. */
export interface NewGameDescriptionCopy {
  /** The replacement opening clause, e.g. "משחק שדה ל-24 שחקנים, כשעה וחצי". */
  lead(input: { people: number; minutes: number; ageLabel: string }): string;
  /** A human label for an age band id, e.g. "14-17". */
  ageLabel(bandId: string): string;
  /** The tag word for an age band. */
  ageTag(bandId: string): string;
  /** The tag word for a duration. */
  durationTag(minutes: number): string;
}

/**
 * Hard cap on the produced description. `updateGame` accepts far more, but a
 * description is read on a phone in a game card — past this it stops being a
 * summary and starts being a wall.
 */
export const MAX_BLENDED_DESCRIPTION_LEN = 400;

/**
 * Longest opening clause we will treat as an audience claim. Beyond this the
 * colon almost certainly belongs to the body ("the rule is this: ..."), and
 * cutting there would delete real content rather than a stale claim.
 */
const MAX_LEADING_CLAUSE_LEN = 120;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Collapse every run of whitespace, so the result is always one paragraph. */
function oneParagraph(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The part of an authored description that describes the GAME rather than its
 * audience: everything after the first colon, when that colon closes a short
 * enough opening clause to be one.
 */
function describingRemainder(description: string): { remainder: string; hadClause: boolean } {
  const idx = description.indexOf(':');
  if (idx > 0 && idx <= MAX_LEADING_CLAUSE_LEN) {
    const remainder = description.slice(idx + 1).trim();
    if (remainder) return { remainder, hadClause: true };
  }
  return { remainder: description, hadClause: false };
}

function safeAnswers(answers: unknown): NewGameAnswers | null {
  if (!answers || typeof answers !== 'object') return null;
  const a = answers as Partial<NewGameAnswers>;
  const people = typeof a.people === 'number' && Number.isFinite(a.people) && a.people > 0 ? a.people : 0;
  const minutes = typeof a.minutes === 'number' && Number.isFinite(a.minutes) && a.minutes > 0 ? a.minutes : 0;
  const ageBandId = typeof a.ageBandId === 'string' ? a.ageBandId : '';
  if (!people && !minutes && !ageBandId) return null;
  return { people, minutes, ageBandId };
}

/**
 * One coherent description built from the template's authored text and the
 * creator's answers.
 *
 * Total: a missing, empty or malformed description still yields usable text (the
 * lead alone), and malformed answers fall back to the authored description rather
 * than producing a sentence with holes in it.
 */
export function blendGameDescription(
  templateDescription: unknown,
  answers: unknown,
  copy: NewGameDescriptionCopy,
): string {
  const authored = oneParagraph(text(templateDescription));
  const a = safeAnswers(answers);

  // No usable answers: there is nothing to blend IN, so keep what the author
  // wrote rather than inventing a lead with blanks in it.
  if (!a) return authored.slice(0, MAX_BLENDED_DESCRIPTION_LEN);

  const lead = oneParagraph(copy.lead({
    people: a.people,
    minutes: a.minutes,
    ageLabel: copy.ageLabel(a.ageBandId),
  }));

  if (!authored) return lead.slice(0, MAX_BLENDED_DESCRIPTION_LEN);

  const { remainder, hadClause } = describingRemainder(authored);
  // A replaced clause reads as one sentence ("lead: detail"); a kept description
  // reads as two ("lead. detail").
  const joined = hadClause ? `${lead}: ${remainder}` : `${lead}. ${remainder}`;
  return oneParagraph(joined).slice(0, MAX_BLENDED_DESCRIPTION_LEN);
}

/**
 * The tag words derived from the answers, for merging into the template's own
 * tags server-side. Empty when the answers carry nothing worth tagging — an empty
 * list merges to a no-op, which is the correct outcome.
 */
export function derivedGameTags(answers: unknown, copy: NewGameDescriptionCopy): string[] {
  const a = safeAnswers(answers);
  if (!a) return [];
  const out: string[] = [];
  if (a.ageBandId) out.push(copy.ageTag(a.ageBandId));
  if (a.minutes) out.push(copy.durationTag(a.minutes));
  return out.filter((t) => typeof t === 'string' && t.trim() !== '');
}
