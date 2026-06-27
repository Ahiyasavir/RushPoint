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
| `safe-zone-boundary` | 📋 backlog |

## 3. UI/UX & performance — `v21-uiux-and-perf.todo.test.ts` · `v21-performance-and-smoothness.todo.test.ts`
| Change | Status |
|---|---|
| `play-web-i18n-hebrew` | ✅ archived (`2026-06-27-play-web-i18n-hebrew`) → play-web-i18n spec; ALL participant+staff screens/components i18n'd (StaffConsole, PlayScreen, PublicLeaderboard, ErrorBoundary + TaskRunner error/dialog strings); 156-key HE/EN parity, zero English chrome; all 5 gates green |
| `ui-no-dashes` | ✅ archived (`2026-06-27-ui-no-dashes`) → ui-text-standards spec; `scripts/test-no-dashes.ts` scans both apps' i18n maps for `—`/`–`/` - ` (in npm test); offenders swept; standard documented in INSTRUCTIONS.md §3.C; all 5 gates green |
| `platform-benchmark` | 📋 backlog |

## 4. Marketing & virality — `v21-marketing-virality.todo.test.ts`
| Change | Status |
|---|---|
| `share-branding` | 📋 backlog |
| `podium-share-moment` | 📋 backlog |
| `challenge-a-friend` | 📋 backlog |
| `run-recap` | 📋 backlog |
| `run-replay-vod` | 📋 backlog |

## 5. Growth — `v21-growth.todo.test.ts` · `v21-playtest-links.todo.test.ts`
| Change | Status |
|---|---|
| `no-signup-demo` | 📋 backlog |
| `duplicate-translate-game` | 📋 backlog |
| `playtest-shareable-links` | 📋 backlog |

## 6. Engagement & analytics — `v21-engagement-and-analytics.todo.test.ts`
| Change | Status |
|---|---|
| `streak-momentum` | 📋 backlog |
| `live-emoji-reactions` | 📋 backlog |
| `tv-leaderboard` | 📋 backlog |
| `run-analytics-heatmap` | 📋 backlog |
| `surprise-trivia-waypoints` | 📋 backlog |
| `hot-zone-bonus` | 📋 backlog |

## 7. Feature expansion — `v21-feature-expansion.todo.test.ts`
| Change | Status |
|---|---|
| **`v2.1-builder-shell-redesign`** (flat design doc) | ✅ implemented & gate-green — Builder rebuilt as a persistent 3-pane shell (StageRail · virtualized TaskCanvas · slide-in ContextPanel) + dynamic Quiz editor, Inspiration samples, RichTooltips, lazy map/WebGL teardown; tsx + Vitest suites. See [`v2.1-builder-shell-redesign.md`](v2.1-builder-shell-redesign.md). Supersedes the **layout** half of `task-creation-wizard`. |
| `task-creation-wizard` | 📋 backlog (24 tasks) — layout half superseded by the builder shell redesign above; pure-logic/wizard-flow half still open |
| `task-trigger-modes` | ✅ archived (`2026-06-26-task-trigger-modes`) → task-trigger-modes spec; server gate now honors triggerMode (radius/exact/instant via evaluateTrigger), e2e exact+instant green, Builder 4-mode selector. §4.3 (edit the unbuilt task-creation-wizard spec) deferred with that change. |
| `solo-mode-registration` | ✅ archived (`2026-06-27-solo-mode-registration`) → solo-registration spec; JoinScreen fully wired (solo = one name input, no member list; team unchanged) via resolveRegistrationFields/resolveDisplayName; all gates green |
| `import-game-spreadsheet` | 📋 backlog |
| `white-label-pro` | 📋 backlog |

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
