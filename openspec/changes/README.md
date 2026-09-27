# Change backlog — index

> OpenSpec requires every change to live in a **flat** folder `openspec/changes/<name>/`. Do **not**
> nest changes into category sub-folders. The categories further down are organizational only.

**Status legend** — 📋 backlog (proposal only, nothing ticked) · 🟡 partial (some tasks ticked) ·
archived changes live in [`archive/`](archive) and their specs in [`../specs/`](../specs).

## Status as of 2026-09-08

| | Count |
|---|---|
| Archived (folded into `openspec/specs/`) | **127** |
| Open — partial | **100** |
| Open — backlog only | **29** |

**86 changes were archived on 2026-09-08** in one sweep: every change whose `tasks.md` was fully
ticked, folded into the living specs with `openspec archive`. `openspec validate --all --strict`
passes on every archived change and on every open change that carries a delta spec.

> ⚠️ **Two caveats on these counts.**
>
> 1. **A ticked checkbox is the only "done" signal used here.** The older, pre-OpenSpec backlog was
>    built without maintaining `tasks.md`, so a 📋 backlog row below does **not** mean the work is
>    missing — several describe shipped, documented behaviour (`team-hq-chat` ships
>    `sendTeamChatMessage`; `admin-user-activity-dashboard` ships `listPlatformUsers` and the
>    `/admin/users` page). Each needs a read against the code before it can be archived.
> 2. **26 open changes carry no delta spec at all** (marked below). They fail
>    `openspec validate --strict` by design: a proposal with no `specs/` folder cannot be archived
>    until someone writes the requirement it implies.

### Open — partial (100)

| Change | Tasks | Delta spec |
|---|---|---|
| `accessibility-colorblind` | 🟡 partial (7/8) | **no delta spec** |

| `adaptive-difficulty-routing` | 🟡 partial (9/16) | **no delta spec** |

| `admin-manage-game-templates` | 🟡 partial (32/36) | valid |

| `analytics-csv-export` | 🟡 partial (5/6) | **no delta spec** |

| `builder-analytics-tab-signpost` | 🟡 partial (4/6) | valid |

| `builder-first-task-flow` | 🟡 partial (36/40) | valid |

| `builder-guidance-arbiter` | 🟡 partial (21/23) | valid |

| `callable-rate-limiting` | 🟡 partial (6/14) | valid |

| `callable-test-coverage` | 🟡 partial (5/14) | valid |

| `ceremony-mode` | 🟡 partial (15/17) | **no delta spec** |

| `ceremony-tv-error-state` | 🟡 partial (5/8) | valid |

| `chat-integrations` | 🟡 partial (10/13) | **no delta spec** |

| `ci-pipeline` | 🟡 partial (5/7) | valid |

| `consent-gate-routing` | 🟡 partial (11/13) | valid |

| `creator-launch-liftoff` | 🟡 partial (9/13) | valid |

| `creator-onboarding-and-plain-language` | 🟡 partial (33/38) | valid |

| `creator-pending-states-speak` | 🟡 partial (6/9) | valid |

| `creator-signin-methods` | 🟡 partial (17/23) | valid |

| `dashboard-card-actions-overflow` | 🟡 partial (10/11) | valid |

| `dashboard-drop-redundant-quicklinks` | 🟡 partial (4/5) | valid |

| `e2e-suite-coherence` | 🟡 partial (66/69) | valid |

| `emulator-gate-isolation` | 🟡 partial (11/13) | valid |

| `emulator-port-offset` | 🟡 partial (11/13) | valid |

| `feed-ugc-safety` | 🟡 partial (25/31) | valid |

| `final-consolidate-share` | 🟡 partial (3/6) | valid |

| `firestore-rules-coverage` | 🟡 partial (13/15) | valid |

| `fix-auth-forgot-password-feedback` | 🟡 partial (5/8) | valid |

| `fix-fixed-points-speed-template-drift` | 🟡 partial (12/13) | valid |

