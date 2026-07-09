## Why

The pre-launch audit identified 12 minor but visible defects spanning accessibility, UX
correctness, memory safety, and rendering accuracy. None are run-blocking on their own, but
together they create a rough product feel that undermines the "premium" positioning. Fixing
them before go-live costs far less than fielding complaints and hotfixes after launch. Three
of them (P6 dangerouslySetInnerHTML without escaping, P7 stale map route, P12 effect firing
on every render) are correctness bugs disguised as polish issues.

## What Changes

- **(P1 / P10) LegalPage back-button and back-label are language-aware.** The "← חזרה" back
  button text is replaced with `activeLang === 'he' ? '← חזרה' : '← Back'` so English users
  see English navigation.

- **(P2) LegalPage privacy-policy Section 7 table reformatted.** The fake Markdown table
  header (`| סוג נתון | תקופת שמירה |`) that the custom renderer cannot handle is replaced
  with a plain heading + consistent dash-list format, matching how the rest of the document
  is structured, in both HE and EN.

- **(P3) SequenceRunner input cleared only on success.** The synchronous `setVal('')` in the
  `onClick` handler is moved into the success branch so wrong-answer feedback no longer
  blanks the input the user typed.

- **(P4) LocationPicker geocoding dropdown supports keyboard navigation.** ArrowUp/ArrowDown
  moves a highlight, Enter selects, Escape closes. The highlighted item receives a visible
  focus ring. Keyboard-only and screen-reader users can now choose results without a mouse.

- **(P5) Missing `aria-label` attributes added.** The language toggle button in `JoinScreen`,
  the ✕ remove-member buttons, and the hint-reveal button in `TaskRunner` all receive
  descriptive `aria-label` values.

- **(P6) LegalPage `dangerouslySetInnerHTML` HTML-escaped before injection.** A minimal
  `escapeHtml` helper (escapes `&`, `<`, `>`, `"`) is applied to each raw line before the
  `**bold**` regex substitution, preventing any stray HTML characters in the policy text
  from being interpreted as markup.

- **(P7) RoutePreviewMap `drawRoute` ref-forwarded to prevent stale-closure bug.** A
  `drawRouteRef` ref is kept in sync with the current `drawRoute` function; the `load` and
  `styledata` event listeners call `drawRouteRef.current()` instead of the captured-at-mount
  value. Routes now render correctly even when `stops` are populated before the map's `load`
  event fires.

- **(P8) `?board=` public leaderboard shown even when a session exists.** The routing
  condition in `App.tsx` is changed from `boardCode && !session` to `!!boardCode` so a
  participant who finishes a run and then opens a shared leaderboard link is not silently
  redirected to the play screen.

- **(P9) `LINK_CODE` moved inside the component.** The module-level `URLSearchParams`
  evaluation in `JoinScreen.tsx` is replaced with a `useState` initializer so it runs at
  component mount time and is not frozen at module-load time.

- **(P11) PhotoEntry file rejection clears preview.** When a picked file fails validation
  (wrong type or too large), `setPreview(null)` and `setFile(null)` are called alongside the
  existing `e.target.value = ''` so no stale preview from a previously accepted file lingers
  on screen.

- **(P12) TaskRunner routing `useEffect` ctx memoized.** The `ctx` object constructed inline
  in `TaskRunner` is wrapped in `useMemo` keyed on `[session.ownerUid, session.gameId,
  session.runId]` so the routing `useEffect` does not fire on every re-render caused by
  server-state polling.

## Capabilities

### New Capabilities
- `legal-page-polish`: LegalPage back-button i18n, Section 7 table fix, and HTML-escape
  safety for `dangerouslySetInnerHTML`.
- `locationpicker-a11y`: Keyboard navigation and aria improvements for the geocoding
  dropdown and interactive creator-web buttons.

### Modified Capabilities
- `play-web-i18n-hebrew`: `App.tsx` routing logic change for `boardCode` (P8) and
  `JoinScreen` `LINK_CODE` mount-time evaluation (P9).

## Impact

- **play-web:** `apps/play-web/src/App.tsx`, `apps/play-web/src/screens/JoinScreen.tsx`,
  `apps/play-web/src/components/TaskRunner.tsx`
- **creator-web:** `apps/creator-web/src/pages/LegalPage.tsx`,
  `apps/creator-web/src/components/LocationPicker.tsx`,
  `apps/creator-web/src/components/RoutePreviewMap.tsx`
- **tests:** extend `scripts/test-legal-page-polish.ts` (new) for `escapeHtml` purity;
  extend `scripts/test-i18n-parity.ts` for P9 regression guard; UI verification via preview
  for P4 keyboard nav, P7 route rendering, P8 leaderboard routing.
- No callables changed, no Firestore schema changes, no new env vars.
