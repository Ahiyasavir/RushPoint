## Tasks

> ⚠️ **Prerequisite:** Apply `prelaunch-critical-fixes` FIRST. Group 6 (Task 6.2) references
> `t.task.hintStuck`, which is added to the play-web i18n map by `prelaunch-critical-fixes`.
> Running this change first will fail `npm run typecheck` on that key. All other groups here
> are independent of the critical change and may proceed in any order.

All tasks follow RED → GREEN → REFACTOR ordering. Groups are independent unless noted. The
final group runs the required gates. Complete each group in order; mark done before moving on.

---

### Group 1 — RED: escapeHtml pure unit test (P6/P2)

**Task 1.1** Create `scripts/test-legal-page-polish.ts` that imports from a NEW (not-yet-existing)
pure module so the test genuinely fails before the code is written:
- `import assert from 'node:assert/strict'`
- `import { escapeHtml, renderInline } from '../apps/creator-web/src/pages/legalMarkdown';`
  (this module does not exist yet — the import failure IS the RED state).
- Assertions for `escapeHtml`:
  - `escapeHtml('<script>&"test"</script>')` === `'&lt;script&gt;&amp;&quot;test&quot;&lt;/script&gt;'`
  - `escapeHtml('no special chars')` === `'no special chars'`
  - `escapeHtml('a > b && c < d')` === `'a &gt; b &amp;&amp; c &lt; d'`
- Assertions for `renderInline` (escape-then-bold ordering — the integration the spec requires):
  - `renderInline('plain & <b>')` === `'plain &amp; &lt;b&gt;'` (no bold, just escaped)
  - `renderInline('**bold**')` === `'<strong>bold</strong>'` (our own `<strong>` NOT escaped)
  - `renderInline('a **b** & <c>')` === `'a <strong>b</strong> &amp; &lt;c&gt;'`
    (proves escape runs BEFORE the bold substitution so injected `<strong>` survives)
- Print `"PASS legal-page-polish"` on success; throw on failure.

> The aggregator `scripts/run-unit-tests.mjs` auto-discovers every `scripts/test-*.ts` — no
> manual registration is needed; creating the file is sufficient.

**Task 1.2** Run `npm test` — expect **FAIL**: the module `apps/creator-web/src/pages/legalMarkdown.ts`
does not exist yet, so `tsx` cannot resolve the import. This is the intended RED state. The Group 2
code change turns it GREEN.

> Note: P2 (no fake table) gets its own source-level assertion added in Group 3 once the content
> is rewritten; keep Group 1 focused on the pure render helpers.

---

### Group 2 — GREEN: LegalPage escapeHtml + Section 7 rewrite + back button i18n (P1/P2/P6/P10)

**Task 2.1** Create the pure helper module `apps/creator-web/src/pages/legalMarkdown.ts`
(this is the module the Group 1 test imports — creating it turns RED → GREEN):
```ts
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape FIRST, then substitute **bold** → <strong>, so the injected tags survive.
export function renderInline(line: string): string {
  return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
```
This module is pure (no React/JSX import) so the `tsx` test runner can import it without
pulling in the component tree.

**Task 2.2** Edit `apps/creator-web/src/pages/LegalPage.tsx`:

a. Import the helpers: `import { renderInline } from './legalMarkdown';`

b. In `renderMarkdown`, replace the inline bold-only substitution with `renderInline(line)`
   for every `dangerouslySetInnerHTML` path (blockquotes, list items, paragraphs). The
   `__html` value must come from `renderInline`, guaranteeing escape-before-bold ordering.
   Remove any pre-existing bold-only `.replace(...)` so the escaping cannot be bypassed.

c. Rewrite Section 7 in **both** the HE and EN privacy-policy bodies to use a plain list
   format instead of the Markdown table header + dash-list mix. Example structure:
   ```
   **Data Retention Periods:**
   - User account data: 90 days after account deletion
   - Game data: deleted with account
   - Run/team data: 90 days after run finalization
   - Audit logs: 365 days
   - Payment records: 7 years (legal requirement)
   ```
   Mirror this structure in the HE body with equivalent Hebrew content.
   Remove the `| סוג נתון | תקופת שמירה |` table header line and any `| --- | --- |`
   separator rows in both bodies.

d. In the back button JSX (for the `nav(-1)` button, non-standalone mode), change the
   hardcoded `"← חזרה"` to:
   ```tsx
   {activeLang === 'he' ? '← חזרה' : '← Back'}
   ```
   Apply the same ternary to any other hardcoded navigation label that is also "← חזרה"
   regardless of language.

**Requirements:**
- `escapeHtml` and `renderInline` are exported from `legalMarkdown.ts` and imported by both
  `LegalPage.tsx` and the test — no inlined copy anywhere (single source of truth).
- `renderInline` output for a line containing `<script>` contains `&lt;script&gt;`, not a raw
  `<script>` tag; `**bold**` becomes `<strong>bold</strong>` (not double-escaped).
- After this task, `npm test` turns GREEN for `test-legal-page-polish.ts`.
- Section 7 in both HE and EN bodies must not contain `|` pipe characters.
- Back button shows `"← Back"` when `activeLang` is `'en'`.

