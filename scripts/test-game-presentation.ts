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
  stages: [{ id: 's1', order: 0, title: 'Stage 1', tasks: [{ id: 't1', title: 'Go', type: 'field' }] }],
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
  ok(key in payload, `payload carries the builder-editable field "${key}"`);
  ok(same(payload[key], expected), `payload."${key}" deep-equals the game's value`);
}

// The four that were silently dropped — named explicitly so a regression reads clearly.
for (const key of ['scoringOptions', 'coverImage', 'branding', 'approxLocation']) {
  ok(BUILDER_EDITABLE_FIELDS.includes(key as never),
    `"${key}" is declared builder-editable (it is rendered downstream)`);
  ok(key in payload, `"${key}" reaches the save payload`);
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
