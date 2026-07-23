## Context

The audit behind this change swept every field on `Game`, `Stage`, `Task`, `PublicGame`,
`PublicTask`, `Run`, `RunTeam` and the settings objects in `packages/shared/src/types/index.ts`
against every read in the two apps. Four classes came out of it, and only the first is a bug:

- **UNCREATABLE** — rendered downstream, no UI to author it: `scoringOptions` (patched but never
  saved), `approxLocation`, `coverImage`, `branding.name`/`branding.primaryColor`, plus
  `smart.attemptLimit`, `Task.status` (paused/closed), `Task.expectedDurationMinutes`,
  `requiresGuardianConsent`/`minAge`, `safeZone`, `benchmarkOptOut`.
- **INTENTIONALLY INTERNAL** — correct as they are, and flagging them would be the real error:
  `answers`, `numericAnswer`, `steps[].answer`, the authored order of `orderItems`, `hint` text,
  `smart.secretCode`, `smart.adminNotes`, `Task.coordinates` under `hideLocation`,
  `team.answerPenalties`, `team.discoveryState`, `run.staffPin` (organizer-only). Each was checked
  against `functions/src/runs/sanitizeTask.ts` before classifying.
- **DEAD** — no reader and no writer: `ScoringOptions.transitPenaltyEnabled` /
  `sprintPenaltyEnabled`, `Task.maxDurationMinutes`, `RunTeam.smartStreak` / `streakMultiplier`,
  `SmartStationConfig.canSkip` / `allowRetry` / `photoReviewRequired` / `autoCompleteOnSuccess` /
  the four `show*Screen` flags, `FlashMission.winnerTeamId`, `AdminAlert.stationTitle`,
  `StationSubmission.rejectionReason`, `GameBranding.logoUrl`.
- **CORRECTLY SURFACED** — do not re-flag: `tags`, `instructions`, `requirement`, `likeCount`,
  `popularity`, `copyCount`, `hotZone`, `powerUps`, `outOfBounds`, `narrative`, `requiredTaskCount`,
  `exclusiveGroups`, `unlockAfterTaskIds`, `expiresAfterMinutes`, `releaseAfterMinutes`,
  `surveyChoices`, `hideLocation`, `locationClue`, `hintPenalty`, `requirePresence`, `captureKind`,
  `isTestDrive`, `deviceJoinCode`, `PublicTask.approxLocation`.

This change fixes the four highest-impact UNCREATABLE items — the ones a creator authors on purpose
and would notice missing. The rest are reported, not built, on purpose: an attempt-limit field or a
station pause control is a feature decision, not a leak plugged.

Three constraints shape the design:

- **`publicGames` is world-readable.** Any location this change writes there must obey the same
  contract `packages/shared/src/publicTaskLocation.ts` already establishes for `publicTasks`: a
  deterministic ~1 km grid snap (never jitter — jitter averages out over repeated publishes), and
  nothing at all for a task whose location is the puzzle.
- **The live playtest stack is serving from this tree.** Everything here is verified pure-logic and
  static; no emulator, no e2e, no restart.
- **The Builder autosaves off a serialized payload.** `serializeGame = JSON.stringify(buildSavePayload(g))`
  is both the dirty check and the wire format, so a field missing from the payload is invisible
  twice: it never marks the game dirty and it never gets sent. Fixing the literal fixes both.

## Goals / Non-Goals

**Goals**
- The wrong-answer-cost selector persists what it displays.
- A published game with locatable tasks appears on the gallery map with no creator action.
- Cover image, brand name and accent colour are authorable in the Builder.
- The save payload's completeness becomes a test-enforced property, not a convention.

**Non-Goals**
- Clearing an already-published area when every task later becomes hidden. `updateGame` skips
  `undefined`, and introducing a null-clearing sentinel is a server contract change this does not
  need. The derived area is recomputed on every publish and every public edit, so it tracks moves;
  only a full hide-everything transition can leave a stale ~1 km cell, and unpublishing removes it.
- Authoring `safeZone`, guardian consent, `benchmarkOptOut`, per-task `attemptLimit`, station
  pause/close, or `expectedDurationMinutes`. All are reported in the audit; each is its own change.
- Deleting the DEAD fields. Reported for a cleanup change, not removed here.
- `branding.logoUrl` — nothing renders it, so an input for it would create the very bug this change
  is about.

## Decisions

### The save payload becomes a pure module with a declared field list

`buildSavePayload` moves to `apps/creator-web/src/lib/savePayload.ts`, importing nothing from React,
so a `tsx` assertion script can exercise it. Alongside it lives `BUILDER_EDITABLE_FIELDS` — the
explicit list of `Game` keys the Builder is allowed to mutate. The test drives a fully-populated
fixture through `buildSavePayload` and asserts every listed key arrives with its value intact.

The alternative — deriving the payload with a spread of the whole `Game` — was rejected: it would
post server-owned fields (`id`, `ownerUid`, `playCount`, `visibility`, `deletedAt`, `createdAt`) on
every autosave, and `updateGame` would have to grow a rejection list to stay safe. An explicit
allow-list is the safer half of the trade; the test supplies the completeness the literal lacked.

### The public game area is derived server-side, not client-side

