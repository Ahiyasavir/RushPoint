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
| `prelaunch-polish` | 📋 backlog |
| `play-web-store-readiness` | 📋 backlog |
| `fix-live-launch-demo-text` | 🟡 partial — verify against live-launch demo copy before archiving |

## 2. Security & reliability — `v21-security-and-reliability.todo.test.ts`
| Change | Status |
|---|---|
| `auth-anticheat-hardening` | 📋 backlog |
| `guardian-consent-qr` | 📋 backlog |
| `safe-zone-boundary` | 📋 backlog |

## 3. UI/UX & performance — `v21-uiux-and-perf.todo.test.ts` · `v21-performance-and-smoothness.todo.test.ts`
| Change | Status |
|---|---|
| `play-web-i18n-hebrew` | 🟡 partial — `test-i18n-parity.ts` green; UI/backend remainder tracked |
| `ui-no-dashes` | 📋 backlog — its RED test `scripts/test-no-dashes.ts` does not exist yet |
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
| `task-creation-wizard` | 📋 backlog (24 tasks) |
| `task-trigger-modes` | 🟡 partial (~50%) — pure shared helpers (`evaluateTrigger`/`defaultRadiusFor`/`normalizeTriggerMode`) exist + `test-trigger-modes.ts` green, but they are **orphans**: the server gate (`completeTask` still uses the legacy `type === 'geofence'` check, default 50m — does NOT honor `triggerMode`/`exact`/`instant`) and the Builder Step-1 selector are **not implemented**, and e2e has no exact/instant coverage. **NOT archive-ready** — 2 of 4 spec requirements unmet. |
| `solo-mode-registration` | 🟡 partial — `test-registration-fields.ts` green; verify UI/backend remainder |
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
