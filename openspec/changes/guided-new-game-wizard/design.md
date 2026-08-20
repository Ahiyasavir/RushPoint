## Context

Today "+ New game" opens a template picker modal (`DashboardPage.tsx`, `picking` state) that
lists admin-authored templates fetched by `listGameTemplates` and cached in
`lib/templateCache.ts`. Choosing one calls `createGameFromTemplate`
(`functions/src/admin/templates.ts:349`) and navigates to `/build/<gameId>`.

Two facts shape this design:

1. **The Quick Setup handoff already exists.** `BuilderPage.tsx:689` already calls
   `shouldAutoOpenQuickSetup` on mount, so a copied game carrying `wizardSteps` and no local
   record ALREADY lands the creator in Quick Setup. Navigating to `/build/<id>` after
   creation is the entire handoff — no new wiring.
2. **The copy is lossy.** `createGameFromTemplate` hardcodes `tags: []` and
   `registrationFields: DEFAULT_REGISTRATION_FIELDS`, and never copies `instructions`,
   `scoringOptions`, `allowInstantPlay`, `powerUpsEnabled` or `manualLeaderboardReveal`. A
   copy of the story template therefore loses its "שם היחידה" registration field, its
   operator instructions, and `manualLeaderboardReveal: true` — the setting that holds the
   standings back for the plot twist.

Only two templates exist, both youth games: a missions game (ages 11–13,
`fixed_points_speed`, 4 stages) and a spy-story game (ages 14–18, `smart_weighted`, 6 stages,
narrative beats per stage). Both already use `requiredTaskCount` + `exclusiveGroups`.

## Goals / Non-Goals

**Goals:**
- A creator names their game first and lands in a personalized, ready-to-edit game.
- Personalization is deterministic, free, and needs no LLM.
- Shortening is mechanical and reuses existing partial-stage machinery.
- The template copy stops losing authored configuration.
- Every screen designed at 390px first.

**Non-Goals:**
- No LLM / free-text event description.
- No new template content, no short/long authored variants.
- No change to Quick Setup, the full `CreatorTour`, or the guardian-consent mechanism.
- No change to the blank/scratch path's behavior.
- Not deleting the dead `apps/creator-web/src/templates.ts`.

## Decisions

### D1 — Personalization runs server-side, inside `createGameFromTemplate`

**Chosen:** extend the existing callable with optional personalization inputs; it applies
them before the single `ref.set(newGame)`.

**Alternative rejected:** client calls `createGameFromTemplate` then `updateGame`. That is a
two-step write whose failure mode is a half-personalized game sitting in the dashboard. The
existing code comment at `DashboardPage.tsx:397` explicitly credits the single atomic call
for having "no orphaned game doc to clean up on failure" — reintroducing a two-step would
undo a deliberate past fix.

All new inputs are OPTIONAL, so the current picker call site keeps working unchanged and
there is no migration.

```
createGameFromTemplate({
  templateGameId, title, scoringPreset?, templateOwnerUid?,   // existing
  description?: string,                                        // NEW — client-composed
  tags?: string[],                                             // NEW — client-composed
  personalize?: { groupSize?, durationMinutes?, minAge? }       // NEW — structural
}) -> { gameId, estimatedMinutes, fitsRequestedDuration }       // response grows
```

### D2 — Language-bearing output is composed on the CLIENT, structure on the SERVER

The blended description and the derived tags are user-facing Hebrew/English copy. The i18n
rule is that such text comes from `apps/creator-web/src/i18n.ts` via `t.*`; the server has no
access to those dictionaries and must not grow a second copy of them.

- **Client composes** title, description and derived tag words (pure functions fed by `t.*`)
  and passes them as plain strings.
- **Server computes** everything structural: capacity scaling, mode default, `minAge` /
  `requiresGuardianConsent`, duration trimming, and the tag merge through `normalizeTags`.

This also keeps the server dumb about language, which matters because a template can be
either the `he` or `en` variant.

### D3 — Structural rules live in `packages/shared`, wizard flow in `creator-web/src/lib`