---

### Group 3 — RED: Section 7 no-pipe test assertion (P2)

**Task 3.1** Extend `scripts/test-legal-page-polish.ts` with a source-level guard (the legal
copy lives inside the React file, so read it as text rather than importing it):
- `import { readFileSync } from 'node:fs';`
- Read `apps/creator-web/src/pages/LegalPage.tsx` as a UTF-8 string (resolve the path relative
  to the script via `new URL(...)` or `path.resolve`).
- Assert there is NO Markdown table-header row anywhere in the file's string literals:
  `assert.ok(!/\n\s*\|[^\n]*\|[^\n]*\|/.test(src), 'LegalPage must not contain a | table row')`.
  (Three or more pipes on one line is the fake-table signature this guards against.)
- This is a regression guard: it fails if anyone reintroduces a `| col | col |` table the
  custom renderer cannot handle.
- Run `npm test` — expect GREEN given the Group 2 content rewrite removed the table rows.

> Rationale: a source-text assertion is the honest pure-lane test here. Rendering the React
> tree to check for `|` would require a DOM/React test runner play-web/creator-web do not have.

---

### Group 4 — GREEN + REFACTOR: SequenceRunner val cleared only on success (P3)

**Task 4.1** Edit `apps/play-web/src/components/TaskRunner.tsx`:
- Locate the `SequenceRunner` inner component's `onClick` handler for submitting a step.
- Find the synchronous `setVal('')` call. Move it into the `then` success branch so it is
  only called when the server returns a successful result (not on rejection or wrong answer).
- Ensure the error/wrong-answer path does NOT clear the input.

**Test:** Preview-based — load a sequence task in the emulator, type a wrong answer, confirm
the input is not cleared.

---

### Group 5 — GREEN: LocationPicker keyboard navigation (P4)

**Task 5.1** Edit `apps/creator-web/src/components/LocationPicker.tsx`:

a. Add state: `const [activeIndex, setActiveIndex] = useState(-1)`.

b. Add a `useEffect` that resets `activeIndex` to -1 whenever `results` changes:
   ```ts
   useEffect(() => { setActiveIndex(-1); }, [results]);
   ```

c. Add `onKeyDown` to the search `<input>`:
   ```ts
   onKeyDown={(e) => {
     if (!results.length) return;
     if (e.key === 'ArrowDown') {
       e.preventDefault();
       setActiveIndex(i => Math.min(i + 1, results.length - 1));
     } else if (e.key === 'ArrowUp') {
       e.preventDefault();
       setActiveIndex(i => Math.max(i - 1, 0));
     } else if (e.key === 'Enter' && activeIndex >= 0) {
       e.preventDefault();
       choose(results[activeIndex]);
     } else if (e.key === 'Escape') {
       setResults([]);
       setActiveIndex(-1);
     }
   }}
   ```

d. In the results list `<li>` render, apply a highlight class conditionally:
   ```tsx
   className={`... ${index === activeIndex ? 'bg-zinc-700' : ''}`}
   ```

**Requirements:** The search input's default form-submit on Enter must be prevented when
a result is highlighted. The `choose` function's existing behavior (geocodes + closes list)
must not change.

---

### Group 6 — GREEN: aria-labels on interactive buttons (P5)

**Task 6.1** Edit `apps/play-web/src/screens/JoinScreen.tsx`:

a. Language toggle button: change the button's `aria-label` to dynamically describe
   what pressing it will do:
   ```tsx
   aria-label={lang === 'he' ? 'Switch to English' : 'עבור לעברית'}
   ```

b. Remove-member ✕ buttons: add `aria-label` that names the member:
   ```tsx
   aria-label={lang === 'he' ? `הסר ${m}` : `Remove ${m}`}
   ```
   where `m` is the member's display name/string.

**Task 6.2** Edit `apps/play-web/src/components/TaskRunner.tsx`:
- Find the hint reveal button (the one that calls `requestTaskHint`).
- Add:
  ```tsx
  aria-label={t.task.hintStuck({ cost: task.hintPenalty ?? 0 })}
  ```
  (This uses the existing i18n key from the `task` namespace added in `prelaunch-critical-fixes`.)

---

### Group 7 — GREEN: RoutePreviewMap drawRouteRef stale-closure fix (P7)

**Task 7.1** Edit `apps/creator-web/src/components/RoutePreviewMap.tsx`:

a. At the component body level (outside any effect), add:
   ```ts
   const drawRouteRef = useRef<() => void>(() => {});
   ```

b. At the component body level, assign the ref on every render:
   ```ts
   drawRouteRef.current = drawRoute;
   ```
   (This line must be at the component's top level, not inside a `useEffect`, so it runs
   on every render and keeps `drawRouteRef.current` pointing to the latest closure.)

c. In the `map.current.on('load', ...)` listener, change the body from:
   ```ts
   drawRoute();
   ```
   to:
   ```ts
   drawRouteRef.current();
   ```

d. Apply the same change to any `styledata` or `style.load` event listener that also calls
   `drawRoute()` directly.

