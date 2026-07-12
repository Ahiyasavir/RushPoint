# Design: hidden-location-leak-guard

## Problem recap

`sanitizeTaskForParticipant` (`functions/src/runs/sanitizeTask.ts`) strips `coordinates` +
`geofenceRadiusMeters` for a `hideLocation` task, but passes `title`/`description` through in
`...rest`. Those two fields are legitimately participant-facing (the player must know what the task
is), so we cannot strip them. The failure mode is *content*, not *plumbing*: a creator writes the
place name into the title. The right fix is an authoring-time warning, not a runtime strip.

## Files touched

- `packages/shared/src/locationLeak.ts` (new) — pure, dependency-free:
  ```ts
  export type LocationLeakField = 'title' | 'description';

  // Curated bilingual place-naming tokens. Not exhaustive by design — a pragmatic
  // nudge, biased to flag the obvious "Meet at the X" / "ברחוב Y" cases.
  const LOCATION_TOKENS_EN: readonly string[] = [
    'street','st.','road','rd.','avenue','ave','lane','alley','square','plaza',
    'park','garden','gate','fountain','statue','monument','tower','bridge',
    'market','mall','corner','building','floor','entrance','station','stop',
    'church','mosque','synagogue','temple','museum','near','next to','opposite',
    'behind','in front of','across from','beside','at the','by the',
  ];
  const LOCATION_TOKENS_HE: readonly string[] = [
    'רחוב','שדרות','שדרה','סמטה','כיכר','ככר','גן','פארק','שער','מזרקה','פסל',
    'אנדרטה','מגדל','גשר','שוק','קניון','פינת','פינה','בניין','קומה','כניסה',
    'תחנה','כנסייה','מסגד','בית כנסת','מוזיאון','ליד','מול','מאחורי','לפני',
    'מתחת','ליד ה','על יד',
  ];

  function fieldHasLocationToken(text: string | undefined): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    // English: word-ish boundary so 'art' does not match inside 'apartment'.
    for (const tok of LOCATION_TOKENS_EN) {
      const re = new RegExp(`(^|[^a-z])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
      if (re.test(lower)) return true;
    }
    // Hebrew: no casing / word-boundary metachar reliability → substring match.
    for (const tok of LOCATION_TOKENS_HE) {
      if (text.includes(tok)) return true;
    }
    return false;
  }

  /**
   * For a hidden-location task, returns which participant-visible text fields
   * ('title'/'description') appear to name the hidden spot and therefore defeat
   * the map-pin suppression. Returns [] when the task is not hidden or when the
   * fields carry no obvious place token. Advisory heuristic — never a gate.
   */
  export function locationLeakWarnings(
    task: Pick<Task, 'hideLocation' | 'title' | 'description'>,
  ): LocationLeakField[] {
    if (!task.hideLocation) return [];
    const out: LocationLeakField[] = [];
    if (fieldHasLocationToken(task.title)) out.push('title');
    if (fieldHasLocationToken(task.description)) out.push('description');
    return out;
  }
  ```
  Notes:
  - `locationClue` / `locationClueHe` are **exempt** — the clue is *supposed* to describe the place;
    only `title`/`description` (the always-visible, non-riddle fields) are checked.
  - Pure and side-effect free; imports only the `Task` type from `./types`.
- `packages/shared/src/index.ts` — add `export * from './locationLeak';`.
- `apps/creator-web/src/components/TaskWizard.tsx` — inside the existing `task.hideLocation` block
  (after the clue textarea, near `hideLocationNeedsClue`), compute
  `const leaks = locationLeakWarnings(task);` and, when non-empty, render a non-blocking caution:
  ```tsx
  {leaks.length > 0 && (
    <p className="text-[11px] text-rp-fire mt-1">
      {leaks.length === 2 ? b.hideLocationLeakBoth
        : leaks[0] === 'title' ? b.hideLocationLeakTitle
        : b.hideLocationLeakDesc}
    </p>
  )}
  ```
  Import `locationLeakWarnings` from `@rushpoint/shared`. No save-block, no `set()` — advisory only.
- `apps/creator-web/src/i18n.ts` — add three keys to the Builder (`b`) namespace, **HE and EN**:
  - `hideLocationLeakTitle` — the title may name the spot.
  - `hideLocationLeakDesc` — the description may name the spot.
  - `hideLocationLeakBoth` — both do.
  Each phrased to tell the creator to move the place name into the clue riddle. No dash separators
  (INSTRUCTIONS.md §C). `EN: typeof HE` parity is enforced by the type.

## Test strategy

- **Pure helper (`scripts/test-location-leak.ts`, tsx, no emulator, auto-run by `npm test`):**
  RED before `locationLeak.ts` exists. Assertions:
  - `hideLocation` falsy (absent/false) ⇒ `[]` even when the title screams a place
    ("Meet at Jaffa Gate").
  - Hidden + title with an EN token ("Meet at the Old City **fountain**") ⇒ `['title']`.
  - Hidden + description with a HE token ("המשימה **ברחוב** יפו") ⇒ `['description']`.
  - Hidden + both fields tokened ⇒ `['title','description']`.
  - Hidden + neutral title/description with no place token ("Find the secret spot" / "מצאו את
    המקום הסודי") ⇒ `[]` (low false-positive: a bare instruction is fine).
  - A place token appearing ONLY in `locationClue` does not trigger a warning (clue is exempt).
  - No-substring false-positive guard: token `art`-like fragment inside a larger word
    ("apartment") in the title does NOT match (word-boundary check).
- **UI:** no component test runner; verified via `npm run i18n:check` (dictionaries clean, both
  langs) and the creator build. Manual: toggle hide-location, type a place name in the title, see the
  caution appear; clear it, caution disappears.

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check`.