| `fix-leaderboard-flag-race` | 🟡 partial (6/7) | valid |

| `fix-solo-selfguided-finalize` | 🟡 partial (8/11) | valid |

| `fix-station-slot-same-team-race` | 🟡 partial (3/7) | valid |

| `flagship-instant-demo` | 🟡 partial (5/7) | valid |

| `gallery-game-card-preview` | 🟡 partial (6/10) | valid |

| `gallery-map-legacy-coarse-repair` | 🟡 partial (8/10) | valid |

| `gallery-map-serve-exact` | 🟡 partial (6/7) | valid |

| `gallery-mission-detail` | 🟡 partial (10/11) | valid |

| `gallery-popularity-ranking` | 🟡 partial (21/22) | valid |

| `gallery-precise-task-location` | 🟡 partial (14/16) | valid |

| `game-file-export-import` | 🟡 partial (20/27) | valid |

| `game-intro-instructions` | 🟡 partial (13/14) | valid |

| `google-analytics-tag` | 🟡 partial (16/17) | valid |

| `guided-new-game-wizard` | 🟡 partial (30/31) | valid |

| `hidden-location-leak-guard` | 🟡 partial (8/13) | valid |

| `hidden-location-map-visibility` | 🟡 partial (21/21) | valid |

| `hidden-mission-search-area` | 🟡 partial (16/17) | valid |

| `hint-auto-escalation` | 🟡 partial (18/20) | **no delta spec** |

| `join-demote-attach-device` | 🟡 partial (6/7) | valid |

| `live-photo-feed` | 🟡 partial (23/25) | **no delta spec** |

| `manual-bonus-staff` | 🟡 partial (6/8) | **no delta spec** |

| `map-recenter-thumb-reach` | 🟡 partial (2/5) | valid |

| `mobile-dashboard-runconsole-reflow` | 🟡 partial (6/7) | valid |

| `mobile-drag-handle-target` | 🟡 partial (5/6) | valid |

| `mobile-move-task-visibility` | 🟡 partial (4/5) | valid |

| `mobile-responsive-creator` | 🟡 partial (15/16) | valid |

| `mobile-taskwizard-density` | 🟡 partial (4/5) | valid |

| `movement-heatmap` | 🟡 partial (10/11) | **no delta spec** |

| `multi-run-gm-panel` | 🟡 partial (9/10) | **no delta spec** |

| `narrative-chapters` | 🟡 partial (9/10) | **no delta spec** |

| `observability-instrumentation` | 🟡 partial (3/15) | valid |

| `optimistic-card-out` | 🟡 partial (8/10) | valid |

| `participant-read-budget` | 🟡 partial (6/11) | valid |

| `play-map-recenter-control` | 🟡 partial (8/10) | valid |

| `play-pending-states-speak` | 🟡 partial (3/7) | valid |

| `play-plain-language-task-eyebrow` | 🟡 partial (6/7) | valid |

| `play-touch-rtl-a11y` | 🟡 partial (26/27) | valid |

| `play-working-feedback` | 🟡 partial (10/12) | valid |

| `player-profile-badges` | 🟡 partial (10/11) | **no delta spec** |

| `playtest-build-isolation` | 🟡 partial (10/13) | valid |

| `playtest-durability` | 🟡 partial (15/16) | valid |

| `post-run-player-report` | 🟡 partial (29/30) | valid |

| `power-ups` | 🟡 partial (19/20) | **no delta spec** |

| `public-task-coordinates-backfill` | 🟡 partial (14/21) | valid |

| `quick-setup-wizard` | 🟡 partial (16/34) | valid |

| `quiz-ordering` | 🟡 partial (20/22) | **no delta spec** |

| `recoverable-game-deletion` | 🟡 partial (32/33) | valid |

| `refactor-runs-module-split` | 🟡 partial (8/18) | valid |

| `run-console-action-feedback` | 🟡 partial (8/9) | valid |

| `run-console-density` | 🟡 partial (15/16) | valid |

