// The Dashboard game card's inline-vs-overflow action split (change:
// dashboard-card-actions-overflow).
//
// Mirrors the Run Console's `teamRowActions` (lib/runConsoleActions.ts): a small
// inline set plus an overflow, decided by a PURE function so the "which action
// sits where" call is unit testable and no action can ever be silently dropped.
//
// The card keeps Edit + Launch as its two primary verbs inline; Test run, Run
// history, Publish-or-Unpublish, Share and Delete collapse into the "⋯" overflow,
// Delete last as the destructive one (the same least-to-most-destructive ordering
// TEAM_ROW_OVERFLOW uses). The component maps each id to its existing handler and
// its existing `d.card*` label; this helper owns only the ordering + the
// publish/unpublish visibility decision, never the wiring.

export type DashboardCardActionId =
  | 'edit' | 'launch' | 'testRun' | 'history' | 'publish' | 'unpublish' | 'share' | 'delete';

export interface DashboardCardActions {
  /** Always ['edit', 'launch']. */
  inline: DashboardCardActionId[];
  /** Always [testRun, history, <publish|unpublish>, share, delete] — delete last. */
  overflow: DashboardCardActionId[];
}

/** Edit + Launch are always inline. */
const CARD_INLINE: DashboardCardActionId[] = ['edit', 'launch'];

/**
 * The card's inline-vs-overflow split. Pure and total: publish vs unpublish is
 * resolved from the game's visibility, delete is always the final (destructive)
 * overflow entry, and a null or malformed game yields the publish variant rather
 * than throwing.
 */
export function dashboardCardActions(
  game: { visibility?: string } | null | undefined,
): DashboardCardActions {
  const isPublic =
    typeof game === 'object' && game !== null && (game as { visibility?: unknown }).visibility === 'public';
  const publishToggle: DashboardCardActionId = isPublic ? 'unpublish' : 'publish';
  return {
    inline: [...CARD_INLINE],
    overflow: ['testRun', 'history', publishToggle, 'share', 'delete'],
  };
}
