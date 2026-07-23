import { describe, expect, it } from 'vitest';
import {
  ATTENTION_REASONS,
  GPS_STUCK_MS,
  GPS_WATCH_MS,
  IDLE_HARD_STUCK_MS,
  IDLE_STUCK_FLOOR_MS,
  IDLE_WATCH_FLOOR_MS,
  LOCKOUT_MIN_REMAINING_MS,
  LOCKOUT_STUCK_REMAINING_MS,
  MIN_TEAMS_FOR_MEDIAN,
  START_GRACE_MS,
  buildAttentionContext,
  classifyTeamAttention,
  countTeamsNeedingAttention,
  type AttentionContext,
  type AttentionTeam,
} from '../teamAttention';

// The run console could show a team's SCORE but never its HEALTH: a team whose
// GPS watch died 40 minutes ago rendered identically to a team deep in a long
// photo task. This suite pins the classifier that tells them apart — and, just
// as importantly, pins how often it stays QUIET. An organizer who sees every row
// flagged stops reading the flags, so every "must not fire" case below is as
// load-bearing as the ones that must.

const MIN = 60_000;
const NOW = Date.UTC(2026, 6, 23, 20, 0, 0); // fixed clock; nothing here reads Date.now()

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** A launched, mid-run, perfectly healthy team. Each case overrides one thing. */
function team(over: Partial<AttentionTeam> = {}): AttentionTeam {
  return {
    id: 't1',
    finished: false,
    launched: true,
    startedAt: iso(60 * MIN),
    updatedAt: iso(4 * MIN),
    lastLocationAt: iso(1 * MIN),
    answerLockoutUntil: null,
    outOfBounds: false,
    pendingReviews: 0,
    ...over,
  };
}

/** A fast field: median idle of 3 minutes. */
const fastField: AttentionContext = { medianIdleMs: 3 * MIN };
/** A slow field: median idle of 20 minutes (long legs are the game, not a bug). */
const slowField: AttentionContext = { medianIdleMs: 20 * MIN };
/** Too few teams to trust a median. */
const noMedian: AttentionContext = { medianIdleMs: null };

