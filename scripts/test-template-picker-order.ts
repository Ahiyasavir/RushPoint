// Pure-logic tests — the creator's game-creation template picker order
// (change: admin-manage-game-templates, superseding template-picker-blank-first).
//
// Templates are now Firestore-backed (admin-authored Game docs flagged
// isTemplate:true), fetched via listGameTemplates and grouped by language
// sibling. "Blank" stays a hardcoded, always-first, client-side special case in
// DashboardPage.tsx — not modeled here. This file pins the two pure functions
// that decide everything AFTER Blank: group sort order and which language
// variant a creator sees.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { orderTemplatesForPicker, resolveTemplateVariant } from '../apps/creator-web/src/lib/templatePicker';
import type { TemplateGroupEntry, TemplateVariant } from '../apps/creator-web/src/services/calls';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}

function variant(id: string, title: string): TemplateVariant {
  return { id, ownerUid: 'admin1', title, mode: 'team', scoringPreset: 'time_only', stageCount: 1, taskCount: 1 };
}

console.log('\n── 1. group sort order ─────────────────────────────────────');
{
  const groups: TemplateGroupEntry[] = [
    { groupKey: 'g-third', templateOrder: 3, variants: { he: variant('t3', 'Third') } },
    { groupKey: 'g-first', templateOrder: 1, variants: { he: variant('t1', 'First') } },
    { groupKey: 'g-second', templateOrder: 2, variants: { he: variant('t2', 'Second') } },
  ];
  const ordered = orderTemplatesForPicker(groups, 'he');
  ok('sorted by templateOrder ascending',
    ordered.map((o) => o.groupKey).join(',') === 'g-first,g-second,g-third', ordered.map((o) => o.groupKey));
}

console.log('\n── 2. undefined templateOrder sorts last ───────────────────');
{
  const groups: TemplateGroupEntry[] = [
    { groupKey: 'g-noOrder', variants: { he: variant('tN', 'No Order') } },
    { groupKey: 'g-ordered', templateOrder: 1, variants: { he: variant('tO', 'Ordered') } },
  ];
  const ordered = orderTemplatesForPicker(groups, 'he');
  ok('ordered group comes before the unordered one',
    ordered.map((o) => o.groupKey).join(',') === 'g-ordered,g-noOrder', ordered.map((o) => o.groupKey));
}

console.log('\n── 3. equal order ties break by title ───────────────────────');
{
  const groups: TemplateGroupEntry[] = [
    { groupKey: 'g-zebra', templateOrder: 1, variants: { he: variant('tz', 'Zebra') } },
    { groupKey: 'g-apple', templateOrder: 1, variants: { he: variant('ta', 'Apple') } },
  ];
  const ordered = orderTemplatesForPicker(groups, 'he');
  ok('tie-break by resolved title', ordered.map((o) => o.groupKey).join(',') === 'g-apple,g-zebra', ordered.map((o) => o.groupKey));
}

console.log('\n── 4. language resolution: currentLang → he → first available ──');
{
  const both: TemplateGroupEntry = { groupKey: 'g-both', variants: { he: variant('h', 'HE'), en: variant('e', 'EN') } };
  ok('exact currentLang match wins', resolveTemplateVariant(both, 'en')?.id === 'e');
  ok('currentLang match for he', resolveTemplateVariant(both, 'he')?.id === 'h');

  const heOnly: TemplateGroupEntry = { groupKey: 'g-he-only', variants: { he: variant('h2', 'HE only') } };
  ok('missing currentLang falls back to he', resolveTemplateVariant(heOnly, 'en')?.id === 'h2');

  const frOnly: TemplateGroupEntry = { groupKey: 'g-fr-only', variants: { fr: variant('f', 'FR only') } };
  ok('no currentLang and no he: falls back to first available (alphabetical)', resolveTemplateVariant(frOnly, 'en')?.id === 'f');

  const empty: TemplateGroupEntry = { groupKey: 'g-empty', variants: {} };
  ok('a group with zero variants resolves to undefined (defensive)', resolveTemplateVariant(empty, 'en') === undefined);
}

console.log('\n── 5. orderTemplatesForPicker resolves the right variant per group ──');
{
  const groups: TemplateGroupEntry[] = [
    { groupKey: 'g-bi', templateOrder: 1, variants: { he: variant('bi-he', 'Bilingual HE'), en: variant('bi-en', 'Bilingual EN') } },
    { groupKey: 'g-mono', templateOrder: 2, variants: { he: variant('mono-he', 'Mono') } },
  ];
  const orderedEn = orderTemplatesForPicker(groups, 'en');
  ok('bilingual group resolves to its EN variant for an EN creator', orderedEn[0]?.variant.id === 'bi-en');
  ok('mono-lingual group falls back to HE for an EN creator', orderedEn[1]?.variant.id === 'mono-he');
}

if (failures > 0) {
  console.error(`\n✗ ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ template picker order OK\n');
