# Design — run-console-clarity

## 0. The invariant everything else hangs off

`apps/creator-web/src/lib/runConsoleLayout.ts:1-11` states it: the console's layout is **DATA**, not
inline JSX conditions, because nothing else can answer "what is on screen right now?". Every fix
here obeys the same rule:

> A behavioural decision lives in a pure module under `apps/creator-web/src/lib/`, is covered by a
> test in `apps/creator-web/src/lib/__tests__/runConsole.test.ts`, and `RunConsolePage.tsx` only
> renders what the module returned.

Concretely that means: no new `{cond && …}` in the page that decides *whether a control exists*,
*how urgent it is*, *what it is called*, or *whether it needs a confirm*.

The second rule, applied everywhere a closed union already exists: **exhaustive records with no
`default:` branch**. `PANEL_GROUP` and `SEVERITY` already work this way — adding a panel or an action
without classifying it is a typecheck failure, not a review miss. This change extends the pattern to
group summaries, action consequences and panel copy, because the three defects it removes are all
"a new thing shipped unclassified and rendered as nothing".

## 1. Files to touch (creator-web only)

| File | Change |
|---|---|
| `lib/runConsoleSignals.ts` | **new** — the triage strip's whole verdict |
| `lib/runConsolePanelMeta.ts` | **new** — icon + copy contract per `PanelId` |
| `lib/runConsoleLayout.ts` | `RunConsoleState` / `GroupSummary` fields, exhaustive `summaryFor`, `summaryChips`, `defaultSection`, `resolveSectionWithReason`, visibility of `photoReview` / `chat` / `analytics`, `pinnedPanelIds` |
| `lib/runConsoleActions.ts` | `CONSEQUENCE` record, `runActionConsequence`, `runActionNeedsConfirm`, `teamRowActions` |
| `lib/runConsoleLabels.ts` | `resolveEnumLabel` |
| `lib/runShareArtifacts.ts` | `publishesOnShare` per artifact |
| `pages/RunConsolePage.tsx` | render the above; `PanelShell`; overflow menu; confirms; variants |
| `i18n.ts` | new `runConsole.signal.*`, `runConsole.panel.*`, `runConsole.consequence*` copy; the P9 copy pass; six dead keys deleted from BOTH dictionaries |
| `lib/__tests__/runConsole.test.ts` | the tests below |

**Not touched, deliberately:** `functions/**`, `packages/shared/**`, `apps/play-web/**`,
`lib/teamAttention.ts`, `lib/photoReviewQueue.ts`, `services/calls.ts`, `firestore.rules`.

## 2. P1 — the triage strip (`lib/runConsoleSignals.ts`)

### Shape

```ts
type SignalId = 'sos' | 'outOfBounds' | 'photoOverdue' | 'teamsStuck' | 'heldForConsent'
              | 'photoPending' | 'unreadChat' | 'tasksPaused' | 'nobodyJoined' | 'notStarted';
type SignalSeverity = 'critical' | 'warn' | 'info';
type RunSignal = { id: SignalId; severity: SignalSeverity; count: number; panel: PanelId };
buildRunSignals(input: RunSignalInput): RunSignal[]
```

**Deviation from the survey's sketch, stated up front:** the survey proposed
`target: {section, panel} | null`. A signal carries **only a `PanelId`**, and where that panel lives
is answered by the layout module's existing `panelPlacement(panel)` (`'pinned' | SectionId`). One
source of truth for placement instead of two that can disagree, and it makes the reachability
property strictly stronger: a signal cannot name a section that does not hold its panel, because it
never names a section at all. The page does
`const where = panelPlacement(s.panel); if (where !== 'pinned') openSection(where)`.

### The table