- `packages/shared/src/gamePersonalization.ts` (NEW) — pure, framework-free:
  `scaleTaskCapacity`, `defaultModeForGroupSize`, `estimateStageMinutes`,
  `estimateGameMinutes`, `planDurationFit`. Lives in shared because the SERVER applies it and
  the response reports its outcome.
- `apps/creator-web/src/lib/newGameWizard.ts` (NEW) — pure: the question flow, defaults,
  the scratch/guided fork, name fallback, and which template a type answer maps to.
- `apps/creator-web/src/lib/describeNewGame.ts` (NEW) — pure: the description blend and
  derived tag words, taking the resolved dictionary as an argument so it stays testable
  without React.

### D4 — Conservative duration estimate; only author-declared partial stages are trimmed

`estimateStageMinutes` counts the stage's `requiredTaskCount` LONGEST completable tasks,
with each exclusive group contributing at most one member (its longest), mirroring
`maxCompletableTasks`. Longest-first is deliberate: overrunning a real event with a hard end
time is worse than finishing early.

`planDurationFit` returns `{ overrides: Record<stageId, number>, estimatedMinutes, fits }`
and repeatedly trims the eligible stage with the largest contribution, ties broken by highest
`order`.

**Eligibility is narrow on purpose:** a stage qualifies only if it ALREADY carries an
explicit `requiredTaskCount`, and is neither the first stage nor `isFinal`. A stage that
leaves the count unset means "do all of these" — and in the story template, the גולד stage's
three tasks include the climax (`הקוד האחרון`). Trimming it would silently delete the payoff
of the plot. The author already told us which stages are partial; those are the ones we may
cut.

That still leaves real headroom: the missions template's big stage is `requiredTaskCount: 4`
of 7, and the story template's silver stage is `2` of 3.

Task durations come from `effectiveExpectedDurationMinutes`
(`packages/shared/src/taskDuration.ts`) — no new duration model.

### D5 — Two screens on the guided path, one on scratch

- **Screen 1**: name field, then two equally weighted cards — "start from scratch" /
  "build it for me". Scratch ends here.
- **Screen 2**: all four questions as compact chip groups on one scrollable screen, with the
  chosen template's name, emoji, stage count and mission count shown above the CTA.

The preview shows only what `listGameTemplates` actually returns (its projection carries
`stageCount` / `taskCount` but NOT stages), so the client cannot honestly estimate play time
before creating. That is why `estimatedMinutes` / `fitsRequestedDuration` come back in the
RESPONSE: the "this may run longer than you asked" notice is driven by a real server-side
number rather than a fabricated client guess.

### D6 — The spotlight yields to Quick Setup as well as to the full tour

A guided-path creator lands in Quick Setup, which is already a guided experience; stacking a
spotlight on top would be two overlays at once. So the Builder spotlight runs only when
neither the full `CreatorTour` nor Quick Setup is active — which makes it, in practice, the
scratch-path creator's explainer. That is exactly the creator who gets no other guidance
today.

It reuses `CreatorTour`'s spotlight rendering and anchors on `data-tour` attributes that
already exist in `BuilderPage.tsx`: `builder-breadcrumb` (2215), `builder-canvas` (2260),
`builder-tabs` (1021). Its seen-record is a SEPARATE key from `TOUR_SEEN_KEY_PREFIX`.

### D7 — Copy fidelity: allow-list in, template markers explicitly out

`createGameFromTemplate` copies an explicit allow-list of authored fields
(`description`, `mode`, `scoringPreset`, `scoringOptions`, `registrationFields`, `tags`,
`instructions`, `allowInstantPlay`, `powerUpsEnabled`, `manualLeaderboardReveal`) and
explicitly OMITS `isTemplate`, `templateEmoji`, `templateOrder`, `templateGroupKey`,
`templateLang`. An allow-list rather than a spread: a spread would make every future template
field silently inherit, including the next template marker someone adds, and a creator's copy
appearing in the template picker is the failure mode to design out.

## Files touched

