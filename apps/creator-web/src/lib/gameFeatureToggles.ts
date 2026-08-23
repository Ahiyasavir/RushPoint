// Pure "N on" count for the Builder Settings "Game features" section
// (change: builder-settings-grouping).
//
// The four feature toggles are grouped into one collapsed `Advanced` section
// whose header shows how many are enabled. This helper resolves each toggle to
// its EFFECTIVE boolean using the exact same defaults the checkboxes apply — in
// particular `photoFeedEnabled` defaults ON (absent ⇒ enabled), the other three
// default OFF — so the badge can never disagree with the controls it summarizes.
//
// TOTAL: it runs on every render, before `game` is guaranteed well-formed, so a
// null / non-object / number / array input yields an all-false state (count 0)
// rather than throwing. No React, no Firebase, no side effects.
import type { Game } from '@rushpoint/shared';

export interface GameFeatureToggleState {
  allowInstantPlay: boolean;
  photoFeedEnabled: boolean; // default ON: absent ⇒ true
  powerUpsEnabled: boolean;
  manualLeaderboardReveal: boolean;
  pinnedFirst: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Resolves each toggle to its EFFECTIVE boolean, applying the same defaults the
 *  checkboxes apply. Total: a null/garbage game yields all-false. */
export function gameFeatureToggleState(
  game: Partial<Game> | null | undefined,
): GameFeatureToggleState {
  // A non-object game is not a game: resolve all-false rather than letting the
  // photo-feed default-on rule count a feature on for garbage input.
  if (!isRecord(game)) {
    return {
      allowInstantPlay: false,
      photoFeedEnabled: false,
      powerUpsEnabled: false,
      manualLeaderboardReveal: false,
      pinnedFirst: false,
    };
  }
  const g = game as Record<string, unknown>;
  return {
    // Mirror `!!game.allowInstantPlay`
    allowInstantPlay: g.allowInstantPlay === true,
    // Mirror `game.photoFeedEnabled !== false` (default ON), but a garbage game
    // still resolves false rather than "true because it isn't literally false".
    photoFeedEnabled: g.photoFeedEnabled !== false,
    // Mirror `!!game.powerUpsEnabled`
    powerUpsEnabled: g.powerUpsEnabled === true,
    // Mirror `!!game.manualLeaderboardReveal`
    manualLeaderboardReveal: g.manualLeaderboardReveal === true,
    // Mirror `!!game.pinnedFirst` (change: task-library-priority-boost)
    pinnedFirst: g.pinnedFirst === true,
  };
}

/** How many of the five features are on. 0..5. */
export function enabledGameFeatureCount(
  game: Partial<Game> | null | undefined,
): number {
  const s = gameFeatureToggleState(game);
  return (
    (s.allowInstantPlay ? 1 : 0) +
    (s.photoFeedEnabled ? 1 : 0) +
    (s.powerUpsEnabled ? 1 : 0) +
    (s.manualLeaderboardReveal ? 1 : 0) +
    (s.pinnedFirst ? 1 : 0)
  );
}
