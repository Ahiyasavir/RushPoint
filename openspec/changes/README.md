# Change backlog — categorized index

> This is a **navigation index**, not a directory layout. OpenSpec requires every change to live in
> a **flat** folder `openspec/changes/<name>/` (so `openspec validate --all`, `list`, and archive
> work). Do **not** nest changes into category sub-folders. Categories below are organizational only
> and mirror the RED-phase blueprint in `functions/src/__planned__/v21-*.todo.test.ts`.

**Status legend** — `📋 backlog` (proposal only, not implemented) · `🟡 partial` (some code/tests
exist; needs per-change verification before it can be archived) · `✅ archived` (folded into
`openspec/specs/`, lives in `changes/archive/`).

Run `npx openspec validate --all --strict` to confirm every item below is well-formed (currently:
all green).

---

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
| `platform-benchmark` | 📋 backlog |

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
| `no-signup-demo` | 📋 backlog |
| `duplicate-translate-game` | ✅ archived (`2026-06-28-duplicate-translate-game`) → game-translation spec; translateGame callable (duplicate + translate display text, preserve coords/types/scoring, keep original answer as alias); pure collectTranslatableFields + applyTranslations (path-based, identity round-trips); shared translateFields.ts; 15 pure + 8 e2e. Mock translator until TRANSLATE_API_KEY set; creator-web action (task 5) **deferred**. All 6 gates green. **P5 #3.** |
| `playtest-shareable-links` | 📋 backlog |

## 6. Engagement & analytics — `v21-engagement-and-analytics.todo.test.ts`
| Change | Status |
|---|---|
| `streak-momentum` | ✅ archived (`2026-06-27-streak-momentum`) → streak-momentum spec; pure computeStreak + computeMedianTaskMs (consecutive completions; skip/idle-gap reset; milestones 3/5/10), PlayScreen "🔥 N in a row!" chip (hidden < 2, motion-reduce-safe milestone pop); 17 pure tests; play-web only, no backend. All gates green. **P3 #1.** |
| `live-emoji-reactions` | 📋 backlog |
| `tv-leaderboard` | ✅ archived (`2026-06-27-tv-leaderboard`) → tv-leaderboard spec; play-web `?tv=<accessCode>` full-screen projection screen (reuses getPublicLeaderboard, 12s auto-refresh, published-gated, "Now in the lead!" flash via pure detectLeaderChange); shared tv.ts; 8 pure tests; all gates green. RunConsole launcher button (req 4) **deferred to frontend agent** (creator-web i18n). **P3 #2.** |
| `run-analytics-heatmap` | 📋 backlog |
| `surprise-trivia-waypoints` | ✅ archived (`2026-06-28-surprise-trivia-waypoints`) → surprise-trivia-waypoints spec; server core: getRunDiscoveryPois (coord/answer-stripped) + claimDiscoveryPoi (server proximity + answer + bonus, idempotent via team.discoveryState); shared discoveryPoi.ts (isWithinPoiRadius, matchesDiscoveryAnswer, isPoiAlreadyClaimed, injection-safe buildOverpassQuery) + types + paths; firestore.rules POI owner-only (play denied); 24 pure + 6 rules + 8 e2e. UI (Builder panel + play overlay, tasks 7-9) **deferred to frontend agent**. All 6 gates green. **P3 #4.** |
| `hot-zone-bonus` | ✅ archived (`2026-06-27-hot-zone-bonus`) → hot-zone-bonus spec; organizer activate/deactivateHotZone callables (owner-auth, bounded, server-stamped, single zone), completeTaskForTeam multiplies earnedScore by pure hotZoneMultiplier (server task coords + clock, never client claim); shared hotZone.ts + HotZone type; 13 pure + 6 e2e (in-zone ×2, out-of-zone unchanged). Fixed missing runs re-export (not-found). UI (banner + RunConsole panel) **deferred to frontend agent**. All 5 gates green. **P3 #3.** |

## 7. Feature expansion — `v21-feature-expansion.todo.test.ts`
| Change | Status |
|---|---|
| **`v2.1-builder-shell-redesign`** (flat design doc) | ✅ implemented & gate-green — Builder rebuilt as a persistent 3-pane shell (StageRail · virtualized TaskCanvas · slide-in ContextPanel) + dynamic Quiz editor, Inspiration samples, RichTooltips, lazy map/WebGL teardown; tsx + Vitest suites. See [`v2.1-builder-shell-redesign.md`](v2.1-builder-shell-redesign.md). Supersedes the **layout** half of `task-creation-wizard`. |
| `task-creation-wizard` | 📋 backlog (24 tasks) — layout half superseded by the builder shell redesign above; pure-logic/wizard-flow half still open |
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
