## Context (verified 2026-09-28)

- `runConsoleLayout.ts`: `PanelId` (26), `PANEL_GROUP` → `primary | teamsAndScores | moderation |
  gameMechanics | shareAndScreens | afterTheRun`; `buildRunConsolePlan`, section badges,
  `DEFAULT_SECTION`. `ConsoleTabs.tsx` renders the sections (sticky on desktop, bottom bar on phone).
- Pure verdicts already exist for the inbox's parts: `teamAttention.ts` (stuck/watch),
  `photoReviewQueue.ts` + `reviewQueueCue.ts` (pending, wait), `runConsoleSignals.ts`
  (`buildRunSignals`, a ranked "what needs you" strip), chat unread counters, alert list.
- `RunConsolePage.tsx` is 3,950 lines, every panel inline.

## Decisions

### D1: sections are verbs, three of them

`SectionId = 'now' | 'teams' | 'game'`; `DEFAULT_SECTION = 'now'`, except a run with no team yet
opens on `teams` with the join card inline in its empty state (the first thing a host needs).

### D2: every panel has a home

| Panel | Home |
|---|---|
| alerts, photoReview (pending), chat (unread), staffChannel (unread), startTeams (waiting teams), feed (reported items) | **Now** (as inbox items) |
| teams, liveMap, liveStandings, finalStandings | **Teams** |
| broadcast, flashMission, hotZone, zones, trackables, taskAvailability, feed (browse), mediaGallery, chat (full threads), staffChannel (full) | **Game** (chat/staff channel threads open from the inbox row too) |
| joinShare, stationQr, shareScreens, staffInvite | ⋯ → שיתוף והגדרות (sheet) |
| runSummary, analytics, heatmap, feedback, survey | ⋯ → דוחות (run report page) |

A test asserts the table covers `ALL_PANEL_IDS` exactly once, so a new panel cannot float.

### D3: the inbox is a pure function

`buildInbox(state, nowMs)` → `InboxItem[]` `{ kind, key, teamId?, title, ageMs, severity:
'urgent' | 'normal', action }`, sorted urgent first then oldest first; kinds: `sos`, `outOfBounds`,
`review`, `staffMessage`, `teamMessage`, `stuckTeam`, `waitingToStart`, `reportedPost`. It reuses
the existing verdicts (it does not re-derive them). Total; clock injected.

### D4: team actions live on the team

The team row keeps ONE inline action (the most relevant by state: start / let in / skip) and opens
the team page on click. The team page gets the complete action set, grouped: **Play** (start, pause,
send to mission, send back, skip, let in), **Score** (points), **Contact** (message, call),
**Danger** (remove). The row's ⋯ overflow is removed.

### D5: split the page while moving it

Each screen and the header become files under `components/console/`; `RunConsolePage.tsx` keeps
data subscriptions and passes props. No behaviour change inside panels.

### D6: staged delivery behind one switch

`?console=next` renders the new shell until parity is verified in preview, then it becomes the
default and the old shell is deleted in the same change (no long-lived flag).

## Test strategy

- **Pure** (`apps/creator-web/src/lib/__tests__/runConsoleSimplify.test.ts`): D2 coverage (every
  PanelId exactly once); `buildInbox` ordering, kinds, empty state, bad data total; default section
  rule; team row inline action by state.
- **UI** preview at 1400×860 and 390×844 on a seeded run with teams, a pending photo, an SOS, an
  unread message: the inbox lists them with ages and each action works; team page actions; game
  screen panels; ⋯ sheets; nothing from the old console is unreachable (walk the D2 table).
  `npm run i18n:check:strict`; `scripts/test-creator-tap-targets.ts` stays green.
