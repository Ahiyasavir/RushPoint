import { describe, expect, it } from 'vitest';
import {
  WAIT_OVERDUE_MS,
  WAIT_WARN_MS,
  buildReviewQueueView,
  clearFailure,
  decideReview,
  moveFocus,
  recordFailure,
  type ReviewQueueRow,
} from '../photoReviewQueue';

// The photo queue is the one place in a live run where throughput is bounded by a
// human. The ordering was already correct (shared photoQueue, FIFO); what it could
// not tell anyone was URGENCY. This suite pins the triage verdict: how long a team
// has been standing still, who is actually blocked, and which decisions are legal.
//
// The bias, like teamAttention, is toward SILENCE on missing evidence: a row with
// no usable timestamp must never render as the most urgent thing on screen, or one
// malformed doc permanently owns the top of the organizer's queue.

const MIN = 60_000;
const NOW = Date.UTC(2026, 6, 23, 20, 0, 0); // fixed clock; nothing here reads Date.now()

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function row(over: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return { teamId: 't1', taskId: 'k1', submittedAt: iso(1 * MIN), status: 'pending', ...over };
}

const view = (rows: readonly ReviewQueueRow[], opts: Parameters<typeof buildReviewQueueView>[1] = { nowMs: NOW }) =>
  buildReviewQueueView(rows, opts);

const keys = (rows: readonly ReviewQueueRow[], opts?: Parameters<typeof buildReviewQueueView>[1]) =>
  view(rows, opts ?? { nowMs: NOW }).map((i) => i.key);

describe('buildReviewQueueView — shape and measurement', () => {
  it('accepts an empty queue', () => {
    expect(view([])).toEqual([]);
  });

  it('measures a single pending row', () => {
    const [item] = view([row({ submittedAt: iso(7 * MIN) })]);
    expect(item.key).toBe('t1:k1');
    expect(item.waitMs).toBe(7 * MIN);
    expect(item.waitMinutes).toBe(7);
    expect(item.tier).toBe('waiting');
    expect(item.teamFinished).toBe(false);
    expect(item.failure).toBe('');
  });

  it('escalates the tier at the documented thresholds', () => {
    const tierAt = (ms: number) => view([row({ submittedAt: iso(ms) })])[0].tier;
    expect(tierAt(0)).toBe('fresh');
    expect(tierAt(WAIT_WARN_MS - 1)).toBe('fresh');
    expect(tierAt(WAIT_WARN_MS)).toBe('waiting');
    expect(tierAt(WAIT_OVERDUE_MS - 1)).toBe('waiting');
    expect(tierAt(WAIT_OVERDUE_MS)).toBe('overdue');
    expect(tierAt(90 * MIN)).toBe('overdue');
  });

  it('floors the wait to whole minutes', () => {
    expect(view([row({ submittedAt: iso(5 * MIN + 59_000) })])[0].waitMinutes).toBe(5);
  });
});

describe('buildReviewQueueView — unusable timestamps are quiet, never urgent', () => {
  const bad: (string | null | undefined)[] = [undefined, null, '', '   ', 'not-a-date', 'NaN'];

  it('reports an unknown wait instead of throwing', () => {
    for (const submittedAt of bad) {
      const [item] = view([row({ submittedAt })]);
      expect(item.waitMs).toBeNull();
      expect(item.waitMinutes).toBeNull();
      expect(item.tier).toBe('fresh');
    }
  });

  it('never produces a negative wait for a future timestamp', () => {
    const [item] = view([row({ submittedAt: new Date(NOW + 30 * MIN).toISOString() })]);
    expect(item.waitMs).toBe(0);
    expect(item.tier).toBe('fresh');
  });

  it('is quiet when the injected clock itself is unusable', () => {
    for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const [item] = view([row({ submittedAt: iso(40 * MIN) })], { nowMs });
      expect(item.waitMs).toBeNull();
      expect(item.tier).toBe('fresh');
    }
  });

  it('sorts every unknown wait behind every known wait', () => {
    expect(keys([
      row({ teamId: 'a', submittedAt: undefined }),
      row({ teamId: 'b', submittedAt: iso(1 * MIN) }),
      row({ teamId: 'c', submittedAt: 'not-a-date' }),
      row({ teamId: 'd', submittedAt: iso(30 * MIN) }),
    ])).toEqual(['d:k1', 'b:k1', 'a:k1', 'c:k1']);
  });
});

