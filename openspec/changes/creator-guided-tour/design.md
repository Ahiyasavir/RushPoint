# Design — creator-guided-tour

## 1. Where this lands, file by file

| File | Change |
|---|---|
| `apps/creator-web/src/lib/creatorOnboarding.ts` | **Extended.** Adds the tour step table, the reducer, the persistence parsers, the auto-start predicate, the anchor/target resolvers and the card-position clamp. The existing checklist exports are untouched. |
| `apps/creator-web/src/components/CreatorTour.tsx` | **New.** The only React in the change: reads the step from the pure module, measures the anchor, draws the spotlight + card. |
| `apps/creator-web/src/App.tsx` | Mounts `<CreatorTour />` beside `DialogHost`; adds a header `?` button that calls `restartCreatorTour()`; adds `data-tour={'nav-' + n.id}` to the **desktop** nav links (a second copy in the mobile drawer would make the selector ambiguous; a hidden 0x0 element measures as absent, so those steps simply centre on a phone). |
| `apps/creator-web/src/pages/DashboardPage.tsx` | `data-tour="new-game"` on the primary CTA, `data-tour="game-list"` on the card grid, plus one line beside the existing `rp-known-game-count` write that remembers `rp-first-game-id` — that is what lets a Builder step offer a real destination without the tour holding a data subscription. |
| `apps/creator-web/src/pages/BuilderPage.tsx` | `data-tour="builder-canvas"` on the centre column, `data-tour="builder-tabs"` on the tab strip, `data-tour="builder-launch"` on the launch button. Nothing else. |
| `apps/creator-web/src/components/StageRail.tsx` | One attribute: `data-tour="builder-stages"` on its `<aside>`. |
| `apps/creator-web/src/pages/SettingsPage.tsx` | A `TourCard` that replays the tour. |
| `apps/creator-web/src/i18n.ts` | Additive `tour` block in HE and EN. |
| `scripts/test-creator-tour.ts` | **New** pure assertion script. |

Not touched, deliberately: `functions/**`, `packages/shared/**`, `firestore.rules`,
`apps/play-web/**`, `GalleryPage.tsx`, `RunConsolePage.tsx`, `services/calls.ts`.

## 2. Why the tour is data, not JSX

A coach-mark walkthrough written inline becomes fifteen `{step === 'x' && …}` branches spread over
five files, and the answer to "what does the creator see after the Builder step, in free mode?"
becomes a code read. Here the sequence is one array and one reducer:

```ts
TOUR_STEPS: readonly TourStep[]          // the full, ordered table
buildTourSteps({ paymentsEnabled })      // the table minus payments-only steps
tourReducer(state, action, steps)        // start | next | back | skip | restart | jump
currentTourStep(state, steps)            // null unless running
```

so ordering, filtering and every transition are unit-assertable with no DOM.

`TourStep` fields:

| Field | Meaning |
|---|---|
| `id` | Stable key; also the i18n key (`t.tour.steps[id]`) and the persisted `lastStepId`. |
| `surface` | `dashboard \| builder \| run \| gallery \| wallet \| settings \| anywhere` — which console area the step is ABOUT. Drives the "take me there" link, never a forced navigation. |
| `anchor` | `data-tour` value to spotlight, or `null` for a deliberately centred card (welcome / finish / run console). |
| `placement` | Preferred card side: `top \| bottom \| start \| end \| center`. |
| `requiresPayments` | `true` only for the wallet step; filtered out in free mode. |

## 3. The step table (the owner reviews these)

| # | id | surface | anchor | Covers |
|---|---|---|---|---|
| 1 | `welcome` | anywhere | — | What the tour is; that it can be skipped and replayed. |
| 2 | `newGame` | dashboard | `new-game` | Template picker, play mode + scoring disclosed before creation. |
| 3 | `gameList` | dashboard | `game-list` | Game cards: stages/tasks/plays, edit, rehearse, share, open a live run. |
| 4 | `builderStages` | builder | `builder-stages` | Stages are the order; the last one ends the game. |
| 5 | `builderTasks` | builder | `builder-canvas` | Adding, reordering, moving a task between stages. |
| 6 | `builderTaskTypes` | builder | `builder-canvas` | The nine interaction types and when to use which. |
| 7 | `builderLocation` | builder | `builder-canvas` | Map pin, arrival radius, and tasks with no place at all. |
| 8 | `builderScoring` | builder | `builder-tabs` | The three scoring presets and the stage rules drawer. |
| 9 | `builderPreview` | builder | `builder-tabs` | Route preview + the player's own view. |
| 10 | `builderLaunch` | builder | `builder-launch` | Readiness list, free test run, real launch + join code. |
| 11 | `runConsole` | run | — | Live board, team map, chat, photo review, announcements, alerts. |
| 12 | `gallery` | gallery | `nav-gallery` | Public games + the task library to copy from. |
| 13 | `wallet` | wallet | `nav-wallet` | Credits, per-run cost, referral bonuses. **payments only** |
| 14 | `settings` | settings | `nav-settings` | Language, sign-in methods, data export, replay this tour. |
| 15 | `finish` | anywhere | — | What to do next; where the `?` button lives. |

