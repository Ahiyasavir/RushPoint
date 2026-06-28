// Pure-logic tests for duplicate-translate-game (field collection + re-injection).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { collectTranslatableFields, applyTranslations } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const game = {
  title: 'Old City Hunt',
  description: 'A walk through history',
  scoringPreset: 'smart_weighted',
  stages: [
    {
      title: 'Gates',
      order: 0,
      tasks: [
        { title: 'Find the gate', description: 'Look up', hint: 'It is tall', type: 'field',
          coordinates: { lat: 31.79, lng: 35.16 }, answers: ['Jaffa'], pointValue: 50 },
        { title: 'Count arches', type: 'numeric', numericAnswer: 7, coordinates: { lat: 31.8, lng: 35.2 } },
      ],
    },
  ],
};

// ── collectTranslatableFields ────────────────────────────────────────────────
const fields = collectTranslatableFields(game);
const paths = fields.map((f) => f.path).sort();
ok(paths.includes('title') && paths.includes('description'), 'collects game title + description');
ok(paths.includes('stages.0.title'), 'collects stage title');
ok(paths.includes('stages.0.tasks.0.title') && paths.includes('stages.0.tasks.0.description') && paths.includes('stages.0.tasks.0.hint'), 'collects task text fields');
ok(!paths.some((p) => p.includes('answers') || p.includes('coordinates') || p.includes('numericAnswer') || p.includes('pointValue') || p.includes('type')), 'excludes answers/coords/types/numbers');
ok(!paths.includes('stages.0.tasks.1.description'), 'absent text field not collected');
ok(fields.every((f) => f.text.trim().length > 0), 'no blank fields collected');

// ── applyTranslations: identity round-trips ──────────────────────────────────
const identity: Record<string, string> = {};
for (const f of fields) identity[f.path] = f.text;
const same = applyTranslations(game, identity);
ok(JSON.stringify(same) === JSON.stringify(game), 'identity translation round-trips exactly');

// ── applyTranslations: replaces text, preserves non-text ─────────────────────
const translations: Record<string, string> = {};
for (const f of fields) translations[f.path] = `[es] ${f.text}`;
const translated = applyTranslations(game, translations);
ok(translated.title === '[es] Old City Hunt', 'game title translated');
ok(translated.stages[0].tasks[0].hint === '[es] It is tall', 'task hint translated');
// Non-text preserved verbatim.
ok(translated.scoringPreset === 'smart_weighted', 'scoring preset preserved');
ok(JSON.stringify(translated.stages[0].tasks[0].coordinates) === JSON.stringify(game.stages[0].tasks[0].coordinates), 'coordinates preserved');
ok(JSON.stringify(translated.stages[0].tasks[0].answers) === JSON.stringify(['Jaffa']), 'answers untouched by applyTranslations');
ok(translated.stages[0].tasks[1].numericAnswer === 7, 'numericAnswer preserved');
// Original is not mutated.
ok(game.title === 'Old City Hunt', 'applyTranslations does not mutate the source');

// Unknown path is ignored safely.
const robust = applyTranslations(game, { 'stages.9.tasks.9.title': 'x' });
ok(robust.title === 'Old City Hunt', 'unknown path ignored without throwing');

console.log(failed === 0
  ? `\n✅ ALL TRANSLATE-FIELDS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
