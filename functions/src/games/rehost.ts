// The single door for "this game becomes a new game" media (change: task-media-durability),
// in its own module so games/index.ts AND games/share.ts (a shared launch copies the game,
// change: shared-launch-opens-console) can both use it without a circular import.
import { rewriteStagesMedia, buildMediaUrlMapping, type Stage } from '@rushpoint/shared';
import { copyGameMedia } from '../storageUtil';
import { logBestEffort } from '../obs/log';

/**
 * Copy a game's uploaded media into a new game's storage prefix and return the stages
 * with their urls re-pointed there (change: task-media-durability).
 *
 * The single door for every "this game becomes a new game" path — duplicate, translate,
 * and the first save of media uploaded before the game had an id. They all used to carry
 * the url and not the bytes, which silently coupled the new game's pictures to the old
 * game's lifetime.
 *
 * Total and best-effort: no media, nothing to copy, or a failed copy all return the
 * stages unchanged, so a storage hiccup degrades the copy's independence rather than
 * failing the duplication a creator asked for.
 */
export async function rehostGameMedia(
  stages: Stage[] | undefined,
  srcOwnerUid: string,
  srcGameId: string,
  destOwnerUid: string,
  destGameId: string,
): Promise<Stage[] | undefined> {
  if (!Array.isArray(stages)) return stages;
  // Only the urls that actually live in the SOURCE game's folder. This is what makes the
  // same helper safe for the draft-migration call, which runs on every stages-carrying
  // save: a game with no draft media matches nothing and returns before touching Storage.
  const segments = encodedForms(`/games/${srcGameId}/`);
  const urls = new Set<string>();
  for (const stage of stages) {
    for (const task of stage.tasks ?? []) {
      for (const m of task.media ?? []) {
        if (m?.kind === 'youtube' || typeof m?.url !== 'string') continue;
        if (segments.some((seg) => m.url.includes(seg))) urls.add(m.url);
      }
    }
  }
  if (urls.size === 0) return stages;
  try {
    // Copy only the objects these urls name — a draft folder can hold media from other
    // games in progress, and those must not be duplicated into this one.
    const pathMapping = await copyGameMedia(
      srcOwnerUid, srcGameId, destOwnerUid, destGameId,
      (objectName) => encodedForms(objectName).some(
        (form) => [...urls].some((u) => u.includes(form)),
      ),
    );
    if (pathMapping.size === 0) return stages;
    return rewriteStagesMedia(stages, buildMediaUrlMapping(urls, pathMapping)) as Stage[];
  } catch (e) {
    logBestEffort('game.media.rehost', { srcGameId, destGameId }, e);
    return stages;
  }
}

/** The forms an object path can take inside a stored url (raw / encodeURI / component). */
function encodedForms(s: string): string[] {
  return [...new Set([s, encodeURI(s), encodeURIComponent(s)])];
}
