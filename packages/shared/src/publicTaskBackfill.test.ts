import { describe, it, expect } from 'vitest';
import { repairPublicTask } from './publicTaskBackfill';
import { approximatePublicPoint } from './publicTaskLocation';

const PT = { lat: 31.7767, lng: 35.2345 };

describe('repairPublicTask — which stored docs need fixing', () => {
  it('skips a conformant doc (no legacy coordinates) — the sweep is idempotent', () => {
    expect(repairPublicTask({ approxLocation: PT }, { coordinates: PT })).toBeNull();
    expect(repairPublicTask({}, { coordinates: PT })).toBeNull();
  });

  it('repairs any doc that still carries the deprecated exact point', () => {
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT })).not.toBeNull();
  });

  it('an unparseable legacy value still counts as present and still gets stripped', () => {
    const r = repairPublicTask(
      { coordinates: { lat: 'x', lng: null } },
      { coordinates: PT },
    );
    expect(r).toEqual({ approxLocation: approximatePublicPoint(PT) });
  });
});

describe('repairPublicTask — what replaces the exact point', () => {
  it('coarsens a plain placed task to its ~1 km cell centre', () => {
    expect(repairPublicTask({ coordinates: PT }, { coordinates: PT }))
      .toEqual({ approxLocation: approximatePublicPoint(PT) });
  });

  it('publishes NOTHING for a hideLocation task — the whole point of the backfill', () => {
    expect(repairPublicTask({ coordinates: PT }, { hideLocation: true, coordinates: PT }))
      .toEqual({});
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

  it('drops a stale published area when the task has since become hidden', () => {
    // Doc carries BOTH the legacy point and an area; the task now hides its
    // location, so the repair must clear the area too (undefined ⇒ delete).
    const r = repairPublicTask(
      { coordinates: PT, approxLocation: approximatePublicPoint(PT) },
      { hideLocation: true, coordinates: PT },
    );
    expect(r).toEqual({});
    expect(r && 'approxLocation' in r && r.approxLocation).toBeFalsy();
  });

  it('never returns the exact authored point', () => {
    const r = repairPublicTask({ coordinates: PT }, { coordinates: PT });
    expect(r?.approxLocation).not.toEqual(PT);
  });
});
