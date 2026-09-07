// Pure-logic tests — a template's visibility state
// (change: template-visibility).
//
// ─── What this file is really guarding ───────────────────────────────────────
//
// Not "does a boolean work". The predicate is one line; the reason it exists as a
// named, shared function at all is that FOUR call sites have to agree about it,
// and two of them read documents that arrived through a Firestore `.select()`
// field mask. A field missing from that mask arrives `undefined` on every
// document, so an in-memory filter on it passes everything — the feature looks
// implemented and does nothing, and nothing throws. That has already shipped once
// in this repo, with `templateGenre` (see CLAUDE.md).
//
// So §2 below is the point of the file: it asserts the predicate's behaviour on a
// masked-shaped document AND asserts mask membership, which turns the omission
// into a red test instead of a silent no-op.
import { isTemplateHidden } from '@rushpoint/shared';
import { TEMPLATE_LIST_FIELDS } from '../functions/src/admin/templates';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

console.log('\ntemplate visibility');

// ── 1. The predicate, and what ABSENT means ─────────────────────────────────
//
// Absent must mean VISIBLE. That is the whole reason the field is named for the
// non-default state (design D1): every template that exists today carries no
// field at all, and none of them may disappear from the catalogue on deploy.
console.log('\n── 1. absent means visible ────────────────────────────────');
{
  eq('a document with no field at all is not hidden', isTemplateHidden({} as never), false);
  eq('an explicit false is not hidden', isTemplateHidden({ templateHidden: false } as never), false);
  eq('an explicit true IS hidden', isTemplateHidden({ templateHidden: true } as never), true);

  // The callable transport collapses `undefined` to `null` (CLAUDE.md), so a
  // cleared client field arrives as null. It must not read as hidden.
  eq('null is not hidden', isTemplateHidden({ templateHidden: null } as never), false);

  // Only the boolean true. Nothing is coerced — a string 'true' reaching this
  // predicate means something upstream failed validation, and guessing would
  // hide a template nobody asked to hide.
  for (const junk of ['true', 'hidden', 1, {}, [], 'false', 0]) {
    eq(`junk ${JSON.stringify(junk)} is not hidden`,
      isTemplateHidden({ templateHidden: junk } as never), false);
  }

  // Total: the predicate is called on rows a query returned, and a malformed row
  // must not take down a listing every creator depends on.
  for (const junk of [undefined, null, 'a game', 42]) {
    ok(`junk document ${JSON.stringify(junk)} does not throw`,
      isTemplateHidden(junk as never) === false);
  }
}

// ── 2. The field-mask trap ──────────────────────────────────────────────────
//
// `listGameTemplates` reads through `.select(...TEMPLATE_LIST_FIELDS)`. Two
// independent things must hold, and the second is the one that has failed before.
console.log('\n── 2. the field mask ──────────────────────────────────────');
{
  // (a) A masked document that OMITS the field must read as visible, not throw
  //     and not be treated as hidden. This is the shape a `.select()` returns
  //     when the field is not in the mask.
  const masked = { id: 'x', title: 't', templateGenre: 'missions' };
  eq('a projected document without the field reads as visible',
    isTemplateHidden(masked as never), false);

  // (b) …and the mask MUST carry the field, or (a) is what production would do
  //     to every template forever. This is the assertion that makes the omission
  //     a failing test rather than a feature that silently does nothing.
  ok(`TEMPLATE_LIST_FIELDS carries templateHidden :: [${TEMPLATE_LIST_FIELDS.join(', ')}]`,
    (TEMPLATE_LIST_FIELDS as readonly string[]).includes('templateHidden'));

  // Anti-vacuity for the mask assertion itself: if the constant were empty or
  // renamed away, the check above could pass for the wrong reason.
  ok(`the mask is a real, populated list :: ${TEMPLATE_LIST_FIELDS.length} fields`,
    Array.isArray(TEMPLATE_LIST_FIELDS) && TEMPLATE_LIST_FIELDS.length >= 8);
  ok('the mask still carries the fields the picker already needed',
    ['id', 'title', 'templateGenre', 'deletedAt']
      .every((f) => (TEMPLATE_LIST_FIELDS as readonly string[]).includes(f)));
}

// ── 3. Filtering a catalogue, and the anti-vacuity guard ────────────────────
//
// The listings filter with this predicate. A predicate that always returned
// `false` would pass §1's absent cases and quietly ship a broken feature, so the
// fixture here contains a real hidden row and the test asserts it was removed.
console.log('\n── 3. filtering a mixed catalogue ─────────────────────────');
{
  const catalogue = [
    { id: 'legacy' },                              // predates the change
    { id: 'explicitly-visible', templateHidden: false },
    { id: 'hidden', templateHidden: true },
    { id: 'also-hidden', templateHidden: true },
    { id: 'nulled', templateHidden: null },
  ];
  const offered = catalogue.filter((g) => !isTemplateHidden(g as never)).map((g) => g.id);
  eq('only the hidden rows are removed', offered,
    ['legacy', 'explicitly-visible', 'nulled']);

  const removed = catalogue.length - offered.length;
  ok(`the fixture really exercises hiding :: ${removed} row(s) removed`, removed === 2);
}

console.log(failures === 0
  ? '\n✅ template visibility: all assertions passed\n'
  : `\n❌ template visibility: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
