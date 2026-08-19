import type { Game } from '@rushpoint/shared';

/**
 * The two numbers the new-game picker shows for a template.
 *
 * A template document is a complete game — every stage, mission, answer key and
 * media url — and a finished one runs to hundreds of kilobytes. The picker needs
 * only a title, a description and these counts, so `listGameTemplates` reads them
 * from the document via a projected query instead of loading the stages at all.
 * That is only possible while every path that writes a template stamps them,
 * which is why this lives in its own module: both the admin flag path and the
 * ordinary game-save path call it, and neither should have to import the other.
 */
export function countStagesAndTasks(game: Pick<Game, 'stages'>): {
  templateStageCount: number; templateTaskCount: number;
} {
  const stages = game.stages ?? [];
  return {
    templateStageCount: stages.length,
    templateTaskCount: stages.reduce((sum, s) => sum + (s.tasks?.length ?? 0), 0),
  };
}
