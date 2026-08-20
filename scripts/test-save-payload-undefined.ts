// Pure test: clearing an optional task field must SAVE (change: builder-clear-optional-field).
//
// THE BUG, reported from the Builder: closing the "time and scoring" group made every
// autosave fail with "השרת דחה את הפעולה", and filling `זמן במשימה עצמה` back in fixed it.
//
// THE MECHANISM: `clearGroupPatch('timerPoints')` sets `expectedDurationMinutes:
// undefined` — the correct way to express "unset" in local state. But the Firebase
// callable serializer encodes BOTH `undefined` and `null` as `null` on the wire, so the
// server received `expectedDurationMinutes: null`. Its guard reads
//     value !== undefined && (typeof value !== 'number' || !isFinite || < 0)
// and `null` is not `undefined`, so it took the reject branch: "expected duration must
// be a non-negative number". The creator was refused for CLEARING a field that is
// optional — with no way to comply short of putting a value back.
//
// (The same transport quirk is already documented in scripts/e2e-verify.mjs, where NaN
// crosses the wire as `null` and is refused by that same arm. There it is correct — a
// NaN duration really is invalid. Here it is not: absent is a legal state.)
//
// THE FIX: the payload drops keys whose value is `undefined` before the serializer can
// turn them into `null`, so "unset" reaches the server as ABSENT, which every optional
// guard already accepts. Deliberately NOT fixed by loosening the server: `null` really
// is a malformed duration from any other caller, and that check is worth keeping sharp.
//
// An explicit `null` is left ALONE — `safeZone: null` is a documented "clear this"
// signal in BUILDER_EDITABLE_FIELDS, so the two must not be conflated.
//
// No emulator. Import SOURCE directly.
//   npx tsx scripts/test-save-payload-undefined.ts
import { buildSavePayload } from '../apps/creator-web/src/lib/savePayload';
import type { Game } from '@rushpoint/shared';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

function gameWith(taskOver: Record<string, unknown>): Game {
  return {
    id: 'g1', ownerUid: 'u1', title: 'T', mode: 'individual',
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 's1', order: 0, title: 'S', isFinal: true,
      tasks: [{
        id: 't1', title: 'Task', type: 'field',
        coordinates: { lat: 1, lng: 2 },
        difficulty: 5, estimatedMinutes: 5, pointValue: 100,
        maxConcurrentTeams: 3, ...taskOver,
      }],
    }],
  } as unknown as Game;
}

// What the wire actually carries: the callable serializer turns `undefined` into
// `null`, so the honest model of "did this reach the server as null?" is a key that
// is still PRESENT after building the payload.
function taskOf(payload: unknown): Record<string, unknown> {
  const p = payload as { stages?: Array<{ tasks?: Array<Record<string, unknown>> }> };
  return p.stages?.[0]?.tasks?.[0] ?? {};
}

// ── The reported bug: clearing the timer group ────────────────────────────────
{
  const task = taskOf(buildSavePayload(gameWith({
    expectedDurationMinutes: undefined,
    expiresAfterMinutes: undefined,
    pausesTimer: undefined,
  })));
  check('a cleared expectedDurationMinutes is ABSENT, not null',
    !('expectedDurationMinutes' in task), JSON.stringify(task.expectedDurationMinutes));
  check('a cleared expiresAfterMinutes is ABSENT, not null',
    !('expiresAfterMinutes' in task));
  check('a cleared pausesTimer is ABSENT, not null', !('pausesTimer' in task));
}

// Every other group's clear patch is the same shape and must behave the same way.
{
  const task = taskOf(buildSavePayload(gameWith({
    hint: undefined, hintPenalty: undefined,
    hintAutoRevealMinutes: undefined, hintAutoRevealAttempts: undefined,
    unlockAfterTaskIds: undefined, requirePresence: undefined,
  })));
  for (const k of ['hint', 'hintPenalty', 'hintAutoRevealMinutes',
    'hintAutoRevealAttempts', 'unlockAfterTaskIds', 'requirePresence']) {
    check(`a cleared ${k} is ABSENT, not null`, !(k in task));
  }
}