| id | fires when | severity | panel |
|---|---|---|---|
| `sos` | `alertCount > 0` | critical | `alerts` (pinned) |
| `outOfBounds` | `outOfBoundsCount > 0` | critical | `teams` |
| `photoOverdue` | `overduePhotoCount > 0` | critical | `photoReview` |
| `teamsStuck` | `stuckTeamCount > 0` | warn | `teams` |
| `heldForConsent` | `heldForConsentCount > 0` | warn | `teams` |
| `photoPending` | `pendingPhotoCount > 0` **and** `overduePhotoCount === 0` | warn | `photoReview` |
| `unreadChat` | `unreadChatThreads > 0` | warn | `chat` |
| `tasksPaused` | `pausedTaskCount > 0` | info | `taskAvailability` |
| `nobodyJoined` | `teamCount === 0` | info | `joinShare` |
| `notStarted` | `teamCount > 0` and `unstartedTeamCount > 0` | info | `startTeams` |

`photoPending` is suppressed while `photoOverdue` fires so the same queue never occupies two chips.

### Bias to silence, and totality

Same design bias as `lib/teamAttention.ts:14-18`: an organizer who sees everything flagged stops
reading the flags. Therefore:

- a **finished** run returns `[]` — nothing in the field needs anybody any more;
- a live run where every counter is zero and teams have joined and started returns `[]`;
- every counter passes through one `count()` gate that maps `undefined`, `null`, `NaN`, `Infinity`,
  a negative number and a non-number to `0`, so a backend that has not sent a field yet produces
  silence and never a phantom alarm.

### Ordering

`severity rank (critical < warn < info)`, then `panelPriority(panel)` — which is the console's
existing "what does an organizer reach for while something is going wrong" ordering
(`runConsoleLayout.ts:287`) and is today read by nothing but the column packer — then `SIGNAL_ORDER`
index as the final tie-break. Total, deterministic, and stable under permuted input.

## 3. P2 — no mute rail entry

`RunConsoleState` gains `attentionTeamCount`, `pausedTaskCount`, `shareLinkCount`.
`GroupSummary` gains `attentionTeams?`, `pausedTasks?`, `shareLinks?`, `reportCount?`.

`summaryFor` becomes a **switch over `GroupId` with a case per group and no `default:`**, so adding a
`GroupId` fails typecheck instead of silently producing a bare `panelCount` (which is exactly why
`shareAndScreens` and `afterTheRun` are blank today).

The page must not decide what a chip says either, so the module also exports:

```ts
type SummaryChipKey = 'teams'|'attention'|'pendingPhotos'|'unreadChats'|'hotZone'
                    | 'pausedTasks'|'shareLinks'|'reports'|'panels';
type SummaryChip = { key: SummaryChipKey; value: number; tone: 'neutral'|'warn'|'alert' };
summaryChips(summary: GroupSummary): SummaryChip[]   // never empty
```

`'panels'` is the guaranteed non-empty fallback: a section with nothing else to say still reports
how many panels it holds. The test iterates `SECTION_ORDER` across all three statuses and requires a
non-empty chip list every time, so the "permanently mute rail button" defect cannot come back for a
section that has not been invented yet.

## 4. P3 — a rail that keeps its shape

Three visibility rules change in `isPanelVisible`:

- `photoReview`: `live || photoQueueCount > 0` (was `photoQueueCount > 0`)
- `chat`: `live` (was `live && chatThreadCount > 0`)
- `analytics`: `true` (was `!live`) — see §8

`feed` deliberately stays count-gated: an empty photo feed is not a work queue and its panel is a
grid of images with nothing useful to say when there are none. `moderation` therefore still exists
for the whole live run through `photoReview` + `chat`, which is what makes the rail stable.

Both newly-always-present panels get a real empty state through `PanelShell` (§6), because a panel
that renders nothing is worse than one that is absent.

`DEFAULT_SECTION` (a constant) is replaced by `defaultSection(status)`:
`'finished' ⇒ 'afterTheRun'`, otherwise `'teamsAndScores'`. The constant is kept as an alias for the
live default so no existing caller or test silently changes meaning.

