import { describe, it, expect } from 'vitest';
import { mayNeedPublicTaskRepair, repairPublicTask } from './publicTaskBackfill';
import { approximatePublicPoint } from './publicTaskLocation';

const PT = { lat: 31.7767, lng: 35.2345 };
// The coarse ~1 km cell PT snaps to. Under the OLD rule a hidden mission was
// stored as this; the sweep must now UPGRADE such a legacy value to the exact point.
const AREA = approximatePublicPoint(PT);
// change: gallery-exact-hidden-location. EVERY located task now backfills to its
// EXACT authored point — ordinary AND hideLocation. PT is off-grid, so PRECISE
// (== PT) is distinct from AREA, which appears here only as a legacy stored value.
const PRECISE = { lat: 31.7767, lng: 35.2345 };

describe('repairPublicTask — which stored docs need fixing', () => {
  it('skips a conformant doc (EXACT area present, no legacy coordinates)', () => {
    expect(repairPublicTask({ approxLocation: PRECISE }, { coordinates: PT })).toBeNull();
  });

  it('re-repairs a stored COARSE area to the exact point (gallery-exact-hidden-location)', () => {
    // A hidden mission published under the old coarsening rule sits on the grid;
    // the sweep must now upgrade it from the ~1 km cell to the precise authored spot,
    // so nearby hidden missions stop collapsing onto one pin.
    expect(mayNeedPublicTaskRepair({ approxLocation: AREA })).toBe(true);
    expect(repairPublicTask({ approxLocation: AREA }, { hideLocation: true, coordinates: PT }))
      .toEqual({ approxLocation: PRECISE });
  });

  it('repairs any doc that still carries the deprecated exact point', () => {
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT })).not.toBeNull();
  });

  it('an unparseable legacy value still counts as present and still gets stripped', () => {
    const r = repairPublicTask(
      { coordinates: { lat: 'x', lng: null } },
      { coordinates: PT },
    );
    expect(r).toEqual({ approxLocation: PRECISE });
  });

  // ── change: hidden-location-map-visibility ──────────────────────────────────
  // A task published AFTER task-library-map-view has neither a legacy `coordinates`
  // key nor an area, so the old trigger never fired and the document stayed off the
  // map. "Bare" is a repairable state.
  it('repairs a BARE doc (no coordinates, no area) whose task can supply one', () => {
    // Ordinary AND hidden ⇒ the exact authored point now.
    expect(repairPublicTask({}, { coordinates: PT })).toEqual({ approxLocation: PRECISE });
    expect(repairPublicTask({}, { hideLocation: true, coordinates: PT }))
      .toEqual({ approxLocation: PRECISE });
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
      { approxLocation: AREA },            // a legacy coarse value gets upgraded once…
    ] as const) {
      const first = repairPublicTask(doc, { hideLocation: true, coordinates: PT });
      expect(first).toEqual({ approxLocation: PRECISE });
      // …and feeding the exact result back is a no-op.
      expect(repairPublicTask({ approxLocation: first!.approxLocation }, {
        hideLocation: true, coordinates: PT,
      })).toBeNull();
    }
  });
});

describe('mayNeedPublicTaskRepair — the sweep\'s cheap pre-check', () => {
  it('is true for a legacy doc, a doc without a usable area, and a COARSE area', () => {
    expect(mayNeedPublicTaskRepair({ coordinates: PT })).toBe(true);
    expect(mayNeedPublicTaskRepair({ coordinates: PT, approxLocation: AREA })).toBe(true);
    expect(mayNeedPublicTaskRepair({})).toBe(true);
    expect(mayNeedPublicTaskRepair({ approxLocation: { lat: 0, lng: 0 } })).toBe(true);
    expect(mayNeedPublicTaskRepair({ approxLocation: { lat: NaN, lng: 3 } })).toBe(true);
    // A coarse ~1 km cell is now stale (every located task should be exact).
    expect(mayNeedPublicTaskRepair({ approxLocation: AREA })).toBe(true);
  });

  it('is false for a conformant doc (an EXACT off-grid area), so the sweep spends no game read on it', () => {
    expect(mayNeedPublicTaskRepair({ approxLocation: PRECISE })).toBe(false);
  });

  it('never throws on a nullish doc, and treats it as nothing to do', () => {
    expect(mayNeedPublicTaskRepair(null)).toBe(false);
    expect(mayNeedPublicTaskRepair(undefined)).toBe(false);
    expect(repairPublicTask(null, { coordinates: PT })).toBeNull();
  });
});

describe('repairPublicTask — what replaces the exact point', () => {
  it('backfills a plain placed task to its EXACT authored point', () => {
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT }))
      .toEqual({ approxLocation: PRECISE });
  });

  it('backfills a hideLocation task to its EXACT point too (gallery-exact-hidden-location)', () => {
    // The world-readable gallery now pins hidden missions precisely so the creator's
    // own map is accurate; the in-game puzzle is sealed separately by the participant
    // sanitizer. The legacy exact `coordinates` key is still stripped either way.
    const r = repairPublicTask({ coordinates: PT }, { hideLocation: true, coordinates: PT });
    expect(r).toEqual({ approxLocation: PRECISE });
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

  it('returns the exact authored point for EVERY located task, hidden included', () => {
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT })?.approxLocation).toEqual(PT);
    expect(repairPublicTask({ coordinates: PT }, { hideLocation: true, coordinates: PT })?.approxLocation)
      .toEqual(PT);
  });
});
