// Pure-logic tests for surface-invisible-fields — the Builder's save payload and
// the presentation-field normalizers. Run by scripts/run-unit-tests.mjs via `npm test`.
//
// WHY A PAYLOAD-COMPLETENESS TEST EXISTS AT ALL
// The Builder's update payload used to be a hand-maintained object literal. Adding a
// control to the Settings panel did not add its field to that literal, and nothing
// failed: the wrong-answer-cost selector highlighted, patched local state, and was
// never sent — nor even seen as a change, because the dirty check serializes the same
// payload. This file is the structural guard: a field declared builder-editable that
// does not reach the payload fails `npm test` instead of shipping as a dead button.
import {
  buildSavePayload,
  BUILDER_EDITABLE_FIELDS,
} from '../apps/creator-web/src/lib/savePayload';
import {
  normalizeHttpsUrl,
  normalizeBrandColor,
  hasBrandingValue,
} from '../apps/creator-web/src/lib/gamePresentation';
import type { Game } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A game populated on EVERY builder-editable field, plus the server-owned fields the
// payload must never echo back.
const fullGame = {
  id: 'g1',
  ownerUid: 'owner-1',
  title: 'Old City Hunt',
  description: 'A walk through the alleys',
  mode: 'team',
  // The task carries a Builder-editable TASK-level field (pause-clock-tasks) so the
  // guard below proves the `stages` passthrough really carries per-task authorship.
  // `expectedDurationMinutes` (task-duration-defaults) is the second TASK-level
  // Builder field riding the same passthrough — the editor lets a creator override
  // the derived per-interaction default, and an unregistered override would save
  // nothing while looking alive.
  stages: [{ id: 's1', order: 0, title: 'Stage 1', tasks: [{ id: 't1', title: 'Go', type: 'field', pausesTimer: true, expectedDurationMinutes: 4 }] }],
  scoringPreset: 'smart_weighted',
  scoringOptions: { wrongAnswerPenalty: 'strict' },
  registrationFields: [{ id: 'name', label: 'Name', type: 'text', required: true, level: 'member' }],
  branding: { name: 'Acme Quests', primaryColor: '#12ab34' },
  visibility: 'public',
  tags: ['jerusalem', 'walking'],
  coverImage: 'https://cdn.example.com/cover.jpg',
  approxLocation: { lat: 31.775, lng: 35.235, label: 'Old City' },
  playCount: 7,
  integrationWebhookUrl: 'https://hooks.slack.com/services/A/B/C',
  safeZone: { center: { lat: 31.775, lng: 35.235 }, radiusMeters: 600 },
  allowInstantPlay: true,
  photoFeedEnabled: false,
  powerUpsEnabled: true,
  manualLeaderboardReveal: true,
  instructions: { title: 'How to play', body: 'Walk.', bodyHe: 'ללכת.' },
  deletedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
} as unknown as Game;

// ── payload completeness ─────────────────────────────────────────────────────
const payload = buildSavePayload(fullGame) as Record<string, unknown>;

ok(payload.gameId === 'g1', 'buildSavePayload sets gameId from game.id');

for (const key of BUILDER_EDITABLE_FIELDS) {
  const expected = (fullGame as unknown as Record<string, unknown>)[key];
  // The fixture must actually EXERCISE every declared field. Without this, adding a
  // field to BUILDER_EDITABLE_FIELDS and forgetting it here compared undefined with
  // undefined and passed — the guard would have gone quiet exactly when a new control
  // was added, which is the one moment it exists for (change: expose-enforced-settings).
  ok(expected !== undefined, `the fixture game populates the builder-editable field "${key}"`);
  ok(key in payload, `payload carries the builder-editable field "${key}"`);
  ok(same(payload[key], expected), `payload."${key}" deep-equals the game's value`);
}

// The safe zone is the field the SERVER enforces (updateLocation + the routing
// soft-pause) and that nothing in either app could set (change:
// expose-enforced-settings). It reaches the payload, and clearing it must be a
// distinguishable change rather than a silent no-op.
ok(BUILDER_EDITABLE_FIELDS.includes('safeZone' as never),
  '"safeZone" is declared builder-editable (the server enforces it)');
ok('safeZone' in payload, '"safeZone" reaches the save payload');
const zoned   = { ...fullGame, safeZone: { center: { lat: 31.775, lng: 35.235 }, radiusMeters: 800 } } as unknown as Game;
const cleared = { ...fullGame, safeZone: null } as unknown as Game;
ok(JSON.stringify(buildSavePayload(zoned)) !== JSON.stringify(buildSavePayload(cleared)),
  'clearing the safe zone changes the serialized payload (marks the game dirty)');
ok((buildSavePayload(cleared) as Record<string, unknown>).safeZone === null,
  'a cleared safe zone is sent as null (an explicit clear), never as undefined');

// The four that were silently dropped — named explicitly so a regression reads clearly.
for (const key of ['scoringOptions', 'coverImage', 'branding', 'approxLocation']) {
  ok(BUILDER_EDITABLE_FIELDS.includes(key as never),
    `"${key}" is declared builder-editable (it is rendered downstream)`);
  ok(key in payload, `"${key}" reaches the save payload`);
}