`deriveGameArea(stages)` lives in `functions/src/games/gameArea.ts` and runs where the public
document is written — `publishGame` and the `visibility === 'public'` resync in `updateGame`. Two
reasons over a Builder-side computation:

- A client-derived area only exists for games whose creator opened the Builder after this ships.
  Server derivation covers every publish, including a re-publish of an old game.
- Staleness cannot accumulate: the value is recomputed from the tasks being published in the same
  write, so it can never describe a layout that no longer exists.

It reuses `publicTaskLocation` per task rather than reading `task.coordinates` directly, so the
`hideLocation` / `locationless` / null-island exclusions are enforced by the same audited predicate
the task library uses — two parallel conditions are exactly how a location contract drifts. Inputs
are already-coarsened cell centres; their mean is snapped again through `approximatePublicPoint`, so
the published game area is a grid cell like every other public point and averaging cannot sharpen it
beyond one cell. An authored `approxLocation` always wins — derivation only fills an absence.

### Presentation inputs are normalized by pure helpers before they leave the client

`apps/creator-web/src/lib/gamePresentation.ts`:
- `normalizeHttpsUrl(raw)` — trim, require `https:`, return `undefined` for empty/invalid, so a
  half-typed URL is never persisted as a broken hero image. Mirrors the https-only rule
  `InstructionsField` already applies to `instructions.imageUrl`.
- `normalizeBrandColor(raw)` — accept `#rgb` / `#rrggbb` (case-insensitive), expand shorthand,
  lowercase, reject anything else. The accent is interpolated into `style` on five participant
  screens; constraining it to a hex literal at the point of authorship keeps it a colour.
- `hasBrandingValue(branding)` — so an emptied brand section patches `undefined` rather than
  `{ name: '', primaryColor: '' }`, which would make `game.branding?.name ?? game.title` resolve to
  an empty title.

### Copy

Every new string is added to both dictionaries in `apps/creator-web/src/i18n.ts` under `builder`,
Hebrew genuinely Hebrew and English genuinely English. The URL/colour inputs carry `dir="ltr"`; the
brand name is user-authored content and carries `dir="auto"`. Static Tailwind class strings only.
Both `npm run i18n:check` and `npm run i18n:check:strict` must be clean — the strict lane means no
new PART B hardcoded-string findings.

## Risks / Trade-offs

- **A derived area names a ~1 km cell for a game that never chose to.** Accepted and bounded: it is
  the same cell size, from the same predicate, that the creator's tasks already publish individually
  into the world-readable task library — the game pin discloses strictly less than the task pins
  already do, and a game whose every task hides its location derives nothing.
- **Adding fields to the payload changes the autosave dirty-check.** Games whose stored
  `scoringOptions` / `coverImage` / `branding` / `approxLocation` differ from what the Builder loaded
  will now be seen as dirty and saved once. Values are written back identically (`getGame` → state →
  payload), so the first save is a no-op write, not a mutation.
- **Colour normalization rejects named CSS colours.** Deliberate; an imported game file carrying one
  is untouched, because normalization runs only on what the input authors.

## Test Strategy

Pure lanes only — no emulator, no e2e, nothing that touches the running playtest stack.

**`scripts/test-game-presentation.ts`** (tsx aggregator lane, `npm test`):
- `buildSavePayload` — for a fixture populating every `BUILDER_EDITABLE_FIELDS` key, each key is
  present in the payload and deep-equals the fixture's value; `gameId` is set from `game.id`;
  server-owned keys (`id`, `ownerUid`, `visibility`, `playCount`, `createdAt`, `updatedAt`,
  `deletedAt`) are absent.
- The regression itself: a game whose only difference is `scoringOptions.wrongAnswerPenalty`
  serializes differently from the same game without it — the dirty check the autosave depends on.
- `normalizeHttpsUrl` — https URL passes; surrounding whitespace trimmed; `http:` rejected;
  `javascript:` rejected; empty/whitespace/undefined → `undefined`; garbage → `undefined`.
- `normalizeBrandColor` — `#AABBCC` → `#aabbcc`; `#abc` → `#aabbcc`; missing `#` rejected; wrong
  length rejected; non-hex characters rejected; empty/undefined → `undefined`.
- `hasBrandingValue` — `{}`, `{ name: '' }`, `{ name: '  ' }` → false; a real name or colour → true.

**`functions/src/games/gameArea.test.ts`** (vitest, co-located):
- no stages / no tasks → `undefined`.
- one placed task → exactly `approximatePublicPoint(that task)`.
- two placed tasks → the coarsened mean, and the result is itself on the grid (equal to its own
  `approximatePublicPoint`).
- a `hideLocation` task contributes nothing (a game of only hidden tasks → `undefined`, and a mixed
  game derives the same point as the visible task alone).
- a `locationless` task, a `{lat:0,lng:0}` unplaced task and an out-of-range/NaN coordinate all
  contribute nothing.
- purity: two calls on the same input are equal; the input array is not mutated.
- `resolveGameArea(authored, stages)` — an authored area is returned verbatim (label preserved);
  an authored area with unusable coordinates falls back to the derived one; absent → derived.

RED is confirmed by running each file before the implementation exists and recording the failure.

## Migration

None. No stored shape changes. Existing public documents gain a derived `approxLocation` on their
next publish or public edit; documents that already carry an authored one are untouched.
