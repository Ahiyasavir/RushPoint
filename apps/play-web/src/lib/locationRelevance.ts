// "Is location relevant right now?" (change: locationless-no-gps-no-map,
// repaired by change: locationless-fail-safe-vs-task-gating).
//
// Moved out of PlayScreen so the decision is a pure function the unit lane can
// assert, which is how the defect below is pinned rather than re-argued.
//
// ── The defect this file exists to fix ───────────────────────────────────────
// The original predicate walked the ACTIVE stage's task records and, for any
// record whose sanitized content was missing from the payload, returned TRUE:
//
//     if (!content) return true; // unknown content → assume located (fail safe)
//
// That was right when it was written — the client received content for every
// task in the active stage, so a gap really did mean "we don't know". Wave D
// (play-task-gating) then changed the server: `getMyTeamState` builds
// `activeStageTasks` from `.filter(st === 'assigned' || st === 'completed')`
// (functions/src/runs/index.ts), so an UNASSIGNED task now has no content by
// design, and its absence says nothing at all about location.
//
// The two changes are individually correct and cancel each other. Any active
// stage holding one unassigned task — i.e. essentially every stage of every
// game — hit the fail-safe on its first iteration and returned TRUE
// unconditionally. The suppression was dead code in production while looking
// perfectly healthy in review.
//
// What it cost, on every locationless game (the all-locationless "Agent Academy"
// demo included, the very example the original comment named):
//   · a dead 208px map placeholder pinned above the mission for the whole run,
//     reading "the map will appear once the mission has a location" about a game
//     that will never have one;
//   · a browser LOCATION PERMISSION PROMPT, asked of a family playing indoors;
//   · a live `watchPosition` and its `updateLocation` pings, which CLAUDE.md
//     treats as the highest-frequency write in the product and a hard Spark-tier
//     design constraint.
//
// ── Why "no content" is now safe to skip ─────────────────────────────────────
// A record with no content is a task the player is NOT on. Two things follow.
// It cannot put a pin on the map, because a pin needs coordinates we were not
// given. And the player does not need to navigate to a mission routing has not
// handed them. So it is not evidence of "located" — it is no evidence at all.
//
// The ASSIGNED task is always present (that is the whole point of task gating),
// so the case that actually matters — "the mission I am doing right now is at a
// place" — is still decided on real data, exactly as before.
//
// ── Why the verdict is sticky ────────────────────────────────────────────────
// Between two missions there is a moment where routing has completed one task
// and not yet assigned the next, so the payload can carry no un-completed
// content at all. Judged fresh, that instant looks locationless, and the map
// would vanish and return between every mission — a ~224px layout jump, twice
// per mission, on a phone held at walking pace. A game does not become
// locationless halfway through, so once anything located has been seen the
// verdict latches ON for the life of the screen. Latching ON only ever adds the
// map back; it can never hide one that is needed.
import { selectSearchAreas } from './searchAreas';
import type { MyTeamState } from '../services/calls';
import type { CaptureZone } from '@rushpoint/shared';

export interface LocationVerdict {
  /** Run GPS and draw the map on this render. */
  relevant: boolean;
  /** The latch to carry into the next render. */
  latch: boolean;
}

/**
 * Should this render run GPS and draw the navigation map?
 *
 * Total and never throws: it runs on the participant's only screen, and a throw
 * here would take the whole run down. Every uncertain path resolves toward TRUE
 * (keep the map and the watcher), so a defect in this function costs a redundant
 * map, never a missing one.
 *
 * `relevant` and `latch` are returned separately because they are NOT the same
 * value, and conflating them is a mistake that costs the whole fix. Before the
 * first payload arrives the verdict is TRUE — the safe default — but that TRUE
 * is an absence of information, not an observation of a place. Latching it would
 * pin every game ON from its first render and restore the exact bug this module
 * exists to remove. Only a verdict derived from real state may latch.
 *
 * @param previousLatch the `latch` from the previous render; `false` initially.
 */
export function computeLocationRelevant(
  state: MyTeamState | null,
  zones: CaptureZone[],
  previousLatch = false,
): LocationVerdict {
  if (previousLatch) return { relevant: true, latch: true }; // a game keeps its places
  // Not loaded yet: assume located, but do NOT latch — see above.
  if (!state) return { relevant: true, latch: false };
  try {
    if ((zones?.length ?? 0) > 0) return { relevant: true, latch: true };
    if (state.run?.hotZone) return { relevant: true, latch: true };
    const contents = state.activeStageTasks ?? [];
    // A sealed hidden task is unsealed by a server-verified GPS arrival, so it
    // MUST count as location-relevant (it also draws completed pins + a circle).
    if (contents.some((c) => c.arrivalPending)) return { relevant: true, latch: true };
    if (selectSearchAreas(contents).length > 0) return { relevant: true, latch: true };
    // A trail of completed pins means this game has real places in it, even at
    // the instant between two missions when nothing is assigned.
    if ((state.completedTaskPins?.length ?? 0) > 0) return { relevant: true, latch: true };
    const stage = state.team?.stages?.find((s) => s.status === 'active');
    for (const rec of stage?.tasks ?? []) {
      if (rec.status === 'completed' || rec.status === 'skipped') continue;
      const content = contents.find((c) => c.id === rec.taskId);
      // No content = a task routing has not handed us. It cannot be drawn and it
      // is not ours to walk to, so it is no evidence either way. This line used
      // to `return true` and that is the whole defect (see the header).
      if (!content) continue;
      if (content.locationless) continue;
      if (content.arrivalPending) continue; // sealed — no pin (handled above)
      const coords = content.smart?.stationCoords ?? content.coordinates;
      if (coords && (coords.lat !== 0 || coords.lng !== 0)) return { relevant: true, latch: true };
    }
    return { relevant: false, latch: false };
  } catch {
    // Never throw. A malformed payload is not an observation either, so it does
    // not latch — the next healthy render decides on real data.
    return { relevant: true, latch: false };
  }
}
