import { describe, it, expect } from 'vitest';
import { mayNeedPublicTaskRepair, repairPublicTask } from './publicTaskBackfill';
import { approximatePublicPoint } from './publicTaskLocation';

const PT = { lat: 31.7767, lng: 35.2345 };
const AREA = approximatePublicPoint(PT);
// change: gallery-precise-task-location. An ordinary task now backfills to its
// EXACT authored point; only a hideLocation task is coarsened to AREA. PT is
// off-grid, so PRECISE (== PT) and AREA are distinct values here.
const PRECISE = { lat: 31.7767, lng: 35.2345 };

describe('repairPublicTask — which stored docs need fixing', () => {
  it('skips a conformant doc (area present, no legacy coordinates)', () => {
    expect(repairPublicTask({ approxLocation: AREA }, { coordinates: PT })).toBeNull();
  });

  it('repairs any doc that still carries the deprecated exact point', () => {
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT })).not.toBeNull();
  });

  it('an unparseable legacy value still counts as present and still gets stripped', () => {
    const r = repairPublicTask(
      { coordinates: { lat: 'x', lng: null } },
      { coordinates: PT },
    );
    // Ordinary task ⇒ the replacement is now the EXACT authored point, not a cell.
    expect(r).toEqual({ approxLocation: PRECISE });
  });

  // ── change: hidden-location-map-visibility ──────────────────────────────────
  // A hidden-location task published AFTER task-library-map-view has neither a
  // legacy `coordinates` key nor an area, so the old trigger never fired and the
  // document stayed off the map forever. "Bare" is now a repairable state.
  it('repairs a BARE doc (no coordinates, no area) whose task can supply one', () => {
    // Ordinary task ⇒ exact point; hideLocation task ⇒ coarse cell.
    expect(repairPublicTask({}, { coordinates: PT })).toEqual({ approxLocation: PRECISE });
    expect(repairPublicTask({}, { hideLocation: true, coordinates: PT }))
      .toEqual({ approxLocation: AREA });
  });

  it('repairs a doc whose stored area is unusable', () => {
    expect(repairPublicTask({ approxLocation: { lat: 0, lng: 0 } }, { coordinates: PT }))
      .toEqual({ approxLocation: PRECISE });
    expect(repairPublicTask({ approxLocation: { lat: NaN, lng: 35 } }, { coordinates: PT }))
      .toEqual({ approxLocation: PRECISE });
    expect(repairPublicTask({ approxLocation: { lat: 200, lng: 35 } }, { coordinates: PT }))
      .toEqual({ approxLocation: PRECISE });
  });

  it('leaves a bare doc alone when its task legitimately has no location', () => {
    // Nothing to strip and nothing to add ⇒ no write, so the sweep does not churn
    // through every locationless task on every run.
    expect(repairPublicTask({}, { locationless: true, coordinates: PT })).toBeNull();
    expect(repairPublicTask({}, { coordinates: { lat: 0, lng: 0 } })).toBeNull();
    expect(repairPublicTask({}, { coordinates: undefined })).toBeNull();
  });

  it('leaves a bare doc alone when the authored task cannot be resolved', () => {
    // Fail closed: no exact point to strip, and we cannot prove any location is
    // publishable, so we invent nothing.
    expect(repairPublicTask({}, null)).toBeNull();
    expect(repairPublicTask({}, undefined)).toBeNull();
  });

  it('is idempotent — feeding a repair result back yields null', () => {
    for (const doc of [
      { coordinates: PT },
      {},
      { approxLocation: { lat: 0, lng: 0 } },
    ] as const) {
      const first = repairPublicTask(doc, { hideLocation: true, coordinates: PT });
      expect(first).toEqual({ approxLocation: AREA });
      expect(repairPublicTask({ approxLocation: first!.approxLocation }, {
        hideLocation: true, coordinates: PT,
      })).toBeNull();
    }
  });
});

describe('mayNeedPublicTaskRepair — the sweep\'s cheap pre-check', () => {
  it('is true for a legacy doc and for any doc without a usable area', () => {
    expect(mayNeedPublicTaskRepair({ coordinates: PT })).toBe(true);
    expect(mayNeedPublicTaskRepair({ coordinates: PT, approxLocation: AREA })).toBe(true);
    expect(mayNeedPublicTaskRepair({})).toBe(true);
    expect(mayNeedPublicTaskRepair({ approxLocation: { lat: 0, lng: 0 } })).toBe(true);
    expect(mayNeedPublicTaskRepair({ approxLocation: { lat: NaN, lng: 3 } })).toBe(true);
  });

  it('is false for a conformant doc, so the sweep spends no game read on it', () => {
    expect(mayNeedPublicTaskRepair({ approxLocation: AREA })).toBe(false);
  });

  it('never throws on a nullish doc, and treats it as nothing to do', () => {
    expect(mayNeedPublicTaskRepair(null)).toBe(false);
    expect(mayNeedPublicTaskRepair(undefined)).toBe(false);
    expect(repairPublicTask(null, { coordinates: PT })).toBeNull();
  });
});

describe('repairPublicTask — what replaces the exact point', () => {
  it('backfills a plain placed task to its EXACT authored point', () => {
    // change: gallery-precise-task-location. The gallery shows WHERE a creator put
    // a task, an authored point of interest — so an ordinary task publishes the
    // exact spot, no longer coarsened.
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT }))
      .toEqual({ approxLocation: PRECISE });
  });

  it('coarsens a hideLocation task too, and still strips its exact point', () => {
    // change: hidden-location-map-visibility. The exact authored point is still
    // erased from the world-readable document; what replaces it is the same ~1 km
    // cell any other task gets, so the creator's own hunt is on their own map.
    const r = repairPublicTask({ coordinates: PT }, { hideLocation: true, coordinates: PT });
    expect(r).toEqual({ approxLocation: AREA });
    expect(r?.approxLocation).not.toEqual(PT);
  });

  it('publishes nothing for a locationless or unplaced task', () => {
    expect(repairPublicTask({ coordinates: PT }, { locationless: true, coordinates: PT }))
      .toEqual({});
    expect(repairPublicTask({ coordinates: PT }, { coordinates: { lat: 0, lng: 0 } }))
      .toEqual({});
    expect(repairPublicTask({ coordinates: PT }, { coordinates: undefined }))
      .toEqual({});
  });

  it('fails closed when the authored task cannot be found', () => {
    expect(repairPublicTask({ coordinates: PT }, null)).toEqual({});
    expect(repairPublicTask({ coordinates: PT }, undefined)).toEqual({});
  });

  it('drops a stale published area when the task has since become locationless', () => {
    // Doc carries BOTH the legacy point and an area; the task no longer has any
    // location, so the repair must clear the area too (undefined ⇒ delete).
    const r = repairPublicTask(
      { coordinates: PT, approxLocation: AREA },
      { locationless: true, coordinates: PT },
    );
    expect(r).toEqual({});
    expect(r && 'approxLocation' in r && r.approxLocation).toBeFalsy();
  });

  it('returns the exact authored point for an ordinary task, but never for a hidden one', () => {
    // change: gallery-precise-task-location. Ordinary ⇒ exact; hideLocation ⇒ the
    // exact point is still erased and replaced by a coarse cell.
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT })?.approxLocation).toEqual(PT);
    expect(repairPublicTask({ coordinates: PT }, { hideLocation: true, coordinates: PT })?.approxLocation)
      .not.toEqual(PT);
  });
});