| File | Change |
|---|---|
| `functions/src/admin/templates.ts` | `createGameFromTemplate`: copy allow-list, apply personalization, return estimate |
| `functions/src/index.ts` | no change (already re-exported) |
| `packages/shared/src/gamePersonalization.ts` | NEW pure structural rules |
| `packages/shared/src/index.ts` | export the new module |
| `apps/creator-web/src/services/calls.ts` | widen `createGameFromTemplate` input/output types |
| `apps/creator-web/src/pages/DashboardPage.tsx` | picker modal → wizard entry; pass personalization |
| `apps/creator-web/src/components/NewGameWizard.tsx` | NEW wizard UI |
| `apps/creator-web/src/lib/newGameWizard.ts` | NEW pure flow logic |
| `apps/creator-web/src/lib/describeNewGame.ts` | NEW pure blend + derived tags |
| `apps/creator-web/src/lib/creatorOnboarding.ts` | NEW spotlight steps, reducer, seen-record |
| `apps/creator-web/src/components/CreatorTour.tsx` | render the spotlight variant |
| `apps/creator-web/src/pages/BuilderPage.tsx` | start the spotlight when nothing else is active |
| `apps/creator-web/src/i18n.ts` | all new copy, both dictionaries |

No new Firestore index, no security-rule change, no new env var. No new dependency.

## Test strategy

**Pure lane** (`scripts/test-*.ts`, auto-discovered by `npm test`) — every rule below is
proven here, with no emulator:

- `scripts/test-new-game-wizard.ts` — name asked first; blank name falls back to the untitled
  title; scratch path asks nothing further; every question has a default and can be skipped;
  type→template mapping; abandoning produces no creation payload.
- `scripts/test-game-personalization.ts` — capacity invariants (never <1, never above team
  count, unlimited left untouched, grows for a big group); small-group mode default;
  `minAge` / `requiresGuardianConsent` from age including the invalid-age skip;
  `planDurationFit` determinism, first/final protection, the "no explicit
  `requiredTaskCount` ⇒ never trimmed" rule, never below 1, `requiredTaskCountProblem`
  clean afterwards, no padding when already short, and `fits: false` when it cannot fit;
  tag merge (template tags kept, duplicates collapsed, `MAX_TAGS` clamp); totality on
  malformed input.
- `scripts/test-describe-new-game.ts` — an answer appears in the opening sentence; the
  template description is not merely prefixed; deterministic; single paragraph; bounded
  length; empty-description template still yields text.
- `scripts/test-builder-spotlight.ts` — at most three steps; steps name only `data-tour`
  anchors that exist in `BuilderPage.tsx` (asserted by reading the file, as
  `test-geocode.ts` does); missing anchor skips its step; separate seen-record from the full
  tour; does not start while the tour or Quick Setup is active; unwritable storage does not
  throw.

**Callable lane** (`npm run e2e`) — extend the EXISTING template scenario in
`scripts/e2e-verify.mjs` (around line 7529, after the id-remap assertions):

- copy fidelity: a template carrying `instructions`, `manualLeaderboardReveal: true`, custom
  `registrationFields`, `scoringOptions` and `tags` produces a copy carrying all of them;
- the copy has NO `isTemplate` / `templateEmoji` / `templateOrder` / `templateGroupKey` /
  `templateLang`, and does not appear in `listGameTemplates`;
- personalization applied: `groupSize` changes `maxConcurrentTeams`, a small group yields
  `mode: 'individual'`, an age below the threshold sets `minAge` +
  `requiresGuardianConsent`;
- `durationMinutes` below the template's estimate lowers `requiredTaskCount` only on
  author-declared partial stages, and the response reports
  `fitsRequestedDuration` honestly;
- backwards compatibility: a call with NO personalization fields behaves exactly as today;
- client-supplied `description` / `tags` are stored, and the tags still respect `MAX_TAGS`.

**UI lane** — no component test runner exists, so: run the app via the preview tools, walk
both paths at a 390px viewport, confirm no horizontal overflow and no clipped control on
either wizard screen or the spotlight card, and confirm the guided path lands in Quick Setup.
Then `npm run i18n:check:strict` must be clean — all new copy through `t.*` in both
dictionaries, zero new PART B findings.

**Gates**: `npm run verify` (typecheck · lint · test · both builds · bundle · base · origin ·
i18n strict) plus `npm run e2e`.

