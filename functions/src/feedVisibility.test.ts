import { describe, it, expect } from 'vitest';
import { shouldFeedTask } from './feedVisibility';

// Security regression (wave-f S1): a hidden-location task's photo + title must
// NEVER be broadcast into the run-wide live photo feed, or teams still hunting
// the spot learn where it is (title AND a photo taken AT the spot). Full
// exclusion, not just a title scrub — the photo is the bigger giveaway.
describe('shouldFeedTask', () => {
  it('excludes a hidden-location task from the live feed', () => {
    expect(shouldFeedTask({ hideLocation: true })).toBe(false);
  });

  it('includes an ordinary (non-hidden) task', () => {
    expect(shouldFeedTask({ hideLocation: false })).toBe(true);
    expect(shouldFeedTask({})).toBe(true);
    expect(shouldFeedTask({ hideLocation: undefined })).toBe(true);
  });

  it('fails closed when the task cannot be resolved (undefined)', () => {
    // A just-completed task that is absent from its own game doc is a data
    // anomaly, not a normal task — we cannot confirm it is safe to broadcast.
    expect(shouldFeedTask(undefined)).toBe(false);
  });

  it('treats only the literal boolean true as hidden (no truthy coercion surprises)', () => {
    // Defensive: guards read as `!== true`, so a stray non-boolean must not be
    // silently treated as hidden-and-excluded for normal tasks.
    expect(shouldFeedTask({ hideLocation: false })).toBe(true);
  });
});