Steps 5–7 share one anchor on purpose: the canvas *is* where tasks, their types and their locations
are authored, and pointing at three different boxes for one workspace would be theatre.

## 4. State machine — exact rules

`TourState = { status: 'idle' | 'running' | 'skipped' | 'completed'; index: number }`

| Action | From | Result |
|---|---|---|
| `start` | `idle` | `running`, index 0 |
| `start` | anything else | unchanged (replaying is `restart`, never an implicit `start`) |
| `next` | `running`, index < last | index + 1 |
| `next` | `running`, index = last | `completed`, index stays at last |
| `back` | `running`, index > 0 | index − 1 |
| `back` | `running`, index 0 | unchanged (no wrap, no accidental exit) |
| `skip` | `running` | `skipped`, index preserved (so the record remembers where they left) |
| `skip` | not running | unchanged |
| `restart` | any | `running`, index 0 |
| `jump` | `running` | index clamped into `[0, last]` |
| any | empty step list | `completed`/`idle` at index 0, never an out-of-range read |

`currentTourStep` returns `null` for every status except `running`, so "is the overlay showing?"
has exactly one source of truth.

## 5. Persistence — client side, per uid, no callable

Key: `rp-tour-seen:<uid>` (blank uid ⇒ `rp-tour-seen:anon`).
Value: `{ version: number, status: 'skipped' | 'completed', lastStepId?: TourStepId }`.

- Written **only** on a terminal transition (`skipped` / `completed`). A tour abandoned by closing
  the tab is not "seen" and will greet the creator again — the friendlier failure.
- `readTourRecord(raw)` returns `null` for missing / malformed / non-object / unknown-status data.
  A blocked or corrupt `localStorage` therefore degrades to "never seen", and the component wraps
  every access in try/catch so first paint cannot throw.
- **A record of ANY version counts as seen.** Bumping `TOUR_VERSION` deliberately does not re-fire
  the tour for everyone who already dismissed it; that is the "never blocks a returning creator"
  requirement, and the `?` button is the answer for a creator who wants the new content.

### Why not a server field
`updateMyProfile` exists and could hold a flag, but: (a) it costs a round-trip before first paint,
(b) it makes a cosmetic tooltip into run-adjacent state, and (c) the value is genuinely per-device
useful only as a "don't nag me here" hint. The constraint from the brief is also explicit — a new
callable ships RED until it has an e2e scenario, and this needs none.

## 6. Auto-start — who gets it

`shouldAutoStartTour({ record, established })` ⇒ `record === null && !established`.

`established` is supplied by the component from the **already existing** `rp-known-game-count` key
(change: `creator-onboarding-and-plain-language`): a value ≥ 1 means this browser has seen this
account holding games, i.e. not a first-timer. `null` (never seen) is treated as NOT established,
so a genuinely new creator gets the tour on their very first paint.

Consequence, stated plainly: a creator who already has games and never saw the tour will not be
interrupted by it; they get the `?` button. That is the intended trade, and it is the same
"established account" instinct the existing checklist already encodes with `isEstablished`.

## 7. Rendering rules (the only non-pure part)

- Mounted once in `App.tsx`; returns `null` unless `status === 'running'`.
- Anchor lookup is `document.querySelector('[data-tour="<anchor>"]')`, re-measured on
  `resize` and on capture-phase `scroll`. **Anchor missing ⇒ centred card** (`resolveTourAnchoring`
  is the pure decision), so a Builder step viewed from the Dashboard still teaches, and a renamed
  DOM node degrades instead of pointing at the top-left corner.
