## Why

A creator who signs in for the first time is handed the whole console at once: a Dashboard, a
three-pane Builder with nine task types, a scoring preset that silently decides how everyone is
ranked, a readiness panel, a live Run Console, a Gallery and a Wallet. Nothing in the product ever
*shows* them any of it.

The product owner's ask: *"When someone new opens the creator, I want to help them with a starting
guide that walks them through all the features — in the builder and elsewhere — and they can also
skip it."*

### What already exists (audited, not re-built)

| Shipped today | Where | What it does |
|---|---|---|
| First-run **checklist** | `apps/creator-web/src/lib/creatorOnboarding.ts` + `DashboardPage.tsx` (change: `creator-onboarding-and-plain-language`) | Five steps (`createGame → addTask → preview → testRun → launch`) whose done state is **derived** from the creator's real games and runs. Dismissible via `rp-onboarding-dismissed`. It tracks PROGRESS; it never explains a feature and never leaves the Dashboard. |
| Readiness panel | `lib/gameReadiness.ts` + `BuilderPage.tsx` (change: `builder-first-task-flow`) | Lists what would refuse a launch. A blocker list, not a walkthrough. |
| Task wizard | `components/TaskWizard.tsx`, `lib/wizardSections.ts` | Guides ONE task's fields. Scoped to a single editor modal. |
| Landing/marketing cards | `t.dashboard` hero cards | Static copy on the logged-out gate. |

None of these is a walkthrough. There is no coach mark, no spotlight, no step sequence across
routes, no "seen it" memory, and no way to ask for help again.

## What Changes

**A first-run guided tour of the creator console, expressed as DATA.**

- The tour is a **pure, ordered step list** in `apps/creator-web/src/lib/creatorOnboarding.ts` (the
  existing onboarding home — extended, not duplicated). Each step declares the surface it belongs
  to, its anchor selector, its card placement and whether it is payments-only. No JSX conditional
  decides what comes next.
- A **pure state machine** (`tourReducer`) owns `start / next / back / skip / restart / jump` and
  the terminal `skipped` / `completed` states. Skip is reachable from **every** step, including the
  first and the last.
- **Coverage** matches the owner's ask: welcome → create a game → your games list → Builder
  (stages, tasks, the nine task types, map & location, scoring preset & stage rules, preview,
  readiness & launch) → the live Run Console → Gallery → Wallet (payments only) → Settings →
  finish. 15 steps, 14 when payments are off.
- **Skippable and restartable.** A `?` help button in the console header and a Settings card both
  replay the tour from step one. Skipping is remembered, so it never re-fires by itself.
- **Persistence is client-side and per creator uid** — `localStorage['rp-tour-seen:<uid>']` holding
  `{version, status, lastStepId}`. **No new callable**, no profile field, no server round-trip: a
  new callable would ship RED until it has an e2e scenario, and "did this browser show a tooltip"
  is not run state.
- **A returning creator is never blocked.** The tour auto-starts only when (a) this uid has no
  stored record at all AND (b) the account does not already look established (the existing
  `rp-known-game-count` signal). An unreadable or older-version record counts as *seen* — the tour
  never re-fires on its own after a version bump; only an explicit restart replays it.
- **The overlay is additive.** It mounts once in `App.tsx` beside `DialogHost`/`ToastHost`, renders
  nothing while idle, and every anchor is a `data-tour` attribute — a step whose anchor is not on
  the current screen degrades to a centred explainer card instead of pointing at nothing.

## Non-goals

- No server state, no callable, no Firestore document, no rules change.
- The existing derived checklist is **not** removed, replaced or re-scoped. The two answer
  different questions ("what have I done?" vs "what is this?") and are independently dismissible.
- No cross-route auto-navigation. A step offers a "take me there" link when a destination is
  resolvable; it never yanks a creator out of unsaved work.
- No product tour for play-web, the staff console, or the participant app.
- No analytics/telemetry on tour progress.

## Impact

- Surfaces touched: **creator-web only** (no shared types, no callable, no play-web, no rules).
- Affected specs: `creator-guided-tour` (new).
- Affected code:
  - `apps/creator-web/src/lib/creatorOnboarding.ts` (extended — tour data + reducer + persistence)
  - `apps/creator-web/src/components/CreatorTour.tsx` (new — the spotlight overlay)
  - `apps/creator-web/src/App.tsx` (mount + header help button + `data-tour` on the nav links)
  - `apps/creator-web/src/pages/DashboardPage.tsx` (`data-tour` anchors only)
  - `apps/creator-web/src/pages/BuilderPage.tsx` (`data-tour` anchors only)
  - `apps/creator-web/src/components/StageRail.tsx` (one `data-tour` attribute on its `<aside>`)
  - `apps/creator-web/src/pages/SettingsPage.tsx` (a "replay the tour" card)
  - `apps/creator-web/src/i18n.ts` (additive `tour.*` block, HE + EN)
  - `scripts/test-creator-tour.ts` (new — auto-discovered by `scripts/run-unit-tests.mjs`)