describe('buildReviewQueueView — ordering', () => {
  it('puts the longest wait first', () => {
    expect(keys([
      row({ teamId: 'young', submittedAt: iso(2 * MIN) }),
      row({ teamId: 'old', submittedAt: iso(25 * MIN) }),
      row({ teamId: 'mid', submittedAt: iso(9 * MIN) }),
    ])).toEqual(['old:k1', 'mid:k1', 'young:k1']);
  });

  it('breaks ties on the stable key regardless of input order', () => {
    const at = iso(6 * MIN);
    const forward = keys([row({ teamId: 'b', submittedAt: at }), row({ teamId: 'a', submittedAt: at })]);
    const backward = keys([row({ teamId: 'a', submittedAt: at }), row({ teamId: 'b', submittedAt: at })]);
    expect(forward).toEqual(['a:k1', 'b:k1']);
    expect(backward).toEqual(forward);
  });

  it('orders a still-playing team ahead of a finished team with a much older submission', () => {
    const rows = [
      row({ teamId: 'done', submittedAt: iso(45 * MIN) }),
      row({ teamId: 'playing', submittedAt: iso(3 * MIN) }),
    ];
    const items = view(rows, { nowMs: NOW, finishedTeamIds: ['done'] });
    expect(items.map((i) => i.key)).toEqual(['playing:k1', 'done:k1']);
    // Still present and still reviewable — a finished team's photo still scores.
    expect(items[1].teamFinished).toBe(true);
  });

  it('is stable under input shuffling and is a fixed point of itself', () => {
    const rows = [
      row({ teamId: 'a', taskId: 'k2', submittedAt: iso(12 * MIN) }),
      row({ teamId: 'b', taskId: 'k1', submittedAt: iso(12 * MIN) }),
      row({ teamId: 'c', taskId: 'k9', submittedAt: undefined }),
      row({ teamId: 'd', taskId: 'k3', submittedAt: iso(40 * MIN) }),
      row({ teamId: 'e', taskId: 'k4', submittedAt: iso(1 * MIN) }),
    ];
    const expected = keys(rows);
    expect(keys([...rows].reverse())).toEqual(expected);
    expect(keys([rows[2], rows[4], rows[0], rows[3], rows[1]])).toEqual(expected);
    // Re-applying the view to its own (already ordered) rows changes nothing.
    expect(keys(view(rows).map((i) => i.row))).toEqual(expected);
  });
});