| `run-console-progressive-disclosure` | 🟡 partial (28/32) | valid |

| `run-summary-report` | 🟡 partial (18/19) | valid |

| `scheduled-release` | 🟡 partial (18/22) | **no delta spec** |

| `share-surface-failure-feedback` | 🟡 partial (6/9) | valid |

| `skip-single-task` | 🟡 partial (11/13) | valid |

| `smart-build-occasion-and-prep-scale` | 🟡 partial (29/31) | valid |

| `staff-alert-team-name` | 🟡 partial (3/6) | valid |

| `staff-sos-google-maps-walking` | 🟡 partial (2/5) | valid |

| `storage-rules-hardening` | 🟡 partial (19/24) | valid |

| `targeted-announcements` | 🟡 partial (20/21) | **no delta spec** |

| `task-expiry` | 🟡 partial (18/20) | **no delta spec** |

| `task-media-attachments` | 🟡 partial (21/22) | valid |

| `task-media-durability` | 🟡 partial (27/29) | valid |

| `task-single-map-link` | 🟡 partial (3/6) | valid |

| `template-visibility` | 🟡 partial (29/34) | valid |

| `territory-capture` | 🟡 partial (11/12) | **no delta spec** |

| `trackable-collectibles` | 🟡 partial (11/12) | **no delta spec** |

| `unlockable-tasks` | 🟡 partial (17/19) | **no delta spec** |

| `video-submission-task` | 🟡 partial (44/44) | valid |

| `vps-firestore-read-offload` | 🟡 partial (31/43) | valid |

| `wizard-single-primary-action` | 🟡 partial (2/5) | valid |

| `wrong-answer-cost` | 🟡 partial (16/17) | valid |

### Open — backlog only (29)

| Change | Tasks | Delta spec |
|---|---|---|
| `admin-editable-mission-bank` | no tasks.md | valid |

| `admin-user-activity-dashboard` | 📋 backlog (0/23) | valid |

| `audio-tasks` | 📋 backlog (0/24) | **no delta spec** |

| `builder-file-menu` | 📋 backlog (0/9) | valid |

| `builder-nondestructive-disclosure` | 📋 backlog (0/15) | valid |

| `callable-hardening-consistency` | 📋 backlog (0/15) | valid |

| `creator-value-prop-terminology` | 📋 backlog (0/8) | valid |

| `finish-moment-polish` | 📋 backlog (0/8) | valid |

| `fix-photo-camera-capture` | 📋 backlog (0/14) | valid |

| `fix-play-screen-hierarchy` | 📋 backlog (0/13) | valid |

| `fix-territory-map-visibility` | 📋 backlog (0/13) | valid |

| `fold-slot-release-into-txn` | 📋 backlog (0/10) | valid |

| `frontend-component-decomposition` | 📋 backlog (0/16) | valid |

| `gallery-tags-filters` | 📋 backlog (0/16) | **no delta spec** |

| `hot-path-read-cost` | 📋 backlog (0/11) | valid |

| `occasion-recipe-deep-links` | 📋 backlog (0/34) | valid |

| `participant-photo-access-control` | 📋 backlog (0/24) | valid |

| `play-sos-header-access` | 📋 backlog (0/7) | valid |

| `post-review-fixes` | 📋 backlog (0/16) | valid |

| `qr-station-scan` | 📋 backlog (0/17) | **no delta spec** |

| `quiz-location-verification` | 📋 backlog (0/16) | valid |

| `run-email-scope-and-digest` | 📋 backlog (0/25) | valid |

| `staff-console-field-ops` | 📋 backlog (0/82) | valid |

| `stream-upload-write` | 📋 backlog (0/29) | valid |

| `survey-tasks` | 📋 backlog (0/24) | **no delta spec** |

| `team-hq-chat` | 📋 backlog (0/28) | **no delta spec** |

| `test-drive-mode` | 📋 backlog (0/20) | **no delta spec** |

