// Type-to-confirm predicate for destructive game actions
// (change: recoverable-game-deletion).
//
// The Dashboard's delete affordance used to be a single dialog.confirm click, and
// a creator destroyed a real game with it. The replacement reuses the Settings
// danger-zone mechanics (SettingsPage DangerCard) with one deliberate difference:
// the creator types the GAME'S OWN TITLE, not a fixed word. The incident was
// deleting the wrong game, and a fixed word like "DELETE" reads identically on
// every card, so it cannot discriminate between two of them.
//
// Whitespace is forgiven (a trailing space from a copy/paste is not a mistake);
// case is not (it is the strongest cheap signal that the creator actually read
// the title). A blank title never confirms anything, so an untitled game can
// never be deleted by pressing the button with an empty field.

export function matchesGameDeleteConfirmation(
  typed: string | undefined | null,
  title: string | undefined | null,
): boolean {
  const expected = (title ?? '').trim();
  if (expected === '') return false;
  return (typed ?? '').trim() === expected;
}