describe('buildReviewQueueView — idempotence and exclusion', () => {
  it('de-duplicates the same team and task', () => {
    const items = view([
      row({ teamId: 't1', taskId: 'k1', submittedAt: iso(9 * MIN) }),
      row({ teamId: 't1', taskId: 'k1', submittedAt: iso(9 * MIN) }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('t1:k1');
  });

  it('excludes rows that are no longer pending, even supplied twice', () => {
    expect(view([
      row({ teamId: 'x', status: 'approved' }),
      row({ teamId: 'x', status: 'approved' }),
      row({ teamId: 'y', status: 'rejected' }),
      row({ teamId: 'z', status: 'pending' }),
    ]).map((i) => i.key)).toEqual(['z:k1']);
  });

  it('treats an unrecognised status as pending, because a stuck team is still stuck', () => {
    expect(view([row({ status: 'weird' })])).toHaveLength(1);
  });

  it('skips structurally unusable rows without throwing', () => {
    const rows = [
      { teamId: '', taskId: 'k1' },
      { teamId: 't1', taskId: '' },
      row({ teamId: 'ok' }),
    ] as ReviewQueueRow[];
    expect(view(rows).map((i) => i.key)).toEqual(['ok:k1']);
  });
});

describe('decideReview', () => {
  it('sends a first decision on a pending row', () => {
    expect(decideReview('pending', 'approve')).toEqual({ send: true, nextStatus: 'approved', reason: 'ok' });
    expect(decideReview('pending', 'reject')).toEqual({ send: true, nextStatus: 'rejected', reason: 'ok' });
  });

  it('refuses to re-approve an approved row', () => {
    expect(decideReview('approved', 'approve')).toEqual({
      send: false, nextStatus: 'approved', reason: 'alreadyApproved',
    });
  });

  it('refuses to reject an approved row, because the server has no score clawback', () => {
    expect(decideReview('approved', 'reject')).toEqual({
      send: false, nextStatus: 'approved', reason: 'alreadyApproved',
    });
  });

  it('refuses to re-reject a rejected row but allows the rescue approve', () => {
    expect(decideReview('rejected', 'reject')).toEqual({
      send: false, nextStatus: 'rejected', reason: 'alreadyRejected',
    });
    expect(decideReview('rejected', 'approve')).toEqual({ send: true, nextStatus: 'approved', reason: 'ok' });
  });

  it('is idempotent for every (status, action) pair', () => {
    for (const status of ['pending', 'approved', 'rejected', 'weird', undefined] as const) {
      for (const action of ['approve', 'reject'] as const) {
        const once = decideReview(status, action);
        const twice = decideReview(once.nextStatus, action);
        expect(twice.nextStatus).toBe(once.nextStatus);
        expect(twice.send).toBe(false);
      }
    }
  });
});

describe('moveFocus', () => {
  const items = view([
    row({ teamId: 'a', submittedAt: iso(30 * MIN) }),
    row({ teamId: 'b', submittedAt: iso(20 * MIN) }),
    row({ teamId: 'c', submittedAt: iso(10 * MIN) }),
  ]);

  it('returns null for an empty queue', () => {
    expect(moveFocus([], 'anything', 1)).toBeNull();
    expect(moveFocus([], null, -1)).toBeNull();
  });

  it('starts at the front when focus is absent or stale', () => {
    expect(moveFocus(items, null, 1)).toBe('a:k1');
    expect(moveFocus(items, 'gone:k1', 1)).toBe('a:k1');
    expect(moveFocus(items, 'gone:k1', -1)).toBe('a:k1');
  });

  it('moves one step and clamps at both ends', () => {
    expect(moveFocus(items, 'a:k1', 1)).toBe('b:k1');
    expect(moveFocus(items, 'b:k1', -1)).toBe('a:k1');
    expect(moveFocus(items, 'a:k1', -1)).toBe('a:k1');
    expect(moveFocus(items, 'c:k1', 1)).toBe('c:k1');
  });

  it('holds still on a single-item queue', () => {
    const one = view([row()]);
    expect(moveFocus(one, 't1:k1', 1)).toBe('t1:k1');
    expect(moveFocus(one, 't1:k1', -1)).toBe('t1:k1');
  });
});

describe('the per-row failure map', () => {
  it('records and clears immutably, per row', () => {
    const empty = {};
    const one = recordFailure(empty, 'a:k1', 'boom');
    expect(empty).toEqual({});
    expect(one).toEqual({ 'a:k1': 'boom' });

    const two = recordFailure(one, 'b:k1', 'bang');
    expect(two).toEqual({ 'a:k1': 'boom', 'b:k1': 'bang' });

    const cleared = clearFailure(two, 'a:k1');
    expect(cleared).toEqual({ 'b:k1': 'bang' });
    expect(two).toEqual({ 'a:k1': 'boom', 'b:k1': 'bang' });
    // Clearing a key that is not there returns the same object, not a new one.
    expect(clearFailure(cleared, 'nope')).toBe(cleared);
  });

  it('surfaces a recorded failure on the matching item only', () => {
    const items = view(
      [row({ teamId: 'a' }), row({ teamId: 'b' })],
      { nowMs: NOW, failures: { 'a:k1': 'boom' } },
    );
    expect(items.find((i) => i.key === 'a:k1')!.failure).toBe('boom');
    expect(items.find((i) => i.key === 'b:k1')!.failure).toBe('');
  });
});
