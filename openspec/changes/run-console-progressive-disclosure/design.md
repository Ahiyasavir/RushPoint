## Context

`apps/creator-web/src/pages/RunConsolePage.tsx` is 1668 lines and holds 24 panels, 18 of which are
local components declared in the same file (`JoinShare:419`, `StaffInviteCard:470`,
`StationQrPrint:508`, `Broadcast:578`, `HotZonePanel:639`, `PostRunLinks:690`,
`TrackablesConsole:731`, `ZonesConsole:784`, `PhotoReviewConsole:855`, `FeedConsole:1021`,
`ChatConsole:1076`, `HeatmapPanel:1191`, `RunSummaryPanel:1232`, `AnalyticsPanel:1312`,
`FeedbackPanel:1424`, `SurveyResultsPanel:1607`, plus the inline teams / live-standings /
final-standings blocks). The page body renders them as a flat sequence: a header, a control bar
(`:245-250`), a two-column `HotZonePanel` / `PostRunLinks` row (`:254-256`), four status-gated
post-run panels (`:258-261`), then a three-column grid whose left column stacks teams, the map,
trackables, territory, photo review, feed, chat and both standings tables (`:265-405`), and whose
right column holds `Broadcast` (`:409`).

The layout decisions are currently expressed as JSX conditions scattered through that body:
`{!finished && …}` at `:255`, `:316`, `:324`, `:327`, `:340`, `:343`; `{finished && …}` at
`:258-261`, `:377`; `if (… === 0) return null` inside `PhotoReviewConsole:924`, `FeedConsole:1037`,
`ChatConsole:1106`, `SurveyResultsPanel:1624`. Nothing names those conditions, so there is no single
place to ask "what is on screen right now?" — which is exactly the question a grouped, badge-bearing
disclosure UI must be able to answer.

Two primitives already exist and are unused outside the Builder:

- `Advanced` (`src/components/ui.tsx:167-189`) — collapsible with `aria-expanded`, a chevron that
  rotates 90° on open, a `dense` variant, and a `meta` slot documented (`ui.tsx:160-166`) as being
  for an at-rest summary so folding never hides the fact that a section is configured. Used only at
  `TaskWizard.tsx:142`, `BuilderPage.tsx:499/513/532/647`.
- `RichTooltip` (`src/components/RichTooltip.tsx`) — portalled, viewport-clamped tooltip card with a
  `TooltipConcept` union (`:15`) currently limited to `'geofence' | 'hint' | 'concurrent' |
  'difficulty'`, whose title/body come from `t.builder.*` (`:77-81`). Used only in `TaskWizard.tsx`.

`apps/creator-web` has a vitest config (`vitest.config.ts`, `include: ['src/**/*.test.ts']`,
`environment: 'node'`) already wired into the repo-wide `npm test` via `turbo run test`. The
existing precedent is `src/components/__tests__/BuilderRedesign.test.ts`, which proves Builder
behavior entirely at the pure-logic layer (`lib/taskCardPreview`, `lib/quizFields`,
`lib/taskTemplates`, `lib/taskDraft`) without rendering React. This change follows the same shape.

## Goals / Non-Goals

**Goals:**

- A host opening a live run sees a short, calm screen whose visible controls are the ones the next
  five minutes need, and can reach everything else in one labelled click.
- Folding a group never hides state. A collapsed group reports its contents on its header.
- Destructive actions are unmistakable, named for assistive technology, and confirmed with specifics.
- The seven shareable artifacts answer "where do I get the link for X" from one place.
- Teams and tasks read as names, not as Firestore ids.
- Every layout, grouping, badge, classification and label decision is a pure function with a test,
  so the visible chrome and the summary badge cannot drift apart.

**Non-Goals:**

- **No backend work.** No callable is added, changed or removed; no Firestore rule, index or
  security change; no `packages/shared` type change; no new env var.
- **No capability removal.** Every control reachable in the console today remains reachable. This is
  progressive disclosure, not deletion. Hot Zone, trackables, territory, flash missions, per-team
  skip, manual adjustment, ceremony/TV/staff/recap links and photo hiding all survive verbatim.
- **No new dependency** and **no new UI primitive**. `Advanced`, `RichTooltip`, `Card`, `Button`,
  `Badge` and `EmptyState` from `components/ui.tsx` are reused as-is; `ui.tsx` itself is not edited.
