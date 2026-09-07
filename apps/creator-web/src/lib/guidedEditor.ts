// Guided mission editor — what the editor shows WHILE הקמה מהירה is driving it
// (change: quick-setup-guided-editor).
//
// The complaint this exists for: a creator walked through Quick Setup on a
// desktop and found the flow pointing at one field inside a mission editor that
// was still offering everything else at the same time — three tabs, a nine-tile
// "how do teams complete this?" grid, sample loaders that rewrite the mission
// wholesale, a delete menu, and its own back/next footer competing with the
// flow's own Next. The step said "put the location in"; the screen said "here is
// the entire product, one of these is what we meant".
//
// So while the flow is running, the editor answers ONE question at a time:
//
//   • a context strip says WHICH mission this is and what kind of mission it is
//     (read-only — the template already decided that, and a step can never target
//     `task.type`: it is not in QUICK_SETUP_FIELDS, so nothing in the flow is ever
//     asking about it),
//   • exactly the control the current step points at stays on screen,
//   • everything else — tabs, type picker, samples, delete, footer nav — is gone
//     until the creator LEAVES Quick Setup, which is one click and is offered
//     right there in the strip.
//
// ─── Two rules that must not break ───────────────────────────────────────────
//
// 1. FAIL OPEN, ALWAYS. Isolation is a subtraction, and a subtraction that
//    mis-fires leaves a creator staring at an editor with nothing in it. Every
//    unknown here — no anchor, an anchor this mission's type does not render, a
//    field the table does not know — resolves to THE WHOLE EDITOR. Never the
//    reverse. That is why `isolateAnchor` is the only lever: the caller marks the
//    section it actually FOUND and only then hides its siblings, so "not found"
//    can only ever mean "hide nothing".
// 2. HIDING IS DISPLAY ONLY. Nothing here writes to the task. The controls still
//    mount and still hold their values — same doctrine as `foldGroupAway` in
//    lib/taskOptInGroups, and for the same reason: a creator who reads "this
//    section is not shown" must never discover later that it was also erased.
//
// Dependency-free (no React, no DOM) — scripts/test-guided-editor.ts.

/** What the mission editor renders for one Quick Setup step. */
export interface GuidedEditorView {
  /**
   * The `data-qs-field` whose section survives; every sibling section inside a
   * `[data-qs-body]` list is hidden. `null` ⇒ isolate nothing (the full editor).
   */
  isolateAnchor: string | null;
  /** The three step tabs. The flow chooses the tab, so they are noise while it runs. */
  showTabs: boolean;
  /** The "how do teams complete this?" grid and its ✨ sample loaders. */
  showTypePicker: boolean;
  /** The ⋯ menu, whose only item deletes the mission. */
  showTaskMenu: boolean;
  /** The editor's own ← back / next → / done footer. The flow's bar owns Next. */
  showFooterNav: boolean;
  /** The read-only "this is the mission, this is its kind" strip. */
  showContextStrip: boolean;
}

/** The full editor, exactly as it renders when no flow is driving it. */
const FULL_EDITOR: GuidedEditorView = {
  isolateAnchor: null,
  showTabs: true,
  showTypePicker: true,
  showTaskMenu: true,
  showFooterNav: true,
  showContextStrip: false,
};

/**
 * What the editor should render right now.
 *
 * `guided` is "Quick Setup is on screen and this mission is the one it is working
 * on"; `anchor` is the current step's resolved `data-qs-field`
 * (`quickSetupFocusPlan().anchor`), or `null` when the step targets a field this
 * Builder does not render.
 *
 * A guided step with NO usable anchor still gets the context strip and still
 * loses the type picker: the flow IS pointing at this mission, so naming it is
 * right and re-deciding what kind of mission it is stays wrong. It simply keeps
 * every control (rule 1) — the creator can find the field by hand, which is the
 * pre-existing behaviour for an unrecognised target, rather than being shown an
 * empty panel.
 */
export function guidedEditorView(opts: {
  guided?: boolean | null;
  anchor?: string | null;
} | null | undefined): GuidedEditorView {
  // A fresh object, never the shared constant: this value is read by a render and
  // by an effect's dependency list, and one caller stashing or patching it would
  // otherwise decide what the NEXT editor shows. Cheap, and it keeps rule 1 a
  // property of the function rather than of every call site's manners.
  if (!opts || opts.guided !== true) return { ...FULL_EDITOR };
  const anchor = typeof opts.anchor === 'string' && opts.anchor.trim() !== '' ? opts.anchor.trim() : null;
  return {
    // A `game.*` anchor belongs to the Builder shell, not to this editor — leaving
    // it in would hide every section of a mission editor that has nothing to
    // isolate. Same fail-open answer as an unknown field.
    isolateAnchor: anchor && !anchor.startsWith('game.') ? anchor : null,
    showTabs: false,
    showTypePicker: false,
    showTaskMenu: false,
    showFooterNav: false,
    showContextStrip: true,
  };
}

/**
 * The location step's own isolation (change: quick-setup-guided-editor).
 *
 * The location step has no `[data-qs-body]` list to subtract within — it is one
 * tall control whose root IS the `coordinates` anchor — so the DOM rule above
 * never touches it, and a step that says "mark the point on the map" was still
 * drawing the whole placement decision above the map: a two-card chooser
 * offering "anywhere" (which UNSETS the very field the step is asking for) and a
 * ⚙ panel of arrival radius, GPS-check and hidden-location settings. Those are
 * exactly the defaults this change exists to keep out of a guided step.
 *
 * Hidden only when all three hold:
 *   • the flow is driving this editor,
 *   • the step it is on is the one that asks for the pin (`coordinates`),
 *   • and the mission is ALREADY a located one.
 *
 * The third is the fail-open half and is not optional: the map only renders for
 * a located mission, so hiding the chooser for an `anywhere` mission would leave
 * a step that asks for a point and offers no way to give one. Same posture as
 * `guidedEditorView` — every other combination shows everything.
 */
export function guidedLocationView(opts: {
  guided?: boolean | null;
  anchor?: string | null;
  /** `locationChoiceOf(task)` — 'specific' means the mission has a map. */
  choice?: string | null;
} | null | undefined): { showModeChooser: boolean; showAdvanced: boolean } {
  const focused = !!opts
    && opts.guided === true
    && opts.anchor === 'coordinates'
    && opts.choice === 'specific';
  return { showModeChooser: !focused, showAdvanced: !focused };
}

/**
 * The class the caller puts on a `[data-qs-body]` list once it has MARKED a
 * survivor inside it, and the class that marks the survivor.
 *
 * Both are applied by the same effect, in that order, so the hiding rule
 * (`.rp-guided > :not(.rp-guided-keep) { display: none }`, index.css) can never
 * be live while nothing is kept. Exported as constants because the CSS names them
 * too and a typo on either side is silent.
 */
export const GUIDED_BODY_CLASS = 'rp-guided';
export const GUIDED_KEEP_CLASS = 'rp-guided-keep';
