// Imported game files are UNTRUSTED INPUT (change: game-import-hardening).
//
// A `.rushpoint.json` lives on the creator's disk. It can be hand-edited, mailed
// between creators, or produced by anything at all — and `importGameFile` is the
// only place a client hands the server a whole `Game` shape in one payload. The
// allow-listed `pick()` in gameFile.ts guards KEY NAMES at four fixed levels
// (game · stage · task · smart); this file guards everything BETWEEN them: the
// values nested inside `branding`, `scoringOptions`, `media`, `steps[]`,
// `answers[]` — which used to be cloned straight through to the Firestore write.
//
// Every case here was demonstrated against the shipped validator before it was
// written (see openspec/changes/game-import-hardening/design.md for the verbatim
// probe output). The two REGRESSION groups at the bottom are the counterweight:
// hardening must refuse nothing the platform's own exporter produces.

import { describe, it, expect } from 'vitest';
import {
  parseGameFile,
  serializeGameToFile,
  GAME_FILE_FORMAT,
  CURRENT_GAME_FILE_VERSION,
  MAX_FILE_DEPTH,
  MAX_FILE_ARRAY_LEN,
  MAX_FILE_STRING_LEN,
} from './gameFile';
import { gameStructureProblems } from './validation';

// ─── Baseline: the smallest document the shipped validator ACCEPTS ────────────
// Every hostile case below differs from this by exactly the value under test, so a
// failure can only be caused by that value.

type Bag = Record<string, unknown>;

function task(over: Bag = {}): Bag {
  return {
    id: 't1',
    title: 'Task',
    type: 'self_report',
    coordinates: { lat: 31.7767, lng: 35.2345 },
    difficulty: 2,
    estimatedMinutes: 5,
    pointValue: 10,
    maxConcurrentTeams: 1,
    ...over,
  };
}

function stage(over: Bag = {}): Bag {
  return { id: 's1', order: 0, title: 'Stage', tasks: [task()], ...over };
}

function doc(game: Bag = {}): Bag {
  return {
    format: GAME_FILE_FORMAT,
    schemaVersion: CURRENT_GAME_FILE_VERSION,
    exportedAt: '2026-07-23T00:00:00.000Z',
    game: { title: 'Game', stages: [stage()], ...game },
  };
}

/** A document whose single task carries `over`. */
const withTask = (over: Bag): Bag => doc({ stages: [stage({ tasks: [task(over)] })] });

/** Parse and assert a refusal; returns the joined reasons for message assertions. */
function refusal(input: unknown): string {
  let result: ReturnType<typeof parseGameFile>;
  try {
    result = parseGameFile(input);
  } catch (e) {
    // The module's contract is that it NEVER throws — a throw is itself the bug.
    throw new Error(`parseGameFile threw instead of returning errors: ${String(e)}`);
  }
  expect(result.game).toBeNull();
  expect(result.errors.length).toBeGreaterThan(0);
  return result.errors.join(' · ');
}