| `unify-app-ui-kit-i18n` | 📋 backlog (0/16) | valid |

| `wallet-tx-date-guard` | 📋 backlog (0/5) | valid |

---

# Historical narrative (per-category notes, not maintained)

The tables below were written as each change landed and are **not** kept current; the counts above
are. Every ✅ row has its full proposal/design/tasks preserved in [`archive/`](archive).

## 1. Launch hardening — `v21-launch-hardening.todo.test.ts`
| Change | Status |
|---|---|
| `prelaunch-critical-fixes` | ✅ archived (`2026-06-26-prelaunch-critical-fixes`) → 5 living specs; all 5 gates green. 49/53 tasks done; 4 human-only QA tasks (preview smoke ×2, **Hebrew native-speaker review of the 48 i18n keys**, creator smoke) remain pre-deploy. |
| `prelaunch-polish` | ✅ archived (`2026-06-26-prelaunch-polish`) → legal-page-polish + locationpicker-a11y specs; all 5 gates green (P1–P12) |
| `play-web-store-readiness` | ✅ archived (`2026-06-26-play-web-store-readiness`) → pwa-installability spec; redesigned icon.svg + 3 raster icons (192/512/512-maskable) via `npm run icons` (sharp); manifest/sw/index wired; test-manifest.ts + STORE.md runbook; all 5 gates green (maskable.app visual gate = human) |
| `fix-live-launch-demo-text` | ✅ archived (`2026-06-26-fix-live-launch-demo-text`) → accurate-launch-welcome spec; requirement now derived server-side in publishGame+getJoinInfo; seed copy cleaned; all 5 gates green |

## 2. Security & reliability — `v21-security-and-reliability.todo.test.ts`
| Change | Status |
|---|---|
| `auth-anticheat-hardening` | ✅ archived (`2026-06-27-auth-anticheat-hardening`) → 5 security specs (authorization, input-validation, run-billing, staff-authentication, answer-submission). IDOR fix, access-code enum deny, staff-PIN throttle + crypto RNG, caller-scoped photoUrl, answer attemptLimit, atomic launchRun, referral cap + Pro-expiry. P1 security batch #1. |
| `guardian-consent-qr` | ✅ archived (`2026-06-27-guardian-consent-qr`) → guardian-consent spec; server-enforced minors gate (isConsentSatisfied + requestGuardianConsent/grantGuardianConsent single-use token + startTeams gate + retention prune). Server tasks done + e2e green; UI (task 5: consent screen/guardian page) deferred to the frontend agent. |
| `safe-zone-boundary` | ✅ archived (`2026-06-27-safe-zone-boundary`) → safe-zone spec; server-side breach detection (isOutsideSafeZone in updateLocation → alert + outOfBounds flag), soft-pause in requestNextTask, retention-safe. Server tasks done + e2e green; UI (task 5) deferred to frontend agent. **P1 security batch COMPLETE.** |

## 3. UI/UX & performance — `v21-uiux-and-perf.todo.test.ts` · `v21-performance-and-smoothness.todo.test.ts`
| Change | Status |
|---|---|
| `play-web-i18n-hebrew` | ✅ archived (`2026-06-27-play-web-i18n-hebrew`) → play-web-i18n spec; ALL participant+staff screens/components i18n'd (StaffConsole, PlayScreen, PublicLeaderboard, ErrorBoundary + TaskRunner error/dialog strings); 156-key HE/EN parity, zero English chrome; all 5 gates green |
| `ui-no-dashes` | ✅ archived (`2026-06-27-ui-no-dashes`) → ui-text-standards spec; `scripts/test-no-dashes.ts` scans both apps' i18n maps for `—`/`–`/` - ` (in npm test); offenders swept; standard documented in INSTRUCTIONS.md §3.C; all 5 gates green |
| `platform-benchmark` | ✅ archived (`2026-06-28-platform-benchmark`) → platform-benchmark spec; finalizeRun folds anonymized per-task-type aggregates (median time + completion rate) into benchmarks/{taskType} (transactional rolling merge, no per-run ids, game.benchmarkOptOut, best-effort); pure mergeBenchmark + benchmarkIndicator + median; rules: authed read / CF-only write; 21 pure + 3 e2e + rules. Analytics column (task 5) **deferred to frontend agent**. All 6 gates green. **P6 #1.** |

