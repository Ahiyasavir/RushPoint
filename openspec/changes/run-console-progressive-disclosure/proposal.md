## Why

The Run Console is the screen a creator stares at while real people are outside playing their game,
and it is the one screen in RushPoint with no hierarchy at all. `RunConsolePage.tsx` is 1668 lines
rendering **24 distinct panels** in a single flat vertical stack with no tabs, no sections and no
collapsibles; on a live run roughly **17 of them are mounted at once**. Counting only the chrome
(before per-team, per-photo and per-alert rows multiply it) that is about **29 action controls**
during a live run and **37 including the finished-run tools**. A 10-team run with 5 photos waiting
adds 20 more buttons (a `skip` and a `±` per team) plus 10 approve/reject buttons on top of that.

Only about **7 of the 29** matter in the first five minutes of a run: the access code + QR
(`RunConsolePage.tsx:436-438`), copy join link (`:440-442`), print station QRs (`:220`), Start all
teams (`:246`), acknowledge an alert (`:238`), broadcast an announcement (`:606-620`) and the live
team map (`:316-321`). The other ~16 are power tools a host touches rarely or never: Hot Zone
activate/deactivate with radius, multiplier and duration (`HotZonePanel`, `:639`), trackable
collectibles (`:731`), capturable territory (`:784`), flash missions (`:622-634`), per-team stage
skip (`:296-305`), manual score adjustment (`:306-313`), the ceremony / TV / staff / recap links,
and hide-photo moderation. They are all presented with the same weight as "Start all teams".

Three specific harms follow from the flatness:

- **The two most destructive controls do not look destructive.** `Finalize run` (`:249`) ends the
  run for everybody and sits in the same control bar as `Refresh standings`. Manual score
  adjustment (`:306-313`) is a bare unlabelled `±` glyph with no label, no tooltip and no
  `aria-label` — a keyboard or screen-reader user is offered a button called "±" that silently
  rewrites a team's score.
- **Seven shareable artifacts are scattered across two cards.** Access code, join link, public
  board link and ceremony link live in `JoinShare` (`:436-450`); the TV screen and recap links live
  in `PostRunLinks` (`:700-713`); the staff link lives inside `StaffInviteCard` (`:494`). Two of
  them are labelled with nothing but the emoji `🔗` (`:706`, `:710`), so "where do I get the screen
  link" has no answer a host can scan for.
- **Raw machine identifiers are shown to humans.** An alert row renders `team {id}` from a
  truncated Firestore document id (`:232`), and the photo-review queue prints the raw `taskId` as
  the task's name in both the pending card (`:951-952`) and the reviewed list (`:1001`).

There is also unexplained jargon in labels: "Flash mission (timed bonus)" with a button reading only
"Push" and a hardcoded, undisclosed `ttlSeconds: 600` (`:599`); "Announcement (persists)", which
leaks an implementation detail into a field label; and four billing chips (`freeRun` / `proRun` /
`creditRun` / `testRun`, `:205-212`) that appear beside the run status with nothing explaining them.

The screen is not badly built — it is **unprioritized**. It already contains every pattern needed to
fix itself: panels that hide themselves when empty (`PhotoReviewConsole` `:924`, `FeedConsole`
`:1037`, `ChatConsole` `:1106`, `SurveyResultsPanel` `:1624`), panels gated on run status so
post-run tools never mount mid-run (`:258-261`), an opt-in heavy load ("Load heatmap", `:1211`), and
inline help paragraphs (`hotZoneHelp` `:666`, `trackablesHelp` `:757`, `zonesHelp` `:817`,
`photoReviewHelp` `:934`). And the two primitives this change needs are already written, already
accessible, and used **nowhere outside the Builder**: `Advanced` (`components/ui.tsx:167-189` — has
`aria-expanded`, a rotating chevron, and a `meta` slot precisely so a folded section still shows a
count) and `RichTooltip` (`components/RichTooltip.tsx`).

## What Changes

**Give the console a "Right now" zone.**
- The top of the console becomes a single primary zone holding only what a host needs while the
  game is running: share/join, start teams, live alerts, broadcast, and the live team map.
- Everything else moves into clearly named, collapsed-by-default sections. Nothing is removed and
  nothing becomes harder to reach than one click on a labelled header.