```ts
type SectionResolution = { id: SectionId | null; reason: 'requested'|'sectionEmptied'|'default'|'firstAvailable'|'none' };
resolveSectionWithReason(sections, requested, status): SectionResolution
resolveSection(sections, requested, status?): SectionId | null   // thin wrapper, unchanged contract
```

`'sectionEmptied'` is distinguished from `'default'` by asking whether `requested` is a **known**
`SectionId` that is simply not present right now. Only that case makes the page say "that section is
empty now, showing X" — a junk or absent stored value is not worth a sentence.

**The property that pins this:** with `status: 'live'`, for every combination of
`photoQueueCount ∈ {0, 7}` × `chatThreadCount ∈ {0, 4}` × `feedItemCount ∈ {0, 3}`, the list of
section ids is **identical**. That is the whole C1 defect, expressed as an equality.

## 5. P4 — one consequence table

```ts
type ActionAudience = 'nobody' | 'oneTeam' | 'allTeams' | 'public';
type RunActionConsequence = { audience: ActionAudience; reversible: boolean; confirm: boolean; copyKey: string };
const CONSEQUENCE: Record<RunActionId, RunActionConsequence>;
runActionConsequence(id), runActionNeedsConfirm(id)
```

Keyed by the **same closed union** `SEVERITY` uses, so severity and consequence cannot cover
different sets. `copyKey` names a leaf in `runConsole.consequence` present in BOTH dictionaries; the
test proves every key resolves, in both languages, which is how a new action ships with a sentence
instead of an unexplained button.

Behaviour that changes as a result:

| action | audience | reversible | confirm | why |
|---|---|---|---|---|
| `startTeams` | allTeams | false | **yes** | starts every race clock; today it just fires |
| `publishStandings` | public | true | **yes** | reveals live standings to every player |
| `acknowledgeAlert` | oneTeam | **false** | **yes** | the query is `acknowledged == false`; the row never comes back |
| `skipStage` | oneTeam | false | yes | destroys the rest of the team's stage |
| `skipTask` | oneTeam | false | yes | (row added by the landed `skip-single-task` change) |
| `finalizeRun`, `adjustTeamScore` | allTeams / oneTeam | false | yes | already confirmed; now stated in the table |

Everything else is `confirm: false`. Two invariants the test enforces:
**every `destructive` action confirms**, and **every action whose audience is `public` or `allTeams`
confirms**. Those two rules are what make the table a contract rather than a list.

`clearTeamOutOfBounds` stays `routine` / no confirm / `audience: 'oneTeam'`, reversible — it is the
one human escape hatch from the safe-zone latch and `runConsoleActions.ts:40-42` explains why it must
never look scary.

### B7 — colour must predict consequence

`runActionVariant` is documented as "the one place severity turns into chrome" and is then bypassed
by ~12 hardcoded `variant=` props, including `deactivateHotZone` rendering `danger` for a
`cautionary` action. Every console control is routed through `runActionVariant(id)`. The publish
toggle stops being a raw `<button>` whose label is its state and becomes a labelled control with a
verb, `aria-pressed`, and the confirm the table now demands.

### The team row (conflict resolution with the landed `skip-single-task` change)

```ts
teamRowActions(team: {outOfBounds?: boolean}, attention: {level: 'ok'|'watch'|'stuck'})
  : { inline: RunActionId[]; overflow: RunActionId[] }
```

- `inline` = `['clearTeamOutOfBounds']` when the latch is holding the team, else `[]`.
  **At most one inline control**, because the row already carries a name, a status line, up to two
  state lines, an attention badge and a score before any button.
- `overflow` = `['skipTask', 'skipStage', 'adjustTeamScore']`, least to most destructive.

Invariants under test: the two lists partition the row's action set with no duplicate; the safety
release is never in the overflow; nothing `destructive` is ever inline; `inline.length <= 1`.

