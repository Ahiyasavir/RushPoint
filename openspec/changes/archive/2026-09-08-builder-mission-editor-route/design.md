## Context

The Builder's mission editor is `ContextPanel` → `SlidePanel`
(`apps/creator-web/src/pages/BuilderPage.tsx:2882-3007`), opened from local state
`editing: { stageId; taskId; revealAll? } | null` (line 2226). That state has **6 setters** (a
mission tile at 2415 and 2724, a readiness entry at 2479, a הקמה מהירה step at 2489, a canvas
target at 2470) and **5 clearers** (2323, 2602, 2673, 2685, 2712, 2852). Any design that only fixes
"the tile" will leave five other doors behaving differently, which is why the open mission has to
become one addressable value rather than a flag each caller sets.

Current phone presentation: `SlidePanel` renders `max-lg:fixed max-lg:bottom-0` at a definite
`h-[88dvh]`, dropping to `h-[62dvh]` when the `reserveTop` prop is true. That prop exists because
the floating הקמה מהירה bar is a separate `fixed z-50` element claiming the same corner, and the
comment at 2955-2979 records both failed attempts (painting over it hid the editor's tab row;
painting under it hid the instruction). The bottom anchoring itself is load-bearing and must
survive: it was introduced because a top-anchored sheet kept its pre-keyboard height and pushed its
footer — the primary action — underneath the keyboard.

Route table: `/build/:gameId` is a leaf route (`App.tsx:227`). No search parameters are used
anywhere on it (`?ref=` and `?start=game` are read on `/` by `AuthGate`), so `?task=` is free.

Constraints carried in from CLAUDE.md: the Builder shell is fixed-height and the page must never
grow a page scroll; a hook added to `BuilderPage` must sit **above** its early returns (line 904/912)
or React #300 follows; every pure decision belongs in a `lib/` module with a `scripts/test-*.ts`
guard; any new user-facing string goes through `t.*` in both dictionaries.

## Goals / Non-Goals

**Goals:**
- One addressable value for "which mission is open", so all 6 entry points and 5 exits behave alike.
- The platform back affordance closes the editor instead of leaving the Builder.
- A full-screen phone editor that does not negotiate height with any other overlay, deleting
  `reserveTop` rather than re-tuning it.
- Deep-link and reload restoration, degrading silently on a task id the game no longer has.

**Non-Goals:**
- No change to `TaskWizard`'s steps, fields, opt-in groups, validation gating or finish behaviour.
- No change to the desktop (`lg`+) presentation of either side pane.
- No change to the stage-settings pane's presentation (it shares `SlidePanel`; it keeps the sheet).
- Nothing in the URL except the open mission — not the Builder tab, not the active stage, not
  `revealAll`.
- No callable, Firestore path, index, rule or env var. `functions/`, `packages/shared` and
  `firestore.rules` are untouched.

## Decisions

### D1 — Search parameter on the existing route, not a nested path segment

`?task=<id>` on `/build/:gameId`.

*Alternative considered:* a nested route `/build/:gameId/task/:taskId`. Rejected: it needs an
`<Outlet/>` restructure of a 3,250-line component whose mounted state (undo history, autosave timer,
`savedSnapshot` ref, beforeunload guard) is exactly what must not be disturbed. The search parameter
gets the same history semantics with none of that risk.

*Alternative considered:* keep local state and push a bare history entry with a `popstate` listener.
Rejected: it leaves two sources of truth for the same fact, and a `popstate` listener has to
distinguish its own `history.back()` from the user's — the class of bug this change exists to remove.

### D2 — The history discipline is a pure function, not scattered `nav()` calls

The one genuinely subtle part is not accumulating or stranding history entries. Four transitions,
and each has a different correct action:

| From | To | Action | Why |
|---|---|---|---|
| closed | open | `push` | back should now close the editor |
| open A | open B | `replace` | one editor, one entry — so a single back dismisses |
| open | closed, and we pushed the entry | `back` | consume our own entry; leaves history clean |
| open | closed, and we did NOT push it (deep link / reload) | `replace` | there is no entry of ours to consume; `back` would leave the site |

That table is `missionEditorNavAction(...)` in a new pure module, exhaustively tested. Whether "we
pushed it" is a ref in `BuilderPage`, cleared whenever the derived open mission becomes null — which
covers both the deliberate close and the user's own back, without a `popstate` listener.

Files: **new** `apps/creator-web/src/lib/missionEditorRoute.ts`, holding
`MISSION_PARAM`, `readOpenMissionId(search)`, `missionEditorSearch(search, taskId | null)` (preserving
any unrelated params), `resolveOpenMission(game, taskId)` (derives the stage; returns null for an
unknown id) and `missionEditorNavAction(prev, next, weOwnEntry)`.

### D3 — `stageId` is derived; `revealAll` and the הקמה מהירה focus stay local