describe('classifyTeamAttention — suppression: teams that cannot be in trouble', () => {
  it('never flags a finished team, however ancient its timestamps', () => {
    const r = classifyTeamAttention(
      team({
        finished: true,
        updatedAt: iso(120 * MIN),
        lastLocationAt: iso(180 * MIN),
        outOfBounds: true,
        answerLockoutUntil: NOW + 30 * MIN,
        pendingReviews: 2,
      }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('never flags a team still waiting in the lobby', () => {
    const r = classifyTeamAttention(
      team({ launched: false, startedAt: null, updatedAt: iso(90 * MIN), lastLocationAt: null }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('never flags a brand-new team inside the start grace window', () => {
    // A team that just joined carries an updatedAt from the join write and no
    // activity yet. Without the grace, EVERY team is flagged in the first
    // minutes of a run — exactly when the organizer can least afford noise.
    const r = classifyTeamAttention(
      team({
        startedAt: iso(START_GRACE_MS - MIN),
        updatedAt: iso(90 * MIN),
        lastLocationAt: iso(90 * MIN),
      }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('does flag once the grace window has passed', () => {
    const r = classifyTeamAttention(
      team({ startedAt: iso(START_GRACE_MS + MIN), updatedAt: iso(90 * MIN) }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('stuck');
  });
});

describe('classifyTeamAttention — the healthy team stays clean', () => {
  it('reports ok for a launched team mid-task with a live location stream', () => {
    const r = classifyTeamAttention(team(), fastField, NOW);
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('reports ok for a whole healthy field', () => {
    const rows = [team({ id: 'a' }), team({ id: 'b', updatedAt: iso(6 * MIN) }), team({ id: 'c' })];
    const ctx = buildAttentionContext(rows, NOW);
    for (const row of rows) expect(classifyTeamAttention(row, ctx, NOW).level).toBe('ok');
    expect(countTeamsNeedingAttention(rows, NOW)).toBe(0);
  });
});

describe('classifyTeamAttention — idle is relative to the field', () => {
  it('flags an outlier in a fast field', () => {
    const r = classifyTeamAttention(team({ updatedAt: iso(30 * MIN) }), fastField, NOW);
    expect(r.level).toBe('stuck');
    expect(r.reasons).toContain('idle');
  });

  it('does NOT flag the same idle time when the whole field is slow', () => {
    // 30 min < 4 x 20 min. A hiking game with 20-minute legs must not light up
    // every row just because the platform's default floor is 25 minutes.
    const r = classifyTeamAttention(team({ updatedAt: iso(30 * MIN) }), slowField, NOW);
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('respects the absolute floors when there is no usable median', () => {
    expect(classifyTeamAttention(team({ updatedAt: iso(IDLE_WATCH_FLOOR_MS - MIN) }), noMedian, NOW).level).toBe('ok');
    expect(classifyTeamAttention(team({ updatedAt: iso(IDLE_WATCH_FLOOR_MS + MIN) }), noMedian, NOW).level).toBe('watch');
    expect(classifyTeamAttention(team({ updatedAt: iso(IDLE_STUCK_FLOOR_MS + MIN) }), noMedian, NOW).level).toBe('stuck');
  });

  it('applies the hard ceiling in a normal field', () => {
    // 90 min idle against a 15-min median: 4 x 15 = 60 min, and the ceiling
    // agrees. An hour of total silence is wrong in any field game.
    const r = classifyTeamAttention(
      team({ updatedAt: iso(IDLE_HARD_STUCK_MS + 30 * MIN) }),
      { medianIdleMs: 15 * MIN },
      NOW,
    );
    expect(r.level).toBe('stuck');
    expect(r.reasons).toContain('idle');
  });

  it('suppresses the hard ceiling when the FIELD median is past it', () => {
    // If everyone has been quiet for over an hour, that is the run winding down
    // (or a very long leg), not one team in trouble. A whole-field problem is
    // not a per-team badge.
    const r = classifyTeamAttention(
      team({ updatedAt: iso(IDLE_HARD_STUCK_MS + 30 * MIN) }),
      { medianIdleMs: IDLE_HARD_STUCK_MS + 20 * MIN },
      NOW,
    );
    expect(r.level).toBe('ok');
  });
});

describe('classifyTeamAttention — the safe-zone latch', () => {
  it('is a stuck team on its own, even with everything else healthy', () => {
    const r = classifyTeamAttention(team({ outOfBounds: true }), fastField, NOW);
    expect(r.level).toBe('stuck');
    expect(r.reasons).toContain('outOfBounds');
  });

  it('leads the reason list when combined with others', () => {
    const r = classifyTeamAttention(
      team({ outOfBounds: true, updatedAt: iso(40 * MIN), lastLocationAt: iso(40 * MIN) }),
      fastField,
      NOW,
    );
    expect(r.reasons[0]).toBe('outOfBounds');
    expect(r.level).toBe('stuck');
  });
});

describe('classifyTeamAttention — the answer retry lockout', () => {
  it('ignores a short lockout, because that is ordinary gameplay', () => {
    const r = classifyTeamAttention(
      team({ answerLockoutUntil: NOW + LOCKOUT_MIN_REMAINING_MS - 30_000 }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('watches a lockout with real time left on it', () => {
    const r = classifyTeamAttention(
      team({ answerLockoutUntil: NOW + LOCKOUT_MIN_REMAINING_MS + 4 * MIN }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('watch');
    expect(r.reasons).toContain('answerLockout');
  });

  it('escalates a lockout past the stuck threshold', () => {
    const r = classifyTeamAttention(
      team({ answerLockoutUntil: NOW + LOCKOUT_STUCK_REMAINING_MS + MIN }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('stuck');
    expect(r.reasons).toContain('answerLockout');
  });

  it('ignores an expired, missing or non-finite lockout', () => {
    for (const v of [NOW - MIN, 0, null, undefined, NaN, Infinity, -1]) {
      const r = classifyTeamAttention(team({ answerLockoutUntil: v as number | null }), fastField, NOW);
      expect(r.level, String(v)).toBe('ok');
    }
  });
});

describe('classifyTeamAttention — a silent location stream', () => {
  it('watches a progressing team whose GPS went quiet', () => {
    // Still completing tasks, so not stranded — but the organizer wants to know
    // before that team reaches a field check-in it cannot pass.
    const r = classifyTeamAttention(
      team({ lastLocationAt: iso(GPS_WATCH_MS + 5 * MIN), updatedAt: iso(5 * MIN) }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('watch');
    expect(r.reasons).toContain('gpsSilent');
  });

  it('escalates when the team is BOTH silent and not progressing', () => {
    const r = classifyTeamAttention(
      team({ lastLocationAt: iso(GPS_STUCK_MS + 5 * MIN), updatedAt: iso(30 * MIN) }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('stuck');
    expect(r.reasons).toContain('gpsSilent');
    expect(r.reasons).toContain('idle');
  });

  it('says nothing at all when a team has never reported a location', () => {
    // Location permission denied, or a locationless game. Absence of evidence
    // is not evidence of trouble.
    for (const v of [null, undefined, '', 'not-a-date']) {
      const r = classifyTeamAttention(team({ lastLocationAt: v as string | null }), fastField, NOW);
      expect(r.level, String(v)).toBe('ok');
      expect(r.reasons).toEqual([]);
    }
  });

  it('does not flag a ping just inside the watch window', () => {
    const r = classifyTeamAttention(team({ lastLocationAt: iso(GPS_WATCH_MS - MIN) }), fastField, NOW);
    expect(r.level).toBe('ok');
  });
});

describe('classifyTeamAttention — a pending staff review explains, it does not accuse', () => {
  it('never flags a healthy team just because a photo is queued', () => {
    const r = classifyTeamAttention(team({ pendingReviews: 3 }), fastField, NOW);
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('is appended to an already-flagged team without changing the level', () => {
    const idle = team({ updatedAt: iso(30 * MIN) });
    const bare = classifyTeamAttention(idle, fastField, NOW);
    const withReview = classifyTeamAttention({ ...idle, pendingReviews: 1 }, fastField, NOW);
    expect(withReview.level).toBe(bare.level);
    expect(withReview.reasons).toContain('awaitingReview');
    expect(withReview.reasons[withReview.reasons.length - 1]).toBe('awaitingReview');
  });
});

describe('classifyTeamAttention — malformed input and clock skew are silent', () => {
  it('cannot compute idle from a missing or garbage activity timestamp, so it does not', () => {
    for (const v of [undefined, null, '', '   ', 'not-a-date', 'NaN']) {
      const r = classifyTeamAttention(team({ updatedAt: v as string | null }), fastField, NOW);
      expect(r.level, String(v)).toBe('ok');
      expect(r.reasons).toEqual([]);
    }
  });

  it('treats a garbage startedAt as "grace unknown" without throwing', () => {
    const r = classifyTeamAttention(
      team({ startedAt: 'not-a-date', updatedAt: iso(4 * MIN) }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('ok');
  });

  it('never flags on a clock ahead of the browser', () => {
    // The server writes ISO instants; a browser clock behind them yields
    // negative ages, which must clamp to zero rather than wrap into a threshold.
    const future = new Date(NOW + 90 * MIN).toISOString();
    const r = classifyTeamAttention(
      team({ startedAt: future, updatedAt: future, lastLocationAt: future, answerLockoutUntil: NOW - 90 * MIN }),
      fastField,
      NOW,
    );
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('survives a non-finite or negative nowMs', () => {
    for (const n of [NaN, Infinity, -Infinity, -1]) {
      expect(() => classifyTeamAttention(team(), fastField, n)).not.toThrow();
      expect(classifyTeamAttention(team(), fastField, n).level, String(n)).toBe('ok');
    }
  });

  it('survives a non-finite median', () => {
    for (const m of [NaN, Infinity, -1]) {
      const r = classifyTeamAttention(team({ updatedAt: iso(30 * MIN) }), { medianIdleMs: m }, NOW);
      expect(['ok', 'watch', 'stuck']).toContain(r.level);
    }
  });
});

describe('buildAttentionContext', () => {
  it('returns no median below the minimum active-team count', () => {
    const rows = Array.from({ length: MIN_TEAMS_FOR_MEDIAN - 1 }, (_, i) =>
      team({ id: `t${i}`, updatedAt: iso((i + 1) * MIN) }));
    expect(buildAttentionContext(rows, NOW).medianIdleMs).toBeNull();
  });

  it('ignores finished, unlaunched and unparsable rows when forming the median', () => {
    const rows = [
      team({ id: 'a', updatedAt: iso(2 * MIN) }),
      team({ id: 'b', updatedAt: iso(4 * MIN) }),
      team({ id: 'c', updatedAt: iso(6 * MIN) }),
      team({ id: 'd', finished: true, updatedAt: iso(600 * MIN) }),
      team({ id: 'e', launched: false, updatedAt: iso(600 * MIN) }),
      team({ id: 'f', updatedAt: 'garbage' }),
    ];
    expect(buildAttentionContext(rows, NOW).medianIdleMs).toBe(4 * MIN);
  });

  it('averages the middle pair for an even active count', () => {
    const rows = [
      team({ id: 'a', updatedAt: iso(2 * MIN) }),
      team({ id: 'b', updatedAt: iso(4 * MIN) }),
      team({ id: 'c', updatedAt: iso(6 * MIN) }),
      team({ id: 'd', updatedAt: iso(8 * MIN) }),
    ];
    expect(buildAttentionContext(rows, NOW).medianIdleMs).toBe(5 * MIN);
  });

  it('never throws on an empty table', () => {
    expect(buildAttentionContext([], NOW).medianIdleMs).toBeNull();
  });
});

describe('countTeamsNeedingAttention', () => {
  it('matches the per-row classification on a mixed table', () => {
    const rows = [
      team({ id: 'healthy' }),
      team({ id: 'healthy2', updatedAt: iso(2 * MIN) }),
      team({ id: 'healthy3', updatedAt: iso(3 * MIN) }),
      team({ id: 'latched', outOfBounds: true }),
      team({ id: 'idle', updatedAt: iso(45 * MIN), lastLocationAt: iso(45 * MIN) }),
      team({ id: 'done', finished: true, updatedAt: iso(300 * MIN) }),
    ];
    const ctx = buildAttentionContext(rows, NOW);
    const expected = rows.filter((r) => classifyTeamAttention(r, ctx, NOW).level !== 'ok').length;
    expect(countTeamsNeedingAttention(rows, NOW)).toBe(expected);
    expect(expected).toBe(2);
  });
});

describe('classifyTeamAttention — totality', () => {
  // The classifier renders inside a LIVE run console. A throw here blanks the
  // organizer's only view of the field mid-event, so "never throws" is the
  // headline property, asserted over the whole junk matrix rather than by case.
  const junk = [undefined, null, NaN, Infinity, -Infinity, -1, 0, '', '   ', 'not-a-date', {}, []];

  it('is total over every field x every junk value', () => {
    const keys: (keyof AttentionTeam)[] = [
      'finished', 'launched', 'startedAt', 'updatedAt',
      'lastLocationAt', 'answerLockoutUntil', 'outOfBounds', 'pendingReviews',
    ];
    for (const key of keys) {
      for (const v of junk) {
        for (const ctx of [fastField, slowField, noMedian, { medianIdleMs: NaN }]) {
          const row = { ...team({ updatedAt: iso(45 * MIN) }), [key]: v } as AttentionTeam;
          const label = `${String(key)}=${String(v)}`;
          let r: ReturnType<typeof classifyTeamAttention>;
          expect(() => { r = classifyTeamAttention(row, ctx, NOW); }, label).not.toThrow();
          r = classifyTeamAttention(row, ctx, NOW);
          expect(['ok', 'watch', 'stuck'], label).toContain(r.level);
          for (const reason of r.reasons) expect(ATTENTION_REASONS, label).toContain(reason);
          expect(new Set(r.reasons).size, label).toBe(r.reasons.length);
          // reasons is empty exactly when the level is ok
          expect(r.reasons.length === 0, label).toBe(r.level === 'ok');
        }
      }
    }
  });

  it('tolerates a row that is missing every optional field', () => {
    const r = classifyTeamAttention({ id: 'bare' } as AttentionTeam, noMedian, NOW);
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });
});