- **No visual redesign** beyond that reuse and the existing Tailwind tokens (`--rp-border`,
  `--surface-*`, `--ink-*`, the `neon-*` scale). No new colour, spacing or typography system.
- **No `play-web` change**, and no change to what participants or staff see.
- **No file split of `RunConsolePage.tsx`.** Decomposing that god-file is tracked separately by
  `frontend-component-decomposition`; doing both at once would make either impossible to review.

**Design principle: calm by default, complete on demand.**

## Decisions

### D1 — The layout is data, not JSX

A new pure module `src/lib/runConsoleLayout.ts` owns the console's panel catalogue and the rule that
turns a run's state into a render plan.

```
type PanelId = 'joinShare' | 'stationQr' | 'startTeams' | 'alerts' | 'broadcast' | 'liveMap'
             | 'teams' | 'hotZone' | 'flashMission' | 'trackables' | 'zones'
             | 'photoReview' | 'feed' | 'chat'
             | 'liveStandings' | 'finalStandings'
             | 'shareScreens' | 'runSummary' | 'analytics' | 'heatmap' | 'feedback' | 'survey'
             | 'staffInvite';

type GroupId = 'primary' | 'teamsAndScores' | 'gameMechanics' | 'moderation'
             | 'shareAndScreens' | 'afterTheRun';

type RunConsoleState = {
  status: 'draft' | 'live' | 'finished';
  teamCount: number;
  alertCount: number;
  pendingPhotoCount: number;
  feedItemCount: number;
  unreadChatThreads: number;
  hotZoneActive: boolean;
  hasLeaderboard: boolean;
  surveyResultCount: number | null;   // null = not loaded yet
};

buildRunConsolePlan(state): { groups: { id: GroupId; panels: PanelId[]; summary: GroupSummary }[] }
```

`buildRunConsolePlan` decides membership, visibility and the summary in one pass, so the badge on a
folded header is computed from the same value that would populate the expanded panel.

*Alternative considered:* keep the conditions in JSX and pass counts to `meta` at each call site.
Rejected — that is precisely the drift the audit found in the Builder's `wizardSections.ts` badge
(a configured value that the folded badge could never report). One source, one test.

### D2 — Group taxonomy

| Group | Panels | Rationale |
|---|---|---|
| `primary` | joinShare, stationQr, startTeams, alerts, broadcast, liveMap | The ~7 first-five-minutes controls named in the proposal. Never collapsible. |
| `teamsAndScores` | teams, liveStandings, finalStandings | Per-team rows and rankings; expanded by default because a host scans it constantly. |
| `gameMechanics` | hotZone, flashMission, trackables, zones | Optional game systems. Collapsed. Summary reports how many are active. |
| `moderation` | photoReview, feed, chat | Human-in-the-loop queues. Collapsed. Summary reports pending photos + unread threads. |
| `shareAndScreens` | shareScreens, staffInvite | The consolidated link surface (D4). Collapsed. |
| `afterTheRun` | runSummary, analytics, heatmap, feedback, survey | Status-gated to `finished` (survey already self-hides). Collapsed. |

`primary` is not an `Advanced` — it is the always-open top of the page. Every other group renders as
`<Advanced dense={false} title={…} meta={…} open={…} onToggle={…}>`.

### D3 — Destructive-action classification

`src/lib/runConsoleActions.ts` exports

```
type ActionSeverity = 'routine' | 'cautionary' | 'destructive';
classifyRunAction(id: RunActionId): ActionSeverity
```

with a total, exhaustively-typed map. `finalizeRun` and `adjustTeamScore` are `destructive`;
`skipStage`, `deactivateAnnouncement` and `hideFeedPhoto` are `cautionary`; the rest routine. The
map being keyed by a closed union means adding a control without classifying it is a **typecheck
failure**, not a review miss — the same "fail loud" pattern the e2e sanitizer allowlist uses for new
`Task` fields.

The `±` glyph at `:306-313` becomes a labelled button (`t.runConsole.adjustScore`) with
`aria-label={t.runConsole.adjustScoreAria({ team })}`. Its `dialog.prompt` result is routed through a
pure `parseScoreDelta(raw)` helper that returns `{ ok: false }` for non-numeric / zero input, so the
current `parseInt(v) || 0` path (which silently submits a 0-delta adjustment for garbage input)
stops writing an audit-log entry for nothing. Confirmation copy names the team and the signed delta.