## 4. Marketing & virality — `v21-marketing-virality.todo.test.ts`
| Change | Status |
|---|---|
| `share-branding` | ✅ archived (`2026-06-27-share-branding`) → share-branding spec; reusable brand stamp (logo + URL + scannable QR) on every shared image, pure resolveShareQrTarget/computeWatermarkLayout, storyCard QR + sharePhoto + graceful fallbacks; all 5 gates green. **P2 #1.** |
| `podium-share-moment` | ✅ archived (`2026-06-27-podium-share-moment`) → podium-moment spec; selectPodium + computePodiumLayout (pure), FinalScreen reduced-motion-safe podium reveal, branded podium share via stampBrand; all 5 gates green. **P2 #2.** |
| `challenge-a-friend` | ✅ archived (`2026-06-27-challenge-a-friend`) → challenge-a-friend spec; shareable `?challenge=<gameId>:<taskId>` deep link → standalone ChallengeTeaser (30s timer, server-checked answer, join/build CTAs); `checkChallengeAnswer` callable resolves owner via publicGames (published-only), returns only `{correct}`; pure parseChallengeParam + matchesTaskAnswer (lifted from runs, DRY); branded teaser image via stampBrand; 20 pure + 5 e2e assertions; all 5 gates green. **P2 #3.** |
| `run-recap` | ✅ archived (`2026-06-28-run-recap`) → run-recap spec; getRunRecap callable (owner-any/published-only gate, prune-safe) returns standings + every team's approved photo + stats; pure buildRunRecap + computeMontageGrid; play-web RunRecap screen + `?recap=` route + branded collage (stampBrand); 25 pure + 6 e2e. Creator RunConsole "Share recap" action **deferred to frontend agent**. All 6 gates green. **P4 #1.** |
| `run-replay-vod` | ✅ archived (`2026-06-28-run-replay-vod`) → run-replay-vod spec; getRunReplay callable (organizer-only, non-owner → permission-denied) returns a globally time-ordered start/task/finish event stream + per-team cumulative score series via pure buildRunTimeline (retention-safe); shared runReplay.ts; 12 pure + 4 e2e. RunConsole Replay page (task 5) **deferred to frontend agent**. All 6 gates green. **P4 #2.** |

## 5. Growth — `v21-growth.todo.test.ts` · `v21-playtest-links.todo.test.ts`
| Change | Status |
|---|---|
| `no-signup-demo` | ✅ archived (`2026-06-28-no-signup-demo`) → no-signup-demo spec; pure demoDraft helpers (serializeDraft/deserializeDraft versioned + isDraftClaimable, 14 pure). AuthGate demo entry + Builder demo mode + claimDraft (tasks 3-4, creator-web) **deferred to frontend agent**. Gates green. **P5 #4 (core).** |
| `duplicate-translate-game` | ✅ archived (`2026-06-28-duplicate-translate-game`) → game-translation spec; translateGame callable (duplicate + translate display text, preserve coords/types/scoring, keep original answer as alias); pure collectTranslatableFields + applyTranslations (path-based, identity round-trips); shared translateFields.ts; 15 pure + 8 e2e. Mock translator until TRANSLATE_API_KEY set; creator-web action (task 5) **deferred**. All 6 gates green. **P5 #3.** |
| `emulator-data-backup` | ✅ archived (`2026-06-28-emulator-data-backup`) → emulator-data-backup spec; crash-safe periodic snapshot loop (rotating `.firebase/backups/`, keep newest 10) + restore (newest *valid* snapshot → emulator-data); pure isSnapshotDue/snapshotName/selectSnapshotsToPrune/selectRestoreTarget (`scripts/lib/emulatorBackup.mjs`); wired into `npm run playtest` + `RUSHPOINT_BACKUP` gate in dev-emulator; 17 pure tests; PLAYTEST.md + DEPLOY.md. Human crash-recovery verify outstanding. Gates green. **P6 #3.** |
| `playtest-shareable-links` | ✅ archived (`2026-06-28-playtest-shareable-links`) → playtest-links spec; `npm run playtest` (emulator+seed+both apps@0.0.0.0+proxy+cloudflared); pure resolveEmulatorHost (remote-origin auto-detect, dev:all unchanged) + resolveProxyTarget + buildPlaytestLinks; both firebase.ts on the helper; proxy.mjs rewritten; print-playtest-links.mjs + PLAYTEST.md; 26 pure tests. Human phone-verify (task 6) outstanding. All gates green. **P6 #2.** |

