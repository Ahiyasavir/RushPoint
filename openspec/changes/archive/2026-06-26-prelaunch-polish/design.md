## Context

These 12 items are all self-contained changes to three files in creator-web and three in
play-web. None require new Firestore documents, callables, or shared-package changes. The
highest-risk item is P6 (HTML injection path in the legal renderer) and P7 (stale closure
in a MapLibre event listener) — both are correctness issues that look cosmetic. P12 (ctx
memoization) affects every render cycle of the TaskRunner component, which is the hottest
render path in the participant app during a live run.

Current state:
- `LegalPage.tsx`: back button label is the Hebrew literal `"← חזרה"` regardless of `activeLang`.
- `LegalPage.tsx`: Section 7 of the HE privacy policy body uses `| col | col |` on one line
  then `- list items` — the renderer renders the `|` line as a raw paragraph.
- `LegalPage.tsx` `renderMarkdown`: no HTML escaping before `dangerouslySetInnerHTML`.
- `SequenceRunner`: `setVal('')` called synchronously, before the async result.
- `LocationPicker.tsx` results list: no `onKeyDown` handler, no highlighted index state.
- `JoinScreen.tsx` language toggle, ✕ buttons, `TaskRunner.tsx` hint button: no `aria-label`.
- `RoutePreviewMap.tsx`: `map.current.on('load', drawRoute)` captures the initial render's
  `drawRoute` closure.
- `App.tsx`: `boardCode && !session` blocks leaderboard when session exists.
- `JoinScreen.tsx` line 8: `const LINK_CODE = (new URLSearchParams(...).get('code')...)` is
  module-level.
- `PhotoEntry`: file rejection path does not call `setPreview(null)` / `setFile(null)`.
- `TaskRunner.tsx` routing effect: `ctx` is a new object every render.

## Goals / Non-Goals

**Goals:**
- All 12 items corrected with no functional regressions.
- `escapeHtml` is unit-tested as pure logic.
- `validateRequiredFields` integration (from the critical change) is not duplicated here.

**Non-Goals:**
- No full Markdown-table support in `renderMarkdown` (Section 7 content is rewritten to use
  lists instead — adding a table renderer would be a larger change with no payoff for a
  single legal section).
- No ARIA audit beyond the three specific buttons listed (a full a11y audit is a separate
  task).
- No internationalization of creator-web beyond the two LegalPage strings described.

## Decisions

### D1 — LegalPage back button: inline ternary vs. i18n key
Use an inline ternary `activeLang === 'he' ? '← חזרה' : '← Back'` rather than adding a
new i18n namespace to creator-web. **Rationale:** creator-web i18n lives in a different
system than play-web's `useT()`. Adding a namespace for two strings is more ceremony than
value; the ternary is self-documenting, type-safe, and visually obvious. If creator-web
ever gets a full i18n pass, this will be the obvious migration candidate.

### D2 — HTML escaping order: escape first, then substitute bold (in a pure helper module)
`escapeHtml(line)` → bold substitution → `dangerouslySetInnerHTML`.
This ensures `<strong>` injected by our own substitution is not double-escaped.
The `escapeHtml` function must NOT escape the `<strong>` tags produced by the bold pass —
by running it first and the bold substitution second, this ordering is naturally correct.

Both pure functions are extracted into a new `apps/creator-web/src/pages/legalMarkdown.ts`
module (`escapeHtml` + `renderInline`, where `renderInline = bold(escapeHtml(line))`). This
mirrors the `withLocation.ts` extraction in `prelaunch-critical-fixes`: the helper is pure
(no React import) so the `tsx` aggregator test can import it directly and the RED→GREEN cycle
is genuine (the test fails because the module does not exist yet, not because of an inlined
copy that can never fail). `LegalPage.tsx` imports `renderInline` and uses it for every
`dangerouslySetInnerHTML` path.

### D3 — RoutePreviewMap: drawRouteRef pattern
Keep `drawRoute` as a plain inner function (for readability), but add:
```ts
const drawRouteRef = useRef<() => void>(() => {});
drawRouteRef.current = drawRoute;
```
At the top level of the component (not inside any effect). Then event listeners call
`drawRouteRef.current()`. This is the standard React pattern for stable event listener
refs without `useCallback`. **Alternative considered:** `useCallback` with the full `stops`
dep array — rejected because it would cause the listeners to be re-registered on every stop
change, which is worse than the stale-ref approach.