- The spotlight is one absolutely-positioned box with a huge `box-shadow` spread (dynamic geometry
  ⇒ inline `style`, never a templated Tailwind class — the static-class rule stands).
- Card geometry is clamped by the pure `tourCardPosition({ rect, viewport, card, placement })`, so a
  step anchored at the very edge of the viewport cannot push its own card off screen.
- Keyboard: `Escape` skips, `→`/`←` advance and go back; the card takes focus on each step and is
  `role="dialog"` with an `aria-label` from the dictionary. Every control is a real `<button>` with
  a translated accessible name (the a11y scan's icon-only-button rule).
- RTL: logical utilities only (`ms-`/`me-`/`text-start`); the `start`/`end` placements are resolved
  against `document.dir` at measure time, not hardcoded to left/right.

## 8. i18n

All copy lives under `t.tour` in `apps/creator-web/src/i18n.ts`: chrome
(`next/back/skip/finish/restart/progress/helpLabel/dialogLabel/takeMeThere`), the Settings card
(`settingsTitle/settingsDesc/settingsBtn`) and `steps[id].{title,body}` for all 15 ids. HE is real
Hebrew, EN is real English; `RushPoint` is the only Latin token inside HE and it is already in the
shared `LATIN_WHITELIST`. Every JSX string in `CreatorTour.tsx` comes from `t.*`, so PART B gains
zero findings. Gate: `npx tsx scripts/check-i18n.ts --strict`.

## 9. Test strategy — pure lane, RED first

**New `scripts/test-creator-tour.ts`** (tsx assertion script, auto-discovered by
`scripts/run-unit-tests.mjs`, no emulator, no DOM):

1. **Table integrity** — ids unique, order stable, every step's `surface` is a known value, every
   `anchor` is `null` or a non-empty string, exactly one payments-only step, every step id has a
   copy entry in BOTH dictionaries (imported from `i18n.ts`), and both dictionaries agree on the
   key set.
2. **Coverage** — the Builder surface carries the stages / tasks / task types / location / scoring /
   preview / launch steps; dashboard, run, gallery, settings each appear. This is the assertion
   that fails if someone deletes a feature from the walkthrough.
3. **Filtering** — `buildTourSteps({paymentsEnabled:false})` drops the wallet step, keeps relative
   order, and is exactly one shorter.
4. **Reducer** — every row of §4, including: skip works from the FIRST and the LAST step, `back` at
   0 is a no-op, `next` at the end completes without overflowing the index, `start` from
   `skipped`/`completed` is a no-op while `restart` always replays, `jump` clamps out-of-range
   input, and an empty step list never produces an out-of-range index.
5. **Idempotence** — `tourReducer` never mutates the input state (frozen input round-trips).
6. **Persistence** — `readTourRecord(writeTourRecord(r))` round-trips; `null`, `''`, `'{'`,
   `'[]'`, `'{"status":"nope"}'`, `'{"version":"x"}'` all return `null`; a record from a FUTURE and
   from an OLDER version still counts as seen; `tourStorageKey` is uid-scoped and never collides
   between two uids or with the checklist keys.
7. **Auto-start** — fires only for `record === null && !established`; never for a stored `skipped`
   or `completed` record; never for an established account.
8. **Anchoring** — `resolveTourAnchoring(step, found)` is `centered` for a null anchor, `centered`
   when the element is absent, `anchored` only when both are true.
9. **Navigation targets** — `tourStepTarget` resolves `/`, `/build/<id>` (and `null` with no game),
   `/gallery`, `/wallet`, `/settings`, the live run path when known and `null` otherwise, and
   `null` for `anywhere`.
10. **Card position** — clamped inside the viewport for an anchor at each of the four edges, for a
    card larger than the viewport, and for a garbage rect (`NaN`) — always finite, never negative.

**UI verification**: build + `npx tsx scripts/check-i18n.ts --strict`. There is no component test
runner in creator-web, and the parent runs the full gauntlet (typecheck / lint / test / builds /
bundle budget / i18n strict) sequentially afterwards.

## 10. Risks

- **Anchor drift.** A `data-tour` attribute deleted by a later refactor silently degrades that step
  to a centred card. Accepted: the alternative (throwing, or pointing at nothing) is worse, and the
  attribute names are asserted in the test table.
- **Contended files.** `i18n.ts`, `App.tsx` and `BuilderPage.tsx` are edited by parallel lanes; all
  edits here are additive and surgical (one attribute / one mount / one appended dictionary block).
