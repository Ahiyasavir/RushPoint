// What the mission editor shows WHILE הקמה מהירה is driving it
// (change: quick-setup-guided-editor).
//
// The rule this file exists to protect is `guidedEditorView`'s rule 1: isolation
// is a SUBTRACTION, so every unknown must resolve to the whole editor. A wrong
// answer here does not look like a bug — it looks like an editor with nothing in
// it, on the one screen a creator was just told to fill in.
//
// No emulator, no DOM.
//   npx tsx scripts/test-guided-editor.ts
import { readFileSync } from 'node:fs';
import {
  guidedEditorView,
  guidedLocationView,
  GUIDED_BODY_CLASS,
  GUIDED_KEEP_CLASS,
} from '../apps/creator-web/src/lib/guidedEditor';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function eq<T>(label: string, got: T, want: T): void {
  ok(label, Object.is(got, want), Object.is(got, want) ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

console.log('\nguided mission editor');

// ── not guided ⇒ the editor is exactly what it always was ───────────────────
console.log('\n unguided');
for (const [label, input] of [
  ['null', null],
  ['undefined', undefined],
  ['guided: false', { guided: false }],
  ['guided absent', { anchor: 'title' }],
  ['guided: null', { guided: null }],
] as const) {
  const v = guidedEditorView(input as never);
  ok(`${label} ⇒ full editor`, v.isolateAnchor === null && v.showTabs && v.showTypePicker
    && v.showTaskMenu && v.showFooterNav && !v.showContextStrip, JSON.stringify(v));
}

// A truthy-but-not-true `guided` is NOT a yes. The prop is threaded as `!!guided`
// at the one call site, but the module is the thing being trusted, so it insists.
{
  const v = guidedEditorView({ guided: 1 as never, anchor: 'title' });
  ok('non-boolean truthy guided ⇒ full editor', v.isolateAnchor === null && v.showTabs);
}

// ── guided with a usable anchor ─────────────────────────────────────────────
console.log('\n guided, anchor resolves');
{
  const v = guidedEditorView({ guided: true, anchor: 'coordinates' });
  eq('isolates the anchor', v.isolateAnchor, 'coordinates');
  eq('no tabs', v.showTabs, false);
  eq('no type picker', v.showTypePicker, false);
  eq('no delete menu', v.showTaskMenu, false);
  eq('no footer nav', v.showFooterNav, false);
  eq('context strip', v.showContextStrip, true);
}
{
  // Whitespace is not an anchor. Trimmed on the way in so the DOM query below is
  // never asked to match `[data-qs-field=" title "]`.
  const v = guidedEditorView({ guided: true, anchor: '  title  ' });
  eq('anchor is trimmed', v.isolateAnchor, 'title');
}

// ── guided with NO usable anchor: rule 1 ────────────────────────────────────
console.log('\n guided, anchor unusable ⇒ isolate NOTHING');
for (const [label, anchor] of [
  ['null anchor', null],
  ['undefined anchor', undefined],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['non-string', 42 as never],
  // A `game.*` field belongs to the Builder shell, not to this editor. Isolating
  // on it would hide every section of an editor that has nothing to keep.
  ['game.instructions', 'game.instructions'],
  ['game.title', 'game.title'],
] as const) {
  const v = guidedEditorView({ guided: true, anchor: anchor as never });
  eq(`${label} ⇒ isolateAnchor null`, v.isolateAnchor, null);
  // Still guided: the flow IS pointing at this mission, so it is still named and
  // its kind is still not up for re-decision. It simply keeps every control.
  eq(`${label} ⇒ still shows the context strip`, v.showContextStrip, true);
  eq(`${label} ⇒ still hides the type picker`, v.showTypePicker, false);
}

// A field merely CONTAINING "game." is a real editor anchor and must survive —
// the rule is a prefix, not a substring.
{
  const v = guidedEditorView({ guided: true, anchor: 'smart.minigame.mode' });
  eq('"game." mid-string is not a shell anchor', v.isolateAnchor, 'smart.minigame.mode');
}

// ── the view is never partially guided ──────────────────────────────────────
console.log('\n invariants');
for (const anchor of [null, 'title', 'game.title', '', 'smart.secretCode']) {
  const v = guidedEditorView({ guided: true, anchor });
  ok(`guided(${JSON.stringify(anchor)}) hides every competing control`,
    !v.showTabs && !v.showTypePicker && !v.showTaskMenu && !v.showFooterNav && v.showContextStrip,
    JSON.stringify(v));
}

// The returned object must not be a shared reference a caller could mutate into
// the next render's answer.
{
  const a = guidedEditorView(null);
  const b = guidedEditorView(null);
  ok('unguided views are distinct objects', a !== b);
  (a as { showTabs: boolean }).showTabs = false;
  eq('mutating one does not reach the next', guidedEditorView(null).showTabs, true);
}

// ── the location step's own subtraction ─────────────────────────────────────
console.log('\n location step');
{
  const v = guidedLocationView({ guided: true, anchor: 'coordinates', choice: 'specific' });
  eq('the pin step hides the anywhere/specific chooser', v.showModeChooser, false);
  eq('the pin step hides the advanced panel', v.showAdvanced, false);
}
// Every other combination shows everything. The `anywhere` case is the one that
// MUST: the map renders only for a located mission, so hiding the chooser there
// would leave a step asking for a point with no way to give one.
for (const [label, opts] of [
  ['an anywhere mission', { guided: true, anchor: 'coordinates', choice: 'anywhere' }],
  ['no stored choice', { guided: true, anchor: 'coordinates', choice: null }],
  ['a different anchor', { guided: true, anchor: 'locationClue', choice: 'specific' }],
  ['no anchor', { guided: true, anchor: null, choice: 'specific' }],
  ['not guided', { guided: false, anchor: 'coordinates', choice: 'specific' }],
  ['guided undefined', { anchor: 'coordinates', choice: 'specific' }],
  ['null opts', null],
  ['undefined opts', undefined],
] as const) {
  const v = guidedLocationView(opts as never);
  ok(`${label} ⇒ the whole placement step`, v.showModeChooser && v.showAdvanced, JSON.stringify(v));
}
// The two views agree about what "guided" means: whenever the location step is
// stripped, the editor around it is stripped too.
{
  const editor = guidedEditorView({ guided: true, anchor: 'coordinates' });
  const loc = guidedLocationView({ guided: true, anchor: editor.isolateAnchor, choice: 'specific' });
  ok('the location view keys off the SAME resolved anchor the editor isolates on',
    editor.isolateAnchor === 'coordinates' && !loc.showModeChooser);
}

// ── the class names the CSS also spells ─────────────────────────────────────
console.log('\n class contract');
eq('body class', GUIDED_BODY_CLASS, 'rp-guided');
eq('keep class', GUIDED_KEEP_CLASS, 'rp-guided-keep');
{
  // The hiding rule lives in index.css and names both classes by hand; a rename on
  // one side only is silent (nothing is hidden, or everything is).
  const css = readFileSync(new URL('../apps/creator-web/src/index.css', import.meta.url), 'utf8');
  const rule = `.${GUIDED_BODY_CLASS} > :not(.${GUIDED_KEEP_CLASS})`;
  ok('index.css carries the hiding rule for exactly these classes', css.includes(rule), rule);
}

console.log(failures === 0 ? '\n✅ guided editor OK\n' : `\n❌ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