### D4 — LocationPicker keyboard nav: activeIndex state + ref to list items
Add `const [activeIndex, setActiveIndex] = useState(-1)` to `LocationPicker`. On
`onKeyDown` of the search input:
- `ArrowDown`: `setActiveIndex(i => Math.min(i + 1, results.length - 1))`
- `ArrowUp`: `setActiveIndex(i => Math.max(i - 1, 0))`
- `Enter`: if `activeIndex >= 0`, call `choose(results[activeIndex])` and prevent default
- `Escape`: `setResults([]); setActiveIndex(-1)`
Apply a highlight class to the `<li>` at `activeIndex`. Reset `activeIndex` to -1 whenever
`results` changes. No DOM refs to list items needed — CSS highlight via index comparison.

### D5 — P12 ctx memoization: useMemo not useCallback
`ctx` is a plain object, not a function — `useMemo` is correct:
```ts
const ctx = useMemo(
  () => ({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId }),
  [session.ownerUid, session.gameId, session.runId],
);
```
This prevents the routing `useEffect`'s dependency on `ctx` from firing on every poll
re-render (which happens every few seconds during a live run).

### D6 — P8 App.tsx boardCode routing: show board always when boardCode set
Change:
```tsx
if (boardCode && !session) {   // BEFORE
if (boardCode) {               // AFTER
```
The `PublicLeaderboardScreen` already has an `onJoin` callback that sets `setBoardCode(null)`,
which will reveal the play screen. No other change needed.

## Test Strategy

| Item | Lane | Test file |
|------|------|-----------|
| P6 — escapeHtml + renderInline pure logic | [pure] | `scripts/test-legal-page-polish.ts` — import from `legalMarkdown.ts` |
| P2 — no fake `\| col \|` table row in LegalPage source | [pure] | `scripts/test-legal-page-polish.ts` — read file, regex-assert no 3-pipe line |
| P3 — SequenceRunner val cleared only on success | [ui] | preview-based |
| P4 — keyboard nav in geocoding dropdown | [ui] | preview-based |
| P5 — aria-label present on toggle + ✕ buttons | [ui] | preview-based |
| P7 — RoutePreviewMap route drawn with initial stops | [ui] | preview-based |
| P8 — boardCode shown when session active | [ui] | preview-based |
| P9 — LINK_CODE evaluated at mount | [ui] | covered implicitly by existing join flow |
| P10 — LegalPage back button EN | [ui] | preview-based |
| P11 — PhotoEntry rejection clears preview | [ui] | preview-based |
| P12 — ctx memoized, effect not firing every render | [pure] | no test needed (TypeScript + lint) |

## Risks / Trade-offs

- **P2 content rewrite:** changing Section 7 from a table to a list is a content change, not
  just a code change. The legal content must be reviewed before deploying to production.
  → Mitigation: flagged explicitly in the tasks as requiring a legal/content review.
- **P8 boardCode always shown:** a participant who lands on `?board=<code>` will now see the
  leaderboard even if they have a session. The `onJoin` callback on `PublicLeaderboardScreen`
  lets them navigate back to their play session. This is a deliberate UX trade-off: link
  sharing behavior takes priority over session continuity.
- **P12 useMemo:** `session` is passed as a prop; changing the deps to the three string
  fields means if a new field is added to `Session` and used in `ctx`, it won't automatically
  invalidate. → Mitigation: the `ctx` shape is narrow (ownerUid, gameId, runId) and
  documented; the fix is more correct than the current behavior regardless.

## Migration Plan

All changes are pure client-side. Deploy play-web and creator-web together in the same
release batch as `prelaunch-critical-fixes`. No server-side changes. Rollback by reverting
the Vite app deploys.

## Open Questions

- P2 Section 7 rewrite: the legal content changes (both HE and EN) should be reviewed by
  the product owner / legal contact before the production deploy.