## 6. Engagement & analytics — `v21-engagement-and-analytics.todo.test.ts`
| Change | Status |
|---|---|
| `streak-momentum` | ✅ archived (`2026-06-27-streak-momentum`) → streak-momentum spec; pure computeStreak + computeMedianTaskMs (consecutive completions; skip/idle-gap reset; milestones 3/5/10), PlayScreen "🔥 N in a row!" chip (hidden < 2, motion-reduce-safe milestone pop); 17 pure tests; play-web only, no backend. All gates green. **P3 #1.** |
| `live-emoji-reactions` | ✅ archived (`2026-06-28-live-emoji-reactions`) → live-emoji spec; pure shouldThrottleReaction + closed REACTION_EMOJI set + isAllowedReaction (12 pure). Realtime transport + reaction bar/floating renderer (task 3) **DEFERRED — blocked on RTDB migration (Appendix B #2)**. Gates green. **P3 #5 (core).** |
| `tv-leaderboard` | ✅ archived (`2026-06-27-tv-leaderboard`) → tv-leaderboard spec; play-web `?tv=<accessCode>` full-screen projection screen (reuses getPublicLeaderboard, 12s auto-refresh, published-gated, "Now in the lead!" flash via pure detectLeaderChange); shared tv.ts; 8 pure tests; all gates green. RunConsole launcher button (req 4) **deferred to frontend agent** (creator-web i18n). **P3 #2.** |
| `run-analytics-heatmap` | ✅ archived (`2026-06-28-run-analytics-heatmap`) → run-analytics spec; getRunAnalytics callable (organizer-only) returns per-task completion rate + median/p90 + hint/skip counts + overall rate via pure computeRunAnalytics (deterministic, prune-safe); compareToPlatformMedian → benchmark indicator; shared runAnalytics.ts; 16 pure + 4 e2e. Analytics tab heatmap UI (task 5) **deferred to frontend agent**. All 6 gates green. **P6 #4.** |
| `surprise-trivia-waypoints` | ✅ archived (`2026-06-28-surprise-trivia-waypoints`) → surprise-trivia-waypoints spec; server core: getRunDiscoveryPois (coord/answer-stripped) + claimDiscoveryPoi (server proximity + answer + bonus, idempotent via team.discoveryState); shared discoveryPoi.ts (isWithinPoiRadius, matchesDiscoveryAnswer, isPoiAlreadyClaimed, injection-safe buildOverpassQuery) + types + paths; firestore.rules POI owner-only (play denied); 24 pure + 6 rules + 8 e2e. UI (Builder panel + play overlay, tasks 7-9) **deferred to frontend agent**. All 6 gates green. **P3 #4.** |
| `hot-zone-bonus` | ✅ archived (`2026-06-27-hot-zone-bonus`) → hot-zone-bonus spec; organizer activate/deactivateHotZone callables (owner-auth, bounded, server-stamped, single zone), completeTaskForTeam multiplies earnedScore by pure hotZoneMultiplier (server task coords + clock, never client claim); shared hotZone.ts + HotZone type; 13 pure + 6 e2e (in-zone ×2, out-of-zone unchanged). Fixed missing runs re-export (not-found). UI (banner + RunConsole panel) **deferred to frontend agent**. All 5 gates green. **P3 #3.** |

## 7. Feature expansion — `v21-feature-expansion.todo.test.ts`
| Change | Status |
|---|---|
| **`v2.1-builder-shell-redesign`** (flat design doc) | ✅ implemented & gate-green — Builder rebuilt as a persistent 3-pane shell (StageRail · virtualized TaskCanvas · slide-in ContextPanel) + dynamic Quiz editor, Inspiration samples, RichTooltips, lazy map/WebGL teardown; tsx + Vitest suites. See [`v2.1-builder-shell-redesign.md`](v2.1-builder-shell-redesign.md). Supersedes the **layout** half of `task-creation-wizard`. |
| `task-creation-wizard` | OK archived (2026-06-28-task-creation-wizard) -> task-wizard spec; implemented as the slide-in TaskWizard.tsx component (3-step Location/Details/Interaction) + wizardLogic.ts (blankTask/canGoNext/canGoBack/isTaskLocationValid/TASK_TYPE_META x8); scripts/test-wizard.ts (23 pure); committed with the v2.1 Builder shell redesign. All gates green. |
| `task-trigger-modes` | ✅ archived (`2026-06-26-task-trigger-modes`) → task-trigger-modes spec; server gate now honors triggerMode (radius/exact/instant via evaluateTrigger), e2e exact+instant green, Builder 4-mode selector. §4.3 (edit the unbuilt task-creation-wizard spec) deferred with that change. |
| `solo-mode-registration` | ✅ archived (`2026-06-27-solo-mode-registration`) → solo-registration spec; JoinScreen fully wired (solo = one name input, no member list; team unchanged) via resolveRegistrationFields/resolveDisplayName; all gates green |
| `import-game-spreadsheet` | ✅ archived (`2026-06-28-import-game-spreadsheet`) → game-import spec; pure parseGameRows (rows → stages/tasks grouped by stage column, per-row validation: unknown type / quiz+numeric answer / bad coords / missing title; blank coords → locationless; quiz answers split on `\|`); shared importSheet.ts; 20 pure tests. Builder Import panel (task 3, creator-web) **deferred to frontend agent**. All gates green. **P5 #1.** |
| `white-label-pro` | ✅ archived (`2026-06-28-white-label-pro`) → white-label spec; pure resolveRunBrand decision core (white-label+brand → creator wordmark/logo, no footer; else RushPoint+footer; safe fallback for white-label-without-brand); shared runBrand.ts + Run.whiteLabel/brand types; 13 pure tests. Sealing+billing SKU (3-4) and share wiring+creator panel (5) **deferred to billing/frontend agent** (Pro path dark under free mode). Gates green (no e2e — sealing deferred). **P5 #2.** |

## 8. Free mode — `v21-free-mode.todo.test.ts`
| Change | Status |
|---|---|
| `free-mode-no-payments` | ✅ archived (`2026-06-26-free-mode-no-payments`) → `openspec/specs/free-mode/spec.md`; all 5 gates green |

---

## Archived (in source-of-truth `openspec/specs/`)
| Change | Living spec |
|---|---|
| `map-provider-decision` ✅ | `openspec/specs/map-provider/spec.md` |
| `free-mode-no-payments` ✅ | `openspec/specs/free-mode/spec.md` |
| `prelaunch-critical-fixes` ✅ | `openspec/specs/{gps-error-ux,taskrunner-i18n,finalscreen-i18n,photo-url-validation,play-web-i18n-hebrew}/spec.md` |

> **Checkbox caveat:** `tasks.md` checkboxes across the backlog are uniformly unticked and were not
> maintained during the original build — they are **not** a reliable "done" signal. Implementation
> status above is derived from the presence of green tests + real code, not from checkboxes. A change
> is only moved to `archive/` after its spec scenarios are verified against the actual implementation.
