// Pure-logic tests — the canonical bank tag registry
// (change: smart-game-composer).
//
// BANK_TAGS is the ONE vocabulary the composer filters and scores on. It is flat
// and open on purpose: grouping in the source file is documentation, and every
// consumer treats a tag as one equal id (`entry.tags.includes(id)`). That is what
// makes "add a night-only tag" one registry line instead of a type change, a
// migration and a new accessor.
//
// Two properties are worth a gate rather than a code read:
//
//   • every tag carries BOTH labels, in the right language. These labels are
//     rendered straight into the questionnaire, so a missing `en` is an English
//     creator staring at a blank chip, and Hebrew leaking into `en` is exactly
//     the recurring "English text in the Hebrew Builder" bug in reverse. The
//     leak predicate is imported from scripts/lib/i18nLeak.ts — the same one the
//     i18n gate uses — never re-implemented here.
//   • the ids the composer's narrow answer types are built from all exist. Those
//     aliases (AudienceTagId / SettingTagId) are hand-written unions; if one
//     drifts from the registry, the composer would filter on a tag no entry can
//     ever carry and silently score everything zero.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  settingForAreas,
  AREA_SETTING,
  AREA_TAG_IDS,
  AREA_KIND_TAG_IDS,
  AREA_QUALITY_TAG_IDS,
  BANK_TAGS,
  BANK_TAG_IDS,
  AUDIENCE_TAG_IDS,
  SETTING_TAG_IDS,
  BOOKEND_TAG_IDS,
  type BankTagId,
} from '../apps/creator-web/src/bankTags';
import { hasEnglishWord, hasHebrew } from './lib/i18nLeak';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const ids = Object.keys(BANK_TAGS) as BankTagId[];

console.log('\n── 1. the registry is a usable table ───────────────────────');
ok('BANK_TAGS is a non-empty object', ids.length > 0);
ok('the registry holds enough tags to describe a mission from several angles', ids.length >= 15);
eq('BANK_TAG_IDS mirrors the registry keys, in declaration order', BANK_TAG_IDS, ids);
ok('every id is non-empty and camelCase-or-lowercase (no spaces, no punctuation)',
  ids.every((id) => /^[a-z][A-Za-z]*$/.test(id)));
ok('every id is unique', new Set(ids).size === ids.length);

console.log('\n── 2. every tag carries both labels ────────────────────────');
ok('every entry is an object with `he` and `en`',
  ids.every((id) => {
    const t = BANK_TAGS[id] as unknown as Record<string, unknown>;
    return !!t && typeof t === 'object' && typeof t.he === 'string' && typeof t.en === 'string';
  }));
ok('no label is empty or whitespace-only',
  ids.every((id) => BANK_TAGS[id].he.trim() !== '' && BANK_TAGS[id].en.trim() !== ''));

console.log('\n── 3. the labels are really in their language ──────────────');
{
  const heLeaks = ids.filter((id) => !hasHebrew(BANK_TAGS[id].he) || hasEnglishWord(BANK_TAGS[id].he));
  ok(`every \`he\` label is Hebrew and leaks no English${heLeaks.length ? ` — offenders: ${heLeaks.join(', ')}` : ''}`,
    heLeaks.length === 0);

  const enLeaks = ids.filter((id) => hasHebrew(BANK_TAGS[id].en));
  ok(`every \`en\` label leaks no Hebrew${enLeaks.length ? ` — offenders: ${enLeaks.join(', ')}` : ''}`,
    enLeaks.length === 0);

  ok('every `en` label contains Latin letters',
    ids.every((id) => /[A-Za-z]/.test(BANK_TAGS[id].en)));
}