`resolveOpenMission` finds the stage that contains the task, so the pair cannot disagree (the spec's
fourth requirement). `revealAll` becomes local state keyed by task id — it is transient intent
("show this mission's validation now"), not a location, and putting it in the URL would make a
shared link shout at the recipient.

### D4 — `SlidePanel` gains a `variant`, so the stage-settings pane is not dragged along

`SlidePanel` is shared by `ContextPanel` and `StageSettingsPanel`. Adding
`variant?: 'sheet' | 'fullscreen'` (default `'sheet'`) lets the mission editor go full-screen below
`lg` while stage settings keep today's presentation, which the proposal puts out of scope.
Full-screen means `max-lg:inset-0` with `env(safe-area-inset-*)` padding — play-web already owns
this lesson (`.rp-safe-t`), and creator-web has no equivalent, so the inset handling is written here.

Bottom anchoring stops mattering once the panel is the whole viewport, but the reason it existed
does not: the editor stays a flex column whose **body is the only scroller** and whose footer is
pinned, so the primary action still sits above the keyboard. `interactive-widget=resizes-content`
(shipped in stage A) is what makes the viewport actually shrink under it.

### D5 — The הקמה מהירה instruction moves INSIDE the full-screen editor

This is what makes `reserveTop` deletable rather than renamed. While the editor is full-screen, the
floating bar is not rendered; the same `QuickSetupBar` renders in-flow inside the editor's header
region (a new `inline` prop — same component, same copy, no new strings). One instruction, one
place, nothing to negotiate.

*Alternative considered:* keep the bar floating and pad the editor's top by its height. Rejected:
that is `reserveTop` with a new name, and it re-creates the exact overlap the spec forbids.

### D6 — Test strategy

- **Pure (`scripts/test-mission-editor-route.ts`, auto-discovered by the unit lane):** the D2 table
  exhaustively; `readOpenMissionId` on absent / empty / whitespace / repeated params;
  `missionEditorSearch` preserving unrelated params and removing the key entirely when closing;
  `resolveOpenMission` for a real id, an unknown id, an id in another stage, a malformed game, and a
  task whose stage changed.
- **UI (no component runner — preview tools, per CLAUDE.md):** at 375px — open from a tile, back
  closes it, ✕ closes it, back after ✕ leaves the Builder, reload restores the mission, a URL with a
  deleted task id opens the plain Builder, the footer stays above the keyboard, the QS instruction
  renders inside the editor. At 1280px — the side pane is visually and behaviourally unchanged.
- **i18n:** the full-screen editor needs an accessible back control; its label goes through `t.*` in
  both dictionaries. `npm run i18n:check:strict` must stay clean (PART B: zero new findings).
- **Regression:** the nine `npm run verify` gates, plus `scripts/test-mobile-form-zoom.ts` and
  `scripts/test-quick-setup-flow.ts` from stage A.

No callable changes, so `scripts/e2e-verify.mjs` needs no new assertions.

## Risks / Trade-offs

- **`nav(-1)` when our entry is not the top of the stack** → only taken when the `weOwnEntry` ref is
  true, which is set solely by our own push and cleared the moment the open mission becomes null.
  Every other close path replaces instead. This is the whole reason D2 is a tested pure function.
- **A deep link resolving before the game has loaded** → the open mission is derived from
  `(searchParam, game)`, and `game` is null until `getGame` resolves, so it naturally yields "no
  editor" until the game is there and re-derives afterwards. No separate "waiting" state.
- **Stale-address clearing could fight the user** → clearing an unknown id uses `replace`, never
  `push`, so it cannot trap someone in a back-button loop.
- **A new hook below `BuilderPage`'s early returns → React #300** → the derivation goes beside the
  existing `readiness` `useMemo` (line 727), which carries the same warning in its own comment.
- **Removing `reserveTop` regresses the desktop QS bar** → `reserveTop` is only consulted below
  `lg`; desktop behaviour never read it.
- **Full-screen hides the Builder, so the creator loses their place** → accepted, and it is the
  point: on a 390px screen the scrimmed workspace behind the sheet was never usable. The stage and
  mission are named in the editor's own header, and back returns exactly where they were.
- **A shared `?task=` link opens someone else's game** → no new exposure: `/build/:gameId` already
  requires ownership and `getGame` enforces it. The parameter only selects within a game the caller
  can already read.

## Migration Plan

Pure front-end; no data, no schema, no deploy ordering. A URL without `?task=` behaves exactly as
today, so old links and bookmarks are unaffected. Rollback is reverting the change — nothing
persists the parameter.

## Open Questions

- Should `StageSettingsPanel` adopt `variant="fullscreen"` too? It has the same problems on a phone.
  Deliberately out of scope here; the `variant` prop is designed so it can adopt it in one line
  later.