// ── Real values are untouched ────────────────────────────────────────────────
{
  const task = taskOf(buildSavePayload(gameWith({ expectedDurationMinutes: 4, pausesTimer: true })));
  check('an authored duration still reaches the server', task.expectedDurationMinutes === 4);
  check('an authored boolean still reaches the server', task.pausesTimer === true);
}
// 0 and false are REAL authored values, not absences — dropping them would silently
// discard the very settings a creator chose.
{
  const task = taskOf(buildSavePayload(gameWith({ expectedDurationMinutes: 0, pausesTimer: false })));
  check('a zero duration is preserved, not dropped', task.expectedDurationMinutes === 0);
  check('an explicit false is preserved, not dropped', task.pausesTimer === false);
}
// Empty strings/arrays are how several clears are expressed; they must survive.
{
  const task = taskOf(buildSavePayload(gameWith({ tags: [], hint: '' })));
  check('an empty tags array survives', Array.isArray(task.tags) && (task.tags as []).length === 0);
  check('an empty string survives', task.hint === '');
}

// ── An EXPLICIT null is a different signal and must be left alone ─────────────
{
  const g = gameWith({});
  (g as unknown as Record<string, unknown>).safeZone = null;
  const payload = buildSavePayload(g) as unknown as Record<string, unknown>;
  check('an explicit null clear (safeZone) is still sent as null',
    'safeZone' in payload && payload.safeZone === null, JSON.stringify(payload.safeZone));
}

// ── A CLEARED number field must arrive absent, not as null ───────────────────
// The same trap as `undefined`, reached by a different road. A React number input
// yields NaN for an empty box, NaN is not `undefined` so it survived the cleaner,
// and the callable transport encodes NaN as null on the wire. The server then sees
// a PRESENT-but-not-a-number optional field and refuses the save — so clearing one
// duration box wedged every autosave from then on, and the creator's edits stopped
// persisting with nothing on screen but a readiness panel reopening itself.
// Reproduced against a real production game on 2026-08-21.
{
  const g = gameWith({ expectedDurationMinutes: Number.NaN });
  const payload = buildSavePayload(g) as unknown as Record<string, unknown>;
  const task = taskOf(payload);
  check('a cleared number (NaN) is dropped, not sent',
    !('expectedDurationMinutes' in task), JSON.stringify(task.expectedDurationMinutes));
  check('the payload carries no non-finite number anywhere',
    JSON.stringify(payload) === JSON.stringify(JSON.parse(JSON.stringify(payload))),
    JSON.stringify(payload).slice(0, 80));
}
{
  // Infinity is the same class of accident (a divide, a parse) and equally fatal.
  const task = taskOf(buildSavePayload(gameWith({ pointValue: Number.POSITIVE_INFINITY })) as unknown as Record<string, unknown>);
  check('a non-finite Infinity is dropped too', !('pointValue' in task), JSON.stringify(task.pointValue));
}
{
  // ...but real authored numbers must survive untouched, including 0.
  const task = taskOf(buildSavePayload(gameWith({ pointValue: 0, expectedDurationMinutes: 12 })) as unknown as Record<string, unknown>);
  check('0 is an authored value and is kept', task.pointValue === 0, JSON.stringify(task.pointValue));
  check('a real duration is kept', task.expectedDurationMinutes === 12, JSON.stringify(task.expectedDurationMinutes));
}

// ── Totality: the cleaner must not corrupt the payload's shape ────────────────
{
  const payload = buildSavePayload(gameWith({})) as unknown as Record<string, unknown>;
  check('gameId survives', payload.gameId === 'g1');
  check('stages remain an array', Array.isArray(payload.stages));
  const task = taskOf(payload);
  check('nested coordinates object survives intact',
    JSON.stringify(task.coordinates) === JSON.stringify({ lat: 1, lng: 2 }));
  check('the payload is JSON-round-trippable',
    JSON.stringify(JSON.parse(JSON.stringify(payload))) === JSON.stringify(payload));
}

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