`Finalize run` moves out of the `:245-250` bar into its own separated end-of-run row with the
`danger` variant retained and a confirmation naming the consequence.

*Alternative considered:* a generic `<DestructiveButton>` wrapper component. Rejected as a new
primitive; the Non-Goals forbid it and `Button variant="danger"` plus the classifier is enough.

### D4 — One share surface

`src/lib/runShareArtifacts.ts` exports

```
type ShareArtifactId = 'accessCode' | 'joinLink' | 'boardLink' | 'ceremonyLink'
                     | 'tvScreen' | 'recap' | 'staffLink';

buildShareArtifacts(input: { accessCode: string; status; hasStaffPin: boolean }):
  { id: ShareArtifactId; url: string | null; available: boolean; requiresPublish: boolean }[]
```

URL construction moves here verbatim from `JoinShare` (`:419-468`) and `PostRunLinks` (`:690-713`)
so both formulas live in one tested place. Names and descriptions come from `t.runConsole.share.*`.
The `🔗`-only buttons at `:706` and `:710` are replaced by named copy actions. Entries that are not
yet meaningful (recap while live) render as unavailable with a reason rather than vanishing.

### D5 — Label resolution

`src/lib/runConsoleLabels.ts` exports `resolveTeamLabel(teamId, teams, fallbackFmt)` and
`resolveTaskLabel(taskId, tasksById, fallbackFmt)`. The alert row (`:232`) and the photo-review rows
(`:951-952`, `:1001`) call them. Fallback keeps today's 8-character truncation but routes it through
a translated "unknown item" format so it is never mistaken for a name. The photo queue already loads
the run's game to render, so a task-id → title map is available without any new read; if the task
cannot be resolved the fallback applies.

### D6 — Tooltip concepts

`RichTooltip`'s `TooltipConcept` union (`RichTooltip.tsx:15`) is extended with
`'flashMission' | 'announcementPersistence' | 'hotZone' | 'runBilling'`, and its `TEXT` map (`:77`)
gains a second source: run-console concepts read from `t.runConsole.tip*` while Builder concepts keep
reading `t.builder.tip*`. No SVG is required for the new concepts (`svg` is already optional in the
`DirectTooltip` shape and the component renders without one). The flash mission's 600-second
lifetime, currently only visible at `:599`, is stated in the tooltip body and derived from a single
exported constant so the copy cannot drift from the call.

### D7 — Group open/closed persistence

Open state is held in component state seeded from `localStorage` under a per-run key. The
serialize/parse/merge step is a pure function `readGroupState(raw, defaults)` /
`writeGroupState(state)` in `runConsoleLayout.ts` so malformed or stale stored data (an unknown
group id, a truncated JSON blob) is proven to degrade to defaults rather than throw. No server
state is involved — this is a display preference, and run docs are server-write-only.

## TEST STRATEGY

`apps/creator-web` has **no component test runner**, so this change is designed so that everything
worth proving is pure. Every decision above is a function in `apps/creator-web/src/lib/` with a
co-located `*.test.ts` picked up by `apps/creator-web/vitest.config.ts`
(`include: ['src/**/*.test.ts']`) and therefore by the repo-wide `npm test`
(`node scripts/run-unit-tests.mjs && turbo run test`). **No emulator is needed.**

**Lane 1 — pure logic (vitest, `apps/creator-web/src/lib/__tests__/runConsole.test.ts`), written RED
first:**

- `buildRunConsolePlan`
  - totality: every `PanelId` appears in exactly one group across the union of all three statuses
  - primary zone contains exactly the seven first-five-minutes panels and never a power-user panel
  - `status: 'live'` omits `runSummary`/`analytics`/`heatmap`/`feedback`; `status: 'finished'` omits
    `hotZone`/`flashMission`/`trackables`/`zones`/`chat`
  - a group whose panels are all empty is absent from the plan
  - `moderation` summary reports `pendingPhotoCount` and `unreadChatThreads` from the same input the
    expanded panels consume
  - `gameMechanics` summary reports an active hot zone while folded
- `readGroupState` / `writeGroupState`: round-trip; unknown group id ignored; malformed JSON returns
  defaults without throwing
- `classifyRunAction`: totality over the `RunActionId` union; `finalizeRun` and `adjustTeamScore`
  are `destructive`