// ── TASK-level authorship rides `stages` ─────────────────────────────────────
// BUILDER_EDITABLE_FIELDS is a GAME-level allow-list, so a field the task editor
// owns (pause-clock-tasks' `pausesTimer`, the hidden-location clue, the paid hint…)
// reaches updateGame only through `stages`. That indirection is exactly where a
// per-task control can go silently dead, so it gets its own guard: the value must
// survive the payload AND changing it must change the serialization, which is what
// marks the game dirty.
{
  const taskOf = (p: Record<string, unknown>) =>
    ((p.stages as { tasks: Record<string, unknown>[] }[])[0].tasks[0]);
  ok(taskOf(payload).pausesTimer === true,
    'a TASK-level builder field (pausesTimer) survives into the save payload via stages');
  ok(taskOf(payload).expectedDurationMinutes === 4,
    'a TASK-level builder field (expectedDurationMinutes) survives into the save payload via stages');

  const paused = fullGame;
  const notPaused = {
    ...fullGame,
    stages: [{ id: 's1', order: 0, title: 'Stage 1', tasks: [{ id: 't1', title: 'Go', type: 'field' }] }],
  } as unknown as Game;
  ok(JSON.stringify(buildSavePayload(paused)) !== JSON.stringify(buildSavePayload(notPaused)),
    'toggling a TASK-level field changes the serialized payload (marks the game dirty)');
}

// ── server-owned fields are never echoed back ────────────────────────────────
for (const key of ['id', 'ownerUid', 'visibility', 'playCount', 'createdAt', 'updatedAt', 'deletedAt']) {
  ok(!(key in payload), `payload does NOT send the server-owned field "${key}"`);
}

// ── the dirty check: the regression that started this change ─────────────────
// serializeGame is JSON.stringify(buildSavePayload(g)), so a field missing from the
// payload is invisible twice — never sent AND never marked unsaved.
const withoutCost = { ...fullGame, scoringOptions: undefined } as unknown as Game;
const withCost    = { ...fullGame, scoringOptions: { wrongAnswerPenalty: 'gentle' } } as unknown as Game;
ok(JSON.stringify(buildSavePayload(withoutCost)) !== JSON.stringify(buildSavePayload(withCost)),
  'changing the wrong-answer cost changes the serialized payload (marks the game dirty)');

const brandedA = { ...fullGame, branding: { name: 'A' } } as unknown as Game;
const brandedB = { ...fullGame, branding: { name: 'B' } } as unknown as Game;
ok(JSON.stringify(buildSavePayload(brandedA)) !== JSON.stringify(buildSavePayload(brandedB)),
  'changing the brand name changes the serialized payload');

// A minimal game must not blow up or invent values.
const minimal = { id: 'g2', title: 'X', mode: 'individual', stages: [], tags: [] } as unknown as Game;
const minPayload = buildSavePayload(minimal) as Record<string, unknown>;
ok(minPayload.gameId === 'g2', 'minimal game still yields a gameId');
ok(minPayload.coverImage === undefined, 'absent optional field stays undefined, never ""');

// ── normalizeHttpsUrl ────────────────────────────────────────────────────────
ok(normalizeHttpsUrl('https://cdn.example.com/a.jpg') === 'https://cdn.example.com/a.jpg',
  'https URL passes through');
ok(normalizeHttpsUrl('  https://cdn.example.com/a.jpg  ') === 'https://cdn.example.com/a.jpg',
  'surrounding whitespace is trimmed');
ok(normalizeHttpsUrl('http://cdn.example.com/a.jpg') === undefined, 'http is rejected');
ok(normalizeHttpsUrl('javascript:alert(1)') === undefined, 'javascript: is rejected');
ok(normalizeHttpsUrl('data:image/png;base64,AAA') === undefined, 'data: is rejected');
ok(normalizeHttpsUrl('cdn.example.com/a.jpg') === undefined, 'a scheme-less URL is rejected');
ok(normalizeHttpsUrl('') === undefined, 'empty string → undefined');
ok(normalizeHttpsUrl('   ') === undefined, 'whitespace-only → undefined');
ok(normalizeHttpsUrl(undefined) === undefined, 'undefined → undefined');
ok(normalizeHttpsUrl('not a url at all') === undefined, 'garbage → undefined (never throws)');

// ── normalizeBrandColor ──────────────────────────────────────────────────────
ok(normalizeBrandColor('#AABBCC') === '#aabbcc', 'uppercase hex is lowercased');
ok(normalizeBrandColor('#abc') === '#aabbcc', 'shorthand hex is expanded');
ok(normalizeBrandColor('  #12AB34 ') === '#12ab34', 'whitespace is trimmed');
ok(normalizeBrandColor('aabbcc') === undefined, 'a missing # is rejected');
ok(normalizeBrandColor('#aabbc') === undefined, 'wrong length is rejected');
ok(normalizeBrandColor('#gggggg') === undefined, 'non-hex characters are rejected');
ok(normalizeBrandColor('red') === undefined, 'a named CSS colour is rejected');
ok(normalizeBrandColor('') === undefined, 'empty string → undefined');
ok(normalizeBrandColor(undefined) === undefined, 'undefined → undefined');

// ── hasBrandingValue ─────────────────────────────────────────────────────────
ok(hasBrandingValue(undefined) === false, 'undefined branding → false');
ok(hasBrandingValue({}) === false, 'empty branding object → false');
ok(hasBrandingValue({ name: '' }) === false, 'empty name → false');
ok(hasBrandingValue({ name: '   ' }) === false, 'whitespace-only name → false');
ok(hasBrandingValue({ name: 'Acme' }) === true, 'a real name → true');
ok(hasBrandingValue({ primaryColor: '#aabbcc' }) === true, 'a colour alone → true');

console.log(`game-presentation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