### B2 — the share surface stops publishing silently

`ShareArtifact` gains `publishesOnShare: boolean` = `requiresPublish && status !== 'finished'` —
which is exactly the condition under which `ensureBoardPublished` actually writes (it returns early
on a finished run, by the deliberate `manual-leaderboard-reveal` rule). The card renders the warning
next to the copy/open buttons BEFORE the click, and `ensureBoardPublished`'s bare `catch {}` becomes
a real failure report through the page's existing `useCallFailureToast`.

## 6. P5 — the panel copy catalogue

`lib/runConsolePanelMeta.ts`:

```ts
type PanelCopy = { icon: string; hasHelp: boolean; hasEmpty: boolean };
const PANEL_COPY: Record<PanelId, PanelCopy>;
panelCopy(id: PanelId): PanelCopy;
```

The **text** lives in one new nested dictionary block, `runConsole.panel.<panelId>.{title, help,
empty}`, so the copy contract is a shape the dictionary parity test already walks recursively. The
module owns the icon and the structural flags; i18n owns the words. That split is why the icons come
OUT of the translation values (`'🔥 אזור חם'` → icon `'🔥'` + title `'אזור חם'`): an emoji inside a
Hebrew string is not translatable content, and it made every panel title untestable as copy.

`PanelShell` in the page renders `Card → icon + title (+ optional badge/actions) → help → children`
for every panel. Consequences:

- the seven panels with no help line (`alerts`, `teams`, `liveStandings`, `finalStandings`,
  `liveMap`, `feed`, `chat`) get one;
- the five bare grey `<div>`s that today make "empty" and "failed" look identical become the shared
  `EmptyState`;
- `SurveyResultsPanel` gets a real `results.length === 0` branch instead of a permanently blank card.

Test: `PANEL_COPY` is total over `ALL_PANEL_IDS` with no extras, and every panel has a non-empty
`title` and `help` in **both** dictionaries.

## 7. P6 — no machine identifiers on screen

```ts
resolveEnumLabel(value: unknown, labels: Readonly<Record<string, string>>, fallbackFmt: (raw: string) => string): string
```

Joins `resolveTeamLabel` / `resolveTaskLabel` in the same module and is applied at the four remaining
leaks: the alert type, the analytics task type, the summary issue label, and the trackables holder
(which prints a raw Firestore uid because it hand-rolls a lookup instead of calling
`resolveTeamLabel`). The zone holder's `?? ''` (which renders "held by ") goes the same way.

The contract under test: **it never returns the raw input**. An unmapped value comes back through
the translated fallback format, so a fallback can never be mistaken for a name — the same rule the
two existing resolvers already follow.

## 8. P8 — analytics during the run (verified, in scope)

The survey gated this on a backend check. **`getRunAnalytics` is NOT finished-gated**
(`functions/src/runs/index.ts:2260-2287`): it resolves the run by access code, refuses non-owners,
and returns `runStatus: run?.status ?? 'live'` — a live run is a normal, supported input. So the
`!live` gate on the `analytics` panel is a pure client-side restriction with no server reason, and
mid-run per-task completion is exactly what an organizer wants when deciding whether to pause a
stop. The panel becomes always-visible; the section it lives in is renamed to plain language that is
true both during and after the run.

`runSummary`, `heatmap` and `feedback` stay `!live`: they read post-run artifacts (the emailed
summary, the full GPS track, the finish-screen survey) that are empty or misleading mid run.

## 9. P7 — de-pin the setup artifacts

`buildPinnedLayout` today re-ranks only `joinShare` and never demotes anything, so `stationQr` holds
prime pixels for the entire event. It becomes `pinnedPanelIds(plan, {teamCount})`: while
`teamCount === 0` the join card and the station QR sort first; once a team has joined, `stationQr`
leaves the pinned zone entirely — it is already reachable in `shareAndScreens`, so nothing becomes
unreachable. Test: `stationQr` is pinned **iff** `teamCount === 0`, and the existing reachability
property still holds at both team counts.