- `parseScoreDelta`: `'5'`→+5, `'-3'`→−3, `''`/`'abc'`/`'0'`→ rejected
- `buildShareArtifacts`: exactly one entry per `ShareArtifactId`; live run marks `recap` unavailable;
  finished run marks `recap` available; `staffLink` only when a PIN exists; URLs match the strings
  produced by today's `JoinShare`/`PostRunLinks` code (pinned by literal assertions, so the
  consolidation cannot silently change a link a host has already shared)
- `resolveTeamLabel` / `resolveTaskLabel`: known id → name; unknown id → marked fallback; empty
  collection does not throw

**Lane 2 — i18n (hard gate).** Every new label, description, tooltip body, `aria-label` and
confirmation string is added to **both** `he` and `en` in `apps/creator-web/src/i18n.ts` and read via
`t.runConsole.*`. `npm run i18n:check` PART A (parity + language purity) must be clean;
`npm run i18n:check:strict` must add **zero** new PART B hardcoded-string findings. Copy must obey
INSTRUCTIONS.md §3.C (no `—`, `–` or ` - ` as a separator) — `scripts/test-no-dashes.ts` enforces it
inside `npm test`.

**Lane 3 — render smoke.** `npm run test:ui` (Playwright, `e2e-ui/`) confirms the console still
mounts without a white-screen crash and that the primary-zone controls are present.

**Lane 4 — manual preview.** Open a seeded live run: confirm the primary zone is the seven controls;
expand each group and confirm every previously-reachable control is still reachable; collapse
`moderation` with pending photos and confirm the header badge reports them; confirm the `±` reads as
a labelled button and its confirmation names the team; confirm all seven share entries appear once
with names.

**Explicitly out of the gate set: `npm run e2e`.** This change alters no callable, no payload, no
rule and no shared type, so the emulator lifecycle suite has nothing new to assert — and the
emulator is owned by another process. The gate set for this change is: `npm run typecheck`,
`npm run lint`, `npm test`, `npm run creator:build`, `npm run play:build`, `npm run i18n:check`,
`npm run i18n:check:strict`.

## Risks / Trade-offs

- **[A host cannot find a control they used to see at a glance]** → Nothing moves more than one
  labelled click away, group names are nouns a host already uses ("moderation", "share & screens"),
  folded groups carry live badges, and open state persists per run. The panels a host uses most
  (`primary`, `teamsAndScores`) are never collapsed by default.
- **[Badge counts drift from panel contents]** → Both come from the single `buildRunConsolePlan`
  pass over one `RunConsoleState`; the drift case is a named test.
- **[A future control is added without a severity]** → `classifyRunAction` is keyed by a closed
  union, so an unclassified control fails `npm run typecheck`.
- **[Consolidating share URLs silently changes an already-shared link]** → `buildShareArtifacts`
  tests pin the produced URLs as literals against the current `JoinShare`/`PostRunLinks` formulas.
- **[New copy leaks English into the Hebrew console]** → this is the recurring Run Console bug
  (INSTRUCTIONS.md §3.D). Every string goes through `t.*` in both dictionaries and
  `npm run i18n:check` PART A is a hard gate on the final task.
- **[Touching a 1668-line file conflicts with `frontend-component-decomposition`]** → this change
  deliberately does not split the file; it adds `lib/` modules and rewrites only the page body's
  layout section, which is the smallest possible footprint. If the decomposition lands first, the
  `lib/` modules are unaffected.
- **[`localStorage` unavailable or full]** → `readGroupState`/`writeGroupState` are pure over a
  string and the call site tolerates a throw, degrading to default collapsed state.

## Migration Plan

None required. This is a client-side presentation change with no persisted schema, no callable and
no rule change. Rollback is a revert of the creator-web commit; no data written by this change needs
cleanup beyond a per-run `localStorage` preference key, which is inert if left behind.

## Open Questions

- Should `teamsAndScores` default to expanded for a small run (< 4 teams) and collapsed for a large
  one? Defaulting to expanded for all sizes is the safe first cut; revisit if the teams list becomes
  the dominant scroll cost at 20+ teams.
- Whether the hot zone, once active, should be promoted into the primary zone for the duration of
  its window. Deferred: the folded `gameMechanics` badge already reports it, and promotion would
  make the primary zone's contents non-constant, which the spec currently forbids.
