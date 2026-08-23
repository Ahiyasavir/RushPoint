// Pure logic for admin-managed game templates (change: admin-manage-game-templates).
// Templates are ordinary Game documents flagged isTemplate: true — see CLAUDE.md's
// "game-templates" capability. This file holds the logic shared between the
// setGameTemplateFlag callable's validation and its direct unit test.

/** The subset of a candidate flag payload this predicate needs. */
export interface TemplateGroupCandidate {
  templateGroupKey?: string;
  templateEmoji?: string;
  templateOrder?: number;
}

/** The subset of an existing sibling doc this predicate needs. */
export interface TemplateGroupSibling {
  templateEmoji?: string;
  templateOrder?: number;
}

/**
 * A translated sibling (linked via templateGroupKey) must show the SAME icon and
 * picker position as the rest of its group — otherwise the card the creator sees
 * depends on which language variant Firestore happens to return first. True when
 * the candidate has no group key, has no existing siblings yet (first-in-group),
 * or matches every existing sibling's emoji AND order exactly.
 */
export function templateGroupSiblingMatches(
  candidate: TemplateGroupCandidate,
  existingSiblings: readonly TemplateGroupSibling[],
): boolean {
  if (!candidate.templateGroupKey || existingSiblings.length === 0) return true;
  return existingSiblings.every(
    (s) => s.templateEmoji === candidate.templateEmoji && s.templateOrder === candidate.templateOrder,
  );
}