**Group the rest behind the existing `Advanced` primitive.**
- Named groups (game mechanics, moderation, standings, sharing & screens, after the run) each carry
  a `meta` badge so a folded group still reports what is inside it — pending photo count, unread
  chat threads, active hot zone, unacknowledged alerts. Folding never hides state, only chrome.
- Group open/closed state persists per run so a host who opens "Moderation" keeps it open.
- A group that has nothing to show does not render at all, extending the self-hiding pattern the
  photo/feed/chat/survey panels already use rather than replacing it.

**Make destructive actions look and read destructive.**
- The bare `±` gains a real text label, an `aria-label` naming the team it affects, and a
  confirmation that states the delta and the team before it is applied.
- `Finalize run` leaves the routine control bar. It becomes a distinct, separated end-of-run action
  whose confirmation names the consequence (the run ends for every team) rather than sitting one
  mis-click away from `Refresh standings`.
- Every control the console offers is classified as routine / cautionary / destructive by one shared
  rule, so a new control cannot be added without a classification.

**One "Share & screens" surface.**
- The seven shareable artifacts are consolidated into one labelled surface: each entry has a name,
  a description of who it is for, and a copy action. No entry is labelled only with an emoji.
- Entries that are only meaningful after the run (recap) or only while live (join link) are marked
  as such instead of appearing and disappearing from two different cards.

**Human-readable labels.**
- An alert row shows the team's display name, falling back to a short id only when the name is
  genuinely unknown.
- The photo-review queue shows the task's title, falling back to the raw id only when the task
  cannot be resolved.

**Explain the jargon in place.**
- `RichTooltip` gains run-console concepts (flash mission and its lifetime, announcement
  persistence, hot zone, the four billing types) and is attached to the labels that currently
  assume the host already knows. The flash mission's 10-minute lifetime is stated in the UI instead
  of living only in `:599`.

## Capabilities

### New Capabilities
- `run-console-progressive-disclosure`: The live Run Console presents a prioritized surface — a
  primary "right now" zone containing only the controls a host needs during a run, with every other
  control reachable through named, collapsed groups that report their contents while folded;
  destructive controls are visually and semantically separated from routine ones and are never
  unlabelled; all shareable links and screens are consolidated into one named surface; teams and
  tasks are identified by their human names rather than by raw document ids; and run-console jargon
  is explained in place.

### Modified Capabilities
<!-- None. `run-analytics`, `hot-zone-bonus`, `tv-leaderboard`, `run-recap`, `run-billing`,
     `post-game-feedback` and `shared-team-devices` all surface controls inside this console; this
     change relocates and relabels those controls without altering any of their requirements. No
     existing spec's behavior contract changes. -->

## Impact

- **Surfaces touched:** `apps/creator-web` **only**. No callable is added or changed, no Firestore
  rule, no index, no `packages/shared` type, no `play-web` change, no new env var, no new dependency.
- **Files:** `src/pages/RunConsolePage.tsx` (the layout and the panels it hosts),
  `src/components/RichTooltip.tsx` (new concepts), `src/i18n.ts` (both dictionaries), plus new
  pure-logic modules under `src/lib/` for panel prioritization/grouping, destructive-action
  classification, share-artifact consolidation and label resolution. `src/components/ui.tsx` is
  **reused, not modified** — `Advanced` and `EmptyState` already do what is needed.
- **No capability is removed.** Every control reachable in the console today stays reachable; the
  change is where it sits and how it is labelled, not whether it exists.
- **Risk:** grouping logic that lives inline in JSX would drift from the badge counts shown on the
  folded headers. It is therefore extracted to pure functions so the visibility rule and the count
  rule cannot disagree — the same reason the readiness computation was extracted in
  `builder-first-task-flow`.
- **Testing:** all decisions (which group a panel belongs to, whether a group renders, what its
  badge says, whether a control is destructive, which share entries apply at a given run status,
  how a team/task label resolves) become pure functions in `apps/creator-web/src/lib/` with
  co-located vitest tests picked up by the existing `npm test` lane. `npm run test:ui` covers render
  smoke. **No emulator is needed and `npm run e2e` is deliberately not part of this change's gate
  set** — no callable behavior changes.