## Risks / Trade-offs

- **The copy-fidelity fix changes the EXISTING picker path too, not just the wizard.** A
  creator copying a template now inherits its registration fields and instructions where
  before they got platform defaults. → This is the intended correction (the current behavior
  silently discards authored configuration), it only affects newly created games, and no
  stored game changes. Called out here so it is not mistaken for an unintended side effect.
- **Trimming could still remove a mission a creator wanted.** → Narrow eligibility (only
  author-declared partial stages, never first/final) plus the honest
  `fitsRequestedDuration` notice; the creator can raise any count back in the Builder.
- **Capacity scaling touches every copied task.** → Authoring-time only, before any run
  exists, so no in-flight run can move; invariants are unit-tested.
- **The guided path writes more fields in one call**, so a validation mistake fails game
  creation entirely. → Every personalization rule is total by construction (spec:
  "Personalization never fails game creation") and is unit-tested against malformed input.
- **Two overlays could collide on first Builder open.** → D6 makes the spotlight yield to
  both Quick Setup and the full tour, and that precedence is unit-tested.

## Resolved decisions (band values)

Confirmed with the product owner: use the proposed defaults, with the guardian-consent
threshold decided by research rather than assumption.

| Constant | Value | Rationale |
|---|---|---|
| `SMALL_GROUP_MAX_PEOPLE` | 5 | At or below this, `mode` defaults to `individual` — splitting five people into competing teams is not a game. |
| `UNLIMITED_CAPACITY_THRESHOLD` | 100 | Both templates already use exactly 100 on their survey/locationless tasks to mean "no queue". Reusing that number means the rule reads the authors' existing intent instead of imposing a new one. |
| `AGE_BANDS` | 8–10 · 11–13 · 14–17 · 18+ | Kept as proposed. The bands stay this granular for the description blend and tags even though only two of the boundaries change behavior. |
| `GUARDIAN_CONSENT_AGE_THRESHOLD` | **14** (was proposed as 18) | See below. |
| `DURATION_BANDS` | 60 · 90 · 120 · 180 minutes, default 90 | 90 is the middle band and roughly what both templates already estimate to. |
| `GROUP_SIZE_BANDS` | ≤5 · 6–15 · 16–30 · 31+, default 16–30 | ≤5 is the band that triggers individual mode. |
| `TYPICAL_TEAM_SIZE` | 5 | Estimated teams = `ceil(people / 5)`, floor 1 — the input to capacity scaling. |

### Why the consent threshold is 14, not 18

Israel is the launch market and both templates are youth games, so this is worth grounding
rather than guessing. Under the Legal Capacity and Guardianship Law (1962) a minor is anyone
under 18, and Israel's proposed minors' privacy rules draw a sharper line: parental consent
for collecting **any** information about a minor under **14**, and for **sensitive**
information about a minor under 18. GDPR's digital-consent age (13–16 by member state) sits
in the same region. RushPoint collects GPS tracks and photos/videos of identifiable
participants, so the under-14 rule is squarely on point.

Setting the auto-on threshold at 18 was the tempting "safe" choice and is the wrong one
operationally: `requiresGuardianConsent` gates **play**, not just data collection — a minor
who joins a consent-required run is held until a guardian responds. Defaulting it on for a
14–17 youth-movement group means forty teenagers standing in a park unable to start while
counsellors chase parents on WhatsApp, at an event where parents already consented to the
activity itself. That is a failure the creator cannot fix in the moment.

So:
- **under 14** → `requiresGuardianConsent: true` and `minAge` set. Strongest legal basis,
  youngest participants, and the guardian links can be sent ahead of the event.
- **14–17** → `minAge` set, consent left OFF, and the wizard shows a one-line note that
  guardian consent can be switched on in settings. Informed choice, no surprise hold.
- **18+** → neither field set.

This is a product default, not legal advice; the product owner should confirm it with counsel
before launch, since it concerns minors' data in Israel.

## Open Questions

- Whether the scratch path should also prefill a first stage/mission (today it seeds one
  blank stage). Assumed unchanged for now.