## 10. P9 — copy

Rules already binding: INSTRUCTIONS.md §3.C (no em/en dash or spaced hyphen as a separator in
shipped copy) and §3.D (Hebrew is Hebrew, English is English, every string through `t.*`).

- plain-language section titles (`'Game systems'` names nothing a creator can picture);
- one verb per action end to end (score adjustment used four);
- team statuses phrased as statuses, not nouns;
- Hebrew plural imperative everywhere (house style; three keys were masculine singular);
- the bare-prefix concatenation `{photoReviewTaskLabel} {taskLabel}` ("task Old Market") becomes one
  formatter with a separator;
- the analytics CSV header row stays English on purpose (it is a machine-readable column contract
  consumed by spreadsheets, not UI copy) and is marked `// i18n-ignore` with that reason;
- **six** dead keys deleted from BOTH dictionaries: `hotZoneUseLocation`, `viewAnalytics`,
  `zonesLat`, `zonesLng`, `feedbackAnon`, `staffPinShareNote`. *(The survey said seven; it counted
  `zonesLat`/`zonesLng` as two entries and one line reference twice. Verified by grep: six keys, zero
  references outside `i18n.ts`.)*

## 11. Test strategy

Everything above is pure, and creator-web has no component test runner, so **every assertion lands in
`apps/creator-web/src/lib/__tests__/runConsole.test.ts`** (already wired into vitest, run with
`npx vitest run src/lib/__tests__/runConsole.test.ts` from `apps/creator-web`). Dictionary coverage
rides the existing recursive parity suite in `i18nDictionary.test.ts`, which walks nested objects and
calls function entries, so the new `runConsole.panel.*` block is covered the moment it exists.

RED-first, in this order:

1. `buildRunSignals` — quiet run and finished run return `[]`; the table row by row; deterministic
   total order; `photoPending` suppressed under `photoOverdue`; totality against `undefined`/`NaN`/
   negative/non-number counters; **reachability**: every fired signal's `panel` is in
   `ALL_PANEL_IDS` and appears in `pinnedPanels(plan) ∪ buildRunConsoleSections(plan)` for a state
   in which it fires.
2. `summaryChips` — non-empty for every section of every status (iterating `SECTION_ORDER`, not a
   hand-written list); the counts equal the state's counts.
3. `defaultSection` / `resolveSectionWithReason` — finished opens on the reports; the reason is
   `sectionEmptied` only for a known-but-absent section; **shape stability** across the eight
   moderation-count combinations.
4. `CONSEQUENCE` — total over `RUN_ACTION_IDS` by iteration; every destructive action confirms;
   every `public`/`allTeams` action confirms; every `copyKey` resolves in HE and EN.
5. `teamRowActions` — partition, no duplicates, safety inline, destructive never inline,
   `inline.length <= 1`.
6. `PANEL_COPY` — total over `ALL_PANEL_IDS`, no extras, title and help non-empty in both languages.
7. `resolveEnumLabel` — never returns the raw input; total over `null`/`undefined`/non-string.
8. `pinnedPanelIds` — `stationQr` pinned iff `teamCount === 0`; reachability preserved.
9. `publishesOnShare` — true for the three audience links on a live run, false for all of them on a
   finished run (the manual-reveal rule), false for join/staff/access-code always.

**UI verification**: `npx tsc --noEmit -p apps/creator-web/tsconfig.json`, `npx eslint` on the
touched files, and `npx tsx scripts/check-i18n.ts --strict` (PART A clean, zero NEW PART B
findings). The full gauntlet (`npm run verify`, `npm run verify:emulator`) is run by the parent
sequentially — this lane must not run it, because a concurrent lane owns `packages/shared/dist` and
`shared:build` rewrites it in place.
