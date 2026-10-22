// Template metadata is ADMIN-ONLY state (security audit 2026-10-22).
//
// `listGameTemplates` is a collectionGroup query for `isTemplate == true` across
// EVERY owner, so any game document carrying the flag is offered to every creator
// in the new-game menu. Only `setGameTemplateFlag` (admin) may set it. Three paths
// build a new game by spreading an existing one — duplicateGame, the share-link
// launch copy and translateGame — and each used to carry the flag across, so
// duplicating a published or shared template handed an ordinary creator a game of
// their own that sat in everyone's menu and that they could then edit freely.
// Every "this game becomes a new game" path must pass its source through here.
import type { Game } from '@rushpoint/shared';

/** Every stored field that only a template has. templateMetadata.test.ts fails if the
 *  Game type gains an `isTemplate`/`template*` field that is missing here. */
export const TEMPLATE_ONLY_FIELDS = [
  'isTemplate',
  'templateEmoji',
  'templateOrder',
  'templateGroupKey',
  'templateLang',
  'templateGenre',
  'templateHidden',
  'templateStageCount',
  'templateTaskCount',
] as const;

export function withoutTemplateMetadata<T extends Partial<Game>>(game: T): T {
  const copy = { ...game } as Record<string, unknown>;
  for (const key of TEMPLATE_ONLY_FIELDS) delete copy[key];
  return copy as T;
}
