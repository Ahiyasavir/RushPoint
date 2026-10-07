// When may the live team map move its own camera? (issue 52, 7.10 simulation: "a location bug in
// the console", a video of the map zooming out on its own while nobody touched it.)
//
// The map used to re-frame every time the SET of reporting teams changed: a team's first ping, a
// team that joined late, a second phone. Early in a run that is every few seconds, and each one
// threw away the zoom the organizer had just chosen. The rule now: frame automatically only until
// the person moves the map themselves; after that the camera is theirs, and "show all teams" is the
// explicit way back. Pure and total, so it is tested without a map.

export interface LiveMapFrameInput {
  /** Sorted ids of the teams that currently have a position. */
  presentKey: string;
  /** The key the map was last framed to ('' = never framed). */
  framedKey: string;
  /** Has the person dragged, zoomed or rotated the map themselves? */
  userMoved: boolean;
  /** How many teams have a position. */
  count: number;
}

export function shouldAutoFrame(input: LiveMapFrameInput): boolean {
  if (!input || !(input.count > 0)) return false;
  if (input.userMoved) return false;
  return input.presentKey !== input.framedKey;
}

/** A camera event is the PERSON's when MapLibre reports a DOM event behind it; our own
 *  easeTo/fitBounds carry none. */
export function isUserCameraEvent(e: { originalEvent?: unknown } | null | undefined): boolean {
  return !!e && e.originalEvent != null;
}