console.log('\n── 4. the ids the composer is built on all exist ───────────');
// These three lists are what ComposerAnswers' narrow types and the bookend rule
// are made of. A drift here is invisible at runtime — filtering on a tag nothing
// carries just returns an empty pool — so it is asserted rather than trusted.
{
  const known = new Set<string>(ids);
  const missing = (list: readonly string[]) => list.filter((id) => !known.has(id));

  eq('every audience id is a registry tag', missing(AUDIENCE_TAG_IDS), []);
  eq('every setting id is a registry tag', missing(SETTING_TAG_IDS), []);
  eq('every bookend id is a registry tag', missing(BOOKEND_TAG_IDS), []);

  eq('the audience vocabulary is the five the questionnaire offers',
    [...AUDIENCE_TAG_IDS].sort(), ['adults', 'corporate', 'kids', 'mixed', 'youth']);
  eq('the setting vocabulary is the three the questionnaire offers',
    [...SETTING_TAG_IDS].sort(), ['fromAnywhere', 'indoor', 'outdoor']);
  eq('the bookend vocabulary is opener + finale', [...BOOKEND_TAG_IDS], ['start', 'finish']);

  ok('the audience, setting and bookend vocabularies do not overlap',
    new Set([...AUDIENCE_TAG_IDS, ...SETTING_TAG_IDS, ...BOOKEND_TAG_IDS]).size
      === AUDIENCE_TAG_IDS.length + SETTING_TAG_IDS.length + BOOKEND_TAG_IDS.length);
}

console.log('\n── 5. the activity vocabulary the description names ────────');
{
  // The composed description names ACTIVITY tags ("a game of photo missions and
  // riddles"), so at least a couple must exist or every description collapses to
  // the bare lead.
  const ACTIVITY = ['action', 'camera', 'thinking', 'teamwork', 'creative'] as const;
  const known = new Set<string>(ids);
  eq('every activity id is a registry tag', ACTIVITY.filter((id) => !known.has(id)), []);
}


// ─── settingForAreas: the places named imply the setting ─────────────────────
//
// There is no separate indoor/outdoor question any more — naming a mall already
// said it. That makes this function the single point where a creator's answer
// becomes a setting, so its edge cases are creator-visible: answering "indoor"
// for a list holding nothing real would switch on location-based missions and
// hand someone a game full of pins to drop that they never asked for.
console.log('\n── settingForAreas ──────────────────────────────────────────');
{
  const cases: Array<[string, unknown, string]> = [
    ['no places named', [], 'fromAnywhere'],
    ['not an array', 'mall', 'fromAnywhere'],
    ['undefined', undefined, 'fromAnywhere'],
    ['only unknown ids', ['nope'], 'fromAnywhere'],
    ['only nulls', [null], 'fromAnywhere'],
    ['one indoor place', ['mall'], 'indoor'],
    ['indoor plus junk', ['mall', null], 'indoor'],
    ['every indoor place', ['mall', 'office', 'school'], 'indoor'],
    ['one outdoor place', ['park'], 'outdoor'],
    ['outdoor plus junk', ['park', 'junk'], 'outdoor'],
    ['mixed indoor and outdoor is outdoor', ['mall', 'park'], 'outdoor'],
    // A QUALITY alone carries no indoor/outdoor signal — see AREA_QUALITY_TAG_IDS.
    // Before AREA_SETTING was scoped to kinds only, this fell through to the
    // "indoor" default, which would have quietly turned on location-based
    // missions for a creator who named no actual venue.
    ['a quality alone (crowded)', ['crowded'], 'fromAnywhere'],
    ['a quality alone (historic)', ['historic'], 'fromAnywhere'],
    ['both qualities, no kind', ['crowded', 'historic'], 'fromAnywhere'],
    ['a quality plus an outdoor kind', ['crowded', 'park'], 'outdoor'],
    ['a quality plus an indoor kind', ['historic', 'mall'], 'indoor'],
  ];
  for (const [label, input, want] of cases) {
    eq(`${label} => ${want}`, settingForAreas(input as never), want);
  }

  // Every KIND of place must classify, or a new one silently reads as indoor.
  // A QUALITY (crowded, historic) deliberately carries no such classification —
  // see the note on AREA_QUALITY_TAG_IDS — so the invariant is scoped to kinds.
  eq('every area KIND has a setting',
    AREA_KIND_TAG_IDS.filter((a) => AREA_SETTING[a] !== 'indoor' && AREA_SETTING[a] !== 'outdoor'), []);
  eq('the classification covers exactly the area KINDS, no more',
    Object.keys(AREA_SETTING).sort(), [...AREA_KIND_TAG_IDS].sort());
  eq('AREA_TAG_IDS is exactly kinds plus qualities, no overlap, no gap',
    [...AREA_KIND_TAG_IDS, ...AREA_QUALITY_TAG_IDS].sort(), [...AREA_TAG_IDS].sort());
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/bank-tags: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/bank-tags: all assertions passed\x1b[0m');