**Requirements:** The `drawRoute` inner function's definition does not change. The only change
is how it is called from event listeners.

---

### Group 8 — GREEN: App.tsx boardCode routing fix (P8)

**Task 8.1** Edit `apps/play-web/src/App.tsx`:
- Find the conditional that renders `PublicLeaderboardScreen`: `boardCode && !session`.
- Change it to `!!boardCode` (drop the `!session` guard).
- Verify the surrounding JSX still compiles and the `onJoin={() => setBoardCode(null)}`
  prop is intact on `PublicLeaderboardScreen`.

---

### Group 9 — GREEN: JoinScreen LINK_CODE moved to component mount (P9)

**Task 9.1** Edit `apps/play-web/src/screens/JoinScreen.tsx`:
- Remove the module-level `const LINK_CODE = ...` declaration (line ~8).
- Inside the `JoinScreen` function component, add:
  ```ts
  const [linkCode] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('code')
  );
  ```
- Replace all references to `LINK_CODE` in the component body with `linkCode`.

**Requirements:** No behavior change for the normal case. The URLSearchParams is now evaluated
inside the component at mount time, not at module parse time.

---

### Group 10 — GREEN: PhotoEntry file rejection clears preview (P11)

**Task 10.1** Edit `apps/play-web/src/components/TaskRunner.tsx`:
- Locate the `PhotoEntry` inner component's file input `onChange` handler.
- Find the file rejection path (wrong type or file too large check).
- Add `setPreview(null)` and `setFile(null)` to the rejection path alongside the existing
  `e.target.value = ''` and `setFileErr(...)` calls.

---

### Group 11 — GREEN: TaskRunner ctx memoization (P12)

**Task 11.1** Edit `apps/play-web/src/components/TaskRunner.tsx`:
- Find the `ctx` object created inline (e.g. `{ ownerUid: session.ownerUid, ... }`).
- Wrap it in `useMemo`:
  ```ts
  const ctx = useMemo(
    () => ({
      ownerUid: session.ownerUid,
      gameId: session.gameId,
      runId: session.runId,
    }),
    [session.ownerUid, session.gameId, session.runId],
  );
  ```
- Ensure the routing `useEffect`'s dependency array includes `ctx` (or already did).

**Requirements:** The `useMemo` deps must be the three primitive strings, not the `session`
object reference. This prevents the effect from firing on every poll re-render.

---

### Group 12 — REFACTOR: cleanup and consistency pass

**Task 12.1** Review `LegalPage.tsx` for any remaining hardcoded navigation labels (section
headings that are navigation elements, not headings) that are language-fixed. Apply the
`activeLang` ternary pattern from Group 2 if any are found.

**Task 12.2** Check `LocationPicker.tsx` for any `aria-label` or `role` attributes needed on
the results `<ul>` or the result `<li>` items for screen reader listing context:
- Add `role="listbox"` to the results `<ul>` if not already present.
- Add `role="option"` and `aria-selected={index === activeIndex}` to each result `<li>`.
- These are optional enhancements; omit if they conflict with existing Tailwind/component structure.

**Task 12.3** Update `scripts/test-i18n-parity.ts` to add a regression assertion that
`window.location.search` is NOT accessed at module level in `JoinScreen.tsx`. This can be a
static check (grep for the pattern) rather than a runtime test.

---

### Group 13 — Gates (run last, all must be green)

**Task 13.1** Run `npm run typecheck` — must pass with 0 errors.

**Task 13.2** Run `npm run lint` — must pass with 0 errors (warnings OK).

**Task 13.3** Run `npm test` — all test scripts including `test-legal-page-polish.ts` must
pass. Confirm `"PASS legal-page-polish"` is in the output.

**Task 13.4** Run `npm run creator:build` — must produce a successful production build.
The LegalPage HTML-escaping and keyboard-nav changes must not break the bundle.

**Task 13.5** Run `npm run e2e` — all 26 e2e assertions must pass. No new callables were
added, so no e2e additions are needed for this change.

---

## Done Criteria

All of the following must be true before this change is considered complete:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0 and includes `"PASS legal-page-polish"`
- [ ] `npm run creator:build` exits 0
- [ ] `npm run e2e` exits 0 (26/26 assertions green)
- [ ] `LegalPage.tsx` back button shows English text when `activeLang === 'en'`
- [ ] `LegalPage.tsx` Section 7 in both HE and EN contains no `|` character
- [ ] `renderMarkdown` HTML-escapes raw lines before bold substitution
- [ ] `LocationPicker.tsx` results list handles ArrowDown/ArrowUp/Enter/Escape
- [ ] Language toggle, remove-member ✕, and hint buttons all have `aria-label`
- [ ] `RoutePreviewMap.tsx` uses `drawRouteRef.current()` in all event listeners
- [ ] `App.tsx` shows public leaderboard when `boardCode` is set (session-independent)
- [ ] `JoinScreen.tsx` `LINK_CODE` is inside the component (no module-level URLSearchParams)
- [ ] `PhotoEntry` clears preview + file state on file rejection
- [ ] `TaskRunner` `ctx` is wrapped in `useMemo` with three string deps
