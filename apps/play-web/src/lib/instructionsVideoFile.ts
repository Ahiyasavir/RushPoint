// The game's intro video as a FILE on our own upload origin (2026-10-13, the opening film of
// "המירוץ לציון"), beside the YouTube link of issue 48. A file plays in a plain <video> in its own
// shape (the film is vertical; a YouTube embed is a 16:9 box), with no channel to upload to.
//
// Transport, for now: `instructions.imageUrl`. It is the one field the server already passes through
// for any https URL, so the film reached a LIVE run without a server deploy the night before the
// event. A proper `videoFileUrl` field (validated by cleanGameInstructions, authored in the Builder)
// should replace this; until then every decision about that overloaded field lives HERE, pure and
// total, so no component reads `imageUrl` on its own:
//   - a film is only ever a file under /uploads/ on a RushPoint upload origin,
//   - everything else is still an image, exactly as before.
import { RUSHPOINT_UPLOAD_ORIGINS, type GameInstructions } from '@rushpoint/shared';

type Ins = Pick<GameInstructions, 'imageUrl'> | null | undefined;

/** The film's URL, or null. Never throws. */
export function instructionsVideoFile(ins: Ins): string | null {
  const raw = ins?.imageUrl;
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (!RUSHPOINT_UPLOAD_ORIGINS.includes(u.origin)) return null;
  // `new URL` has already resolved any `..`, so a path that climbed out no longer starts here
  if (!u.pathname.startsWith('/uploads/')) return null;
  if (!/\.(mp4|webm)$/i.test(u.pathname)) return null;
  return url;
}

/** The still shown before the film plays: the same file name with `.jpg`, uploaded beside it. */
export function instructionsPosterUrl(file: string): string {
  return file.replace(/[?#].*$/, '').replace(/\.(mp4|webm)$/i, '.jpg');
}

/** The instructions' image, unless that field is carrying the film. */
export function instructionsImageUrl(ins: Ins): string | null {
  const raw = ins?.imageUrl;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return instructionsVideoFile(ins) ? null : raw;
}

export function introSeenKey(runId: string, teamId: string): string {
  return `rp-intro-seen:${runId}:${teamId}`;
}

type SeenStore = { getItem(k: string): string | null; setItem(k: string, v: string): void } | null | undefined;

/**
 * Should the intro open by itself now? Once per team and device. If the device cannot remember
 * (storage blocked or missing) it does NOT open: a sheet that would cover the game on every load is
 * worse than one the player opens from the book button.
 */
export function shouldAutoOpenIntro(a: { hasVideo: boolean; key: string | null | undefined; storage: SeenStore }): boolean {
  if (!a.hasVideo || !a.key || !a.storage) return false;
  try {
    return a.storage.getItem(a.key) === null;
  } catch {
    return false;
  }
}

/** Remember that this team has been shown the intro on this device. Never throws. */
export function markIntroSeen(key: string | null | undefined, storage: SeenStore): void {
  if (!key || !storage) return;
  try { storage.setItem(key, '1'); } catch { /* cannot remember: shouldAutoOpenIntro then stays closed */ }
}

/** `localStorage`, or null where touching it throws (private windows, blocked site data). */
export function introSeenStorage(): SeenStore {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