/** Parse and assert acceptance; returns the normalized game. */
function accepted(input: unknown): Bag {
  const result = parseGameFile(input);
  expect(result.errors).toEqual([]);
  expect(result.game).not.toBeNull();
  return result.game as unknown as Bag;
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('gameFile hardening — the baseline is accepted', () => {
  it('accepts the minimal valid document (so every refusal below is caused by its own value)', () => {
    const game = accepted(doc());
    expect(game.title).toBe('Game');
  });
});

describe('gameFile hardening — prototype pollution', () => {
  // Built through JSON.parse: an object literal `{ __proto__: … }` in TS/JS sets
  // the prototype instead of creating the own property an attacker's FILE carries.
  const poison = (json: string): unknown => JSON.parse(json);

  const cases: [string, () => unknown][] = [
    ['at the top of game', () => doc(poison('{"__proto__":{"polluted":true}}') as Bag)],
    ['inside branding', () => doc({ branding: poison('{"__proto__":{"polluted":true}}') })],
    ['as `constructor` inside scoringOptions', () => doc({ scoringOptions: poison('{"constructor":{"polluted":true}}') })],
    ['as `prototype` inside safeZone', () => doc({ safeZone: poison('{"prototype":{"polluted":true}}') })],
    ['inside a stage', () => doc({ stages: [{ ...stage(), ...(poison('{"__proto__":{"polluted":true}}') as Bag) }] })],
    ['inside a task', () => withTask(poison('{"__proto__":{"polluted":true}}') as Bag)],
    ['inside task.smart', () => withTask({ smart: poison('{"enabled":true,"__proto__":{"polluted":true}}') })],
    ['inside steps[0]', () => withTask({ type: 'sequence', steps: poison('[{"id":"p1","prompt":"a","answer":"b","__proto__":{"polluted":true}}]') })],
    ['inside media[0]', () => withTask({ media: poison('[{"id":"m1","kind":"image","url":"https://x/y.png","constructor":{"polluted":true}}]') })],
  ];

  for (const [name, build] of cases) {
    it(`refuses a polluting key ${name}`, () => {
      const reasons = refusal(build());
      expect(reasons).toMatch(/__proto__|constructor|prototype/);
    });
  }

  it('never modifies the base object prototype while validating a hostile document', () => {
    parseGameFile(withTask({ media: JSON.parse('[{"__proto__":{"polluted":true}}]') }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('gameFile hardening — resource exhaustion', () => {
  it('refuses an answers list longer than the array cap, naming the bound', () => {
    const reasons = refusal(withTask({
      type: 'quiz',
      answers: Array.from({ length: MAX_FILE_ARRAY_LEN + 1 }, () => 'a'),
    }));
    expect(reasons).toContain('answers');
    expect(reasons).toContain(String(MAX_FILE_ARRAY_LEN));
  });

  it('refuses an oversized choices list', () => {
    const reasons = refusal(withTask({
      type: 'quiz',
      choices: Array.from({ length: MAX_FILE_ARRAY_LEN + 1 }, () => 'c'),
      answers: ['c'],
    }));
    expect(reasons).toContain('choices');
  });

  it('refuses an oversized sequence steps list', () => {
    const reasons = refusal(withTask({
      type: 'sequence',
      steps: Array.from({ length: MAX_FILE_ARRAY_LEN + 1 }, (_, i) => ({ id: `p${i}`, prompt: 'a', answer: 'b' })),
    }));
    expect(reasons).toContain('steps');
  });

  it('refuses an oversized unlockAfterTaskIds list', () => {
    const reasons = refusal(withTask({
      unlockAfterTaskIds: Array.from({ length: MAX_FILE_ARRAY_LEN + 1 }, (_, i) => `t${i}`),
    }));
    expect(reasons).toContain('unlockAfterTaskIds');
  });

  // Regression guards for the cap that already existed.
  it('refuses a multi-megabyte description, naming the string limit', () => {
    const reasons = refusal(withTask({ description: 'x'.repeat(MAX_FILE_STRING_LEN + 1) }));
    expect(reasons).toContain(String(MAX_FILE_STRING_LEN));
  });

  it('refuses an over-long hint', () => {
    const reasons = refusal(withTask({ hint: 'x'.repeat(MAX_FILE_STRING_LEN + 1), hintPenalty: 5 }));
    expect(reasons).toContain(String(MAX_FILE_STRING_LEN));
  });
});

describe('gameFile hardening — deep nesting', () => {
  function nest(depth: number): unknown {
    let node: unknown = 1;
    for (let i = 0; i < depth; i++) node = { n: node };
    return node;
  }

  it('refuses an over-deep object graph instead of overflowing the stack', () => {
    const reasons = refusal(doc({ branding: nest(MAX_FILE_DEPTH + 5) }));
    expect(reasons).toMatch(/deep|depth/i);
  });

  it('refuses an over-deep document supplied as raw JSON text', () => {
    // 40 000 levels: enough that any RECURSIVE walk blows the JS stack. The scan
    // must be iterative and refuse it as data.
    const n = 40_000;
    const text = `{"format":"${GAME_FILE_FORMAT}","schemaVersion":${CURRENT_GAME_FILE_VERSION},`
      + `"exportedAt":"x","game":{"title":"G","stages":[],"branding":`
      + `${'{"n":'.repeat(n)}1${'}'.repeat(n)}}}`;
    const reasons = refusal(text);
    expect(reasons).toMatch(/deep|depth|too large/i);
  });

  it('accepts a legitimately nested document (the cap is generous)', () => {
    accepted(withTask({
      media: [{ id: 'm1', kind: 'image', url: 'https://x/y.png' }],
      smart: { enabled: true },
    }));
  });
});

describe('gameFile hardening — type confusion', () => {
  it('refuses a number where an answers list is expected', () => {
    const reasons = refusal(withTask({ type: 'quiz', choices: ['a', 'b'], answers: 5 }));
    expect(reasons).toContain('answers');
  });

  it('refuses a non-string inside answers', () => {
    const reasons = refusal(withTask({ type: 'quiz', choices: ['a', 'b'], answers: ['a', 5] }));
    expect(reasons).toContain('answers');
  });

  it('refuses an object where choices is expected', () => {
    const reasons = refusal(withTask({ type: 'quiz', choices: {}, answers: ['a'] }));
    expect(reasons).toContain('choices');
  });

  it('refuses a string where steps is expected', () => {
    const reasons = refusal(withTask({ type: 'sequence', steps: 'x' }));
    expect(reasons).toContain('steps');
  });

  it('refuses non-objects inside steps', () => {
    const reasons = refusal(withTask({ type: 'sequence', steps: [1, 2] }));
    expect(reasons).toContain('steps');
  });

  it('refuses non-objects inside the media list', () => {
    const reasons = refusal(withTask({ media: [1, 2, 3] }));
    expect(reasons).toContain('media');
  });

  it('refuses an object where the media list is expected', () => {
    const reasons = refusal(withTask({ media: { id: 'm1', kind: 'image', url: 'https://x/y.png' } }));
    expect(reasons).toContain('media');
  });

  it('refuses a number where a description is expected', () => {
    const reasons = refusal(withTask({ description: 42 }));
    expect(reasons).toContain('description');
  });

  it('refuses a number where a game title is expected', () => {
    refusal(doc({ title: 7 }));
  });

  it('refuses stages that are not a list', () => {
    refusal(doc({ stages: {} }));
  });

  // Already-correct behaviour, asserted so it cannot regress.
  it.each([
    ['a top-level array', [1, 2]],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a game that is an array', { format: GAME_FILE_FORMAT, schemaVersion: CURRENT_GAME_FILE_VERSION, exportedAt: 'x', game: [] }],
  ])('refuses %s', (_name, input) => {
    refusal(input);
  });

  it('never lets a wrongly-typed answers value reach the downstream structural guard', () => {
    // THE 500: `answers: 5` used to parse clean, and then
    // gameStructureProblems → taskCompletabilityError threw
    // "TypeError: task.answers.some is not a function" INSIDE importGameFile,
    // so the creator got an opaque `internal` instead of a field-level refusal.
    const result = parseGameFile(withTask({ type: 'quiz', choices: ['a'], answers: 5 }));
    expect(result.game).toBeNull();
    // And even if a caller ignored the errors, nothing wrongly-typed survives.
    expect(() => gameStructureProblems((result.game as unknown as { stages: never[] })?.stages ?? [])).not.toThrow();
  });
});

describe('gameFile hardening — numeric poison', () => {
  const nonFinite: [string, number][] = [
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ];

  const numericFields = [
    'numericAnswer', 'numericTolerance', 'geofenceRadiusMeters', 'hintPenalty', 'pointValue',
  ] as const;

  for (const field of numericFields) {
    for (const [label, value] of nonFinite) {
      it(`refuses ${label} in task.${field}`, () => {
        const reasons = refusal(withTask({ [field]: value }));
        expect(reasons).toContain(field);
      });
    }
  }

  it('refuses a non-finite stage.requiredTaskCount', () => {
    const reasons = refusal(doc({ stages: [stage({ requiredTaskCount: Infinity })] }));
    expect(reasons).toMatch(/requiredTaskCount/);
  });

  it('refuses a value that only becomes non-finite when the JSON text is parsed (1e999)', () => {
    // JSON has no Infinity literal — 1e999 is how it arrives in a hand-edited file.
    const text = JSON.stringify(withTask({ type: 'numeric', numericTolerance: 1 }))
      .replace('"numericTolerance":1', '"numericTolerance":1,"numericAnswer":1e999');
    const reasons = refusal(text);
    expect(reasons).toContain('numericAnswer');
  });

  it('never coerces a supplied number to null on an accepted game', () => {
    const game = accepted(withTask({ type: 'numeric', numericAnswer: 42, numericTolerance: 0.5 }));
    const t = (game.stages as Bag[])[0].tasks as Bag[];
    expect(t[0].numericAnswer).toBe(42);
    expect(t[0].numericTolerance).toBe(0.5);
  });

  it.each([
    ['latitude out of range', { lat: 91, lng: 35 }],
    ['longitude out of range', { lat: 31, lng: 181 }],
    ['non-finite latitude', { lat: Infinity, lng: 35 }],
  ])('refuses %s', (_name, coordinates) => {
    refusal(withTask({ coordinates }));
  });
});

describe('gameFile hardening — identity / authz smuggling (regression)', () => {
  it('takes content only: server-owned and wallet fields in the file are never carried through', () => {
    const game = accepted(doc({
      id: 'stolen-game-id',
      ownerUid: 'someone-elses-uid',
      visibility: 'public',
      playCount: 9999,
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '1999-01-01T00:00:00.000Z',
      deletedAt: '1999-01-01T00:00:00.000Z',
      deletedBy: 'someone-elses-uid',
      integrationWebhookUrl: 'https://hooks.example.com/secret',
      integrationPlatform: 'slack',
      credits: 1_000_000,
      wallet: { balance: 1_000_000 },
      runs: [{ id: 'r1' }],
      popularity: 999,
      likeCount: 999,
    }));

    for (const key of [
      'id', 'ownerUid', 'visibility', 'playCount', 'createdAt', 'updatedAt', 'deletedAt',
      'deletedBy', 'integrationWebhookUrl', 'integrationPlatform', 'credits', 'wallet', 'runs',
      'popularity', 'likeCount',
    ]) {
      expect(game, `smuggled field "${key}" survived the import`).not.toHaveProperty(key);
    }
  });

  it('does not carry the runtime station counter or injected station coords', () => {
    const game = accepted(withTask({
      currentTeamCount: 7,
      smart: { enabled: true, stationCoords: { lat: 1, lng: 2 } },
    }));
    const t = ((game.stages as Bag[])[0].tasks as Bag[])[0];
    expect(t).not.toHaveProperty('currentTeamCount');
    expect(t.smart).not.toHaveProperty('stationCoords');
  });
});

describe('gameFile hardening — round-trip integrity (regression)', () => {
  it('a fully-loaded Hebrew game with every task type survives export → import unchanged', () => {
    const coordinates = { lat: 31.7767, lng: 35.2345 };
    const base = {
      coordinates, difficulty: 3, estimatedMinutes: 7, pointValue: 20, maxConcurrentTeams: 2,
    };
    const source = {
      title: 'מסע בעיר העתיקה 🕯️',
      description: 'תיאור המשחק — עם מקף ארוך',
      mode: 'team',
      // A ZWJ emoji sequence in a NON-sanitized field (tags/answers/clues) must
      // survive untouched — see the note at the end of parseGameFile. Titles and
      // descriptions ARE sanitized (stripUnsafeDisplayChars), by design.
      tags: ['ירושלים', 'ערב 👨‍👩‍👧'],
      instructions: { title: 'איך משחקים', body: 'הוראות למשתתפים' },
      stages: [{
        id: 'st1', order: 0, title: 'שלב ראשון', isFinal: false,
        narrative: { intro: { text: 'פתיחה' } },
        tasks: [
          { ...base, id: 'a1', title: 'צ׳ק-אין', type: 'field' },
          { ...base, id: 'a2', title: 'דיווח עצמי', type: 'self_report' },
          { ...base, id: 'a3', title: 'תחנה חכמה', type: 'smart_station', smart: { enabled: true, secretCode: 'סוד-4763', hasCode: true } },
          { ...base, id: 'a4', title: 'תמונה', type: 'photo', media: [{ id: 'm1', kind: 'image', url: 'https://example.com/a.png' }] },
          { ...base, id: 'a5', title: 'שאלון', type: 'quiz', choices: ['אלף', 'בית'], answers: ['אלף'] },
          { ...base, id: 'a6', title: 'מספר', type: 'numeric', numericAnswer: 42, numericTolerance: 1.5 },
          { ...base, id: 'a7', title: 'גדר', type: 'geofence', geofenceRadiusMeters: 30 },
          { ...base, id: 'a8', title: 'רצף', type: 'sequence', steps: [{ id: 'p1', prompt: 'צעד', answer: 'תשובה 👨‍👩‍👧' }] },
          { ...base, id: 'a9', title: 'סקר', type: 'survey', surveyChoices: ['כן', 'לא'] },
          {
            ...base, id: 'a10', title: 'רמז בתשלום', type: 'self_report',
            hint: 'הרמז 💡', hintPenalty: 5, locationClue: 'ליד השער', locationClueHe: 'ליד השער',
            unlockAfterTaskIds: ['a1'], releaseAfterMinutes: 5, expiresAfterMinutes: 60,
          },
        ],
      }],
    };

    const file = serializeGameToFile(source as never);
    const parsed = parseGameFile(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.game).toEqual(file.game);
    // The ZWJ sequence must not be mangled where the authoring path leaves it alone.
    expect(parsed.game?.tags).toEqual(['ירושלים', 'ערב 👨‍👩‍👧']);
  });
});
