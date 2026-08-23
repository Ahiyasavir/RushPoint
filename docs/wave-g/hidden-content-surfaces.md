# Wave-G — Hidden-location content-surface audit

Read-only sweep of every server surface that echoes task- or run-derived content
to a **participant** (not owner/staff), checking whether a hidden-location task's
secret (title / description / coordinates / clue-answer / a photo taken at the
spot) can leak to a player who has **not yet arrived** (`RunTaskRecord.arrivedAt`
unset), or whether any surface **breaks** when handed a sealed/omitted task.

Scope note: the just-shipped controls are treated as correct and NOT re-reported —
`getMyTeamState` omission of non-assigned tasks, the `sanitizeTaskForParticipant`
sealed stub, `buildRecommendations` `locationHidden`, and the live-photo-feed
exclusion (`functions/src/feedVisibility.ts` `shouldFeedTask`). Line numbers are
against the tree at audit time.

---

## CONFIRMED — live-run leak (fix queue, top priority)

| # | file:line | surface | what leaks | live vs post-finish | sev | one-line fix |
|---|-----------|---------|-----------|---------------------|-----|--------------|
| 1 | `functions/src/runs/index.ts:2923` `requestTaskHint` | paid-hint reveal | The hint TEXT for **any task in any stage**, addressed purely by `taskId`. There is **no `assertStageActiveForTask` guard** (every answer callable — `submitTaskAnswer`/`submitSequenceStep`/`verifyStationCode`/`completeTask` — has one; this one is the outlier). A participant can reveal the sealed find-the-spot hint of a **hidden-location task in a future/locked stage they have not reached**, or of the current stage's hidden task — a future-content / location oracle. The one-per-team charge does not prevent the reveal; escalation-free timing (`rec.startedAt` undefined on an unstarted task) generally charges but still hands back the text. | **LIVE** | **High** | After `resolveCallerTeam` (which already returns `team`), add `assertStageActiveForTask(team, taskId)` before looking the hint up — same guard the answer callables use. Keeps the intended pre-arrival hint for the team's *current* stage. |

Note on intent: revealing the hint for the team's **current active-stage** hidden
task pre-arrival IS by design (the sanitizer keeps `hasHint` while sealed — a
treasure-hunt hint is meant to help you find the spot). The bug is strictly the
**missing stage scope**, which lets the same call reach not-yet-reached stages.

---

## CLEAN — verified no hidden-task leak (bill of health)

| surface | file | verdict |
|---------|------|---------|
| `getMyTeamState` → `activeStageTasks` | `runs/index.ts:3416-3448` | Only records with status `assigned`/`completed` are emitted; each hidden task is sealed unless `rec.arrivedAt != null || status==='completed'`. Sealed stub is built by construction (fields default WITHHELD). Correct. |
| `getMyTeamState` → returned `team` doc | `runs/index.ts:3511` | The team doc's `stages[].tasks[]` (`RunTaskRecord`, `types/index.ts:690`) carry **no** title/description/coordinates/answer — only ids, status, scores, `arrivedAt`, and the team's OWN `photoUrl`/`surveyResponse`. No cross-task or cross-team secret. Clean. |
| `getMyTeamState` → `stageNarratives` | `runs/index.ts:3496-3508` | Restricted to `active`/`completed` stages (never future), stage-level text only. No task title/coords. (Caveat: a creator could *author* a location into a stage narrative — authoring concern, not a system leak.) |
| `getMyTeamState` → `lockedTaskIds`, `nextStageReleaseAt`, `run.leaderboard`, `game.*` | `runs/index.ts:3532-3552` | Ids-only / timestamps / published-gated board / non-secret game chrome. Clean. |
| `getRecommendedTasks` → `buildRecommendations` | `routing/assignNextTask.ts:184-218` | `hideLocation` handling is **type-agnostic** (keys off the flag, not the task type), so it holds for photo/station/quiz/geofence/sequence alike: emits `locationHidden:true` instead of `title`, forces `distanceKm:0`, never ships `coordinates`/`description`/answers. Clean for all types. |
| `reportArrival` | `runs/index.ts:2999-3063` | Controller-only (`requireController`), rate-limited, `assertStageActiveForTask` scoped, coordinates required (no self-declared arrival), reason strings are digit-free (no distance/"getting warmer" oracle), verdict latched + idempotent. No brute-force reveal path. Clean. |
| Live photo feed writes | `functions/src/index.ts:1004` & `:1095` | Both write sites (`submitStationPhoto` autoApprove + `reviewStationSubmission`) gate on `shouldFeedTask(feedTask)` (fail-closed on unresolved task). Already-fixed feed leak — not re-reported. |
| `getPublicLeaderboard` → `ceremonyFeed` | `runs/index.ts:1752-1805` | Gated on `published`; `ceremonyFeed` is built from `feedItems`, which already exclude hidden tasks at write time. Double-safe. |
| `getRunReplay` / `getRunAnalytics` / `getRunHeatmap` / `getRunSummary` | `runs/index.ts:1853/1886/1988/1956` | **Owner-only** (`uid !== c.ownerUid → permission-denied`). Not participant-reachable, and none echoes task titles/coords anyway (analytics keys by taskId+type). Moot for participant leak. |
| `getRunTrackables` / `getRunZones` | `runs/index.ts:2126/2223` | Trackables expose `homeTaskId`/`currentTaskId` (ids only, fine). Zones carry their own organizer-set center coords, independent of tasks. Not a hidden-task leak. |
| `getRunDiscoveryPois` → `toDiscoveryPoiResult` | `shared/discoveryPoi.ts:36-46` | Strips POI `coordinates` and `answers`; ships only title/flavor/question/radius/bonus/`hasHint`. Separate feature; clean. |
| `pushAnnouncement` (incl. targeted) / `pushFlashMission` / `sendTeamChatMessage` / `reactToFeedItem` | `index.ts:419/542/619/709` | Free-text authored by staff/owner (or team). No automatic injection of a hidden task's title/coords into the payload. A leak would require a human typing it. No system-level leak. |
| `requestNextTask` | `runs/index.ts:2902-2919` | Returns only `{taskId, reason}` — no task content; the client re-fetches sanitized content via `getMyTeamState` (which seals). Clean. |

No BREAK-on-sealed-task found on the server: every grading/routing path resolves
the task from the **game doc** via `findGameTask` (full title/type/coords), never
from the sanitized stub, so a sealed task never starves server logic of a field it
needs. The sealed stub is a terminal echo only.

---

## NEEDS RUNTIME CHECK / LATENT (not a leak today, but a trap)

| # | file:line | surface | risk | why not live today | sev | fix |
|---|-----------|---------|------|--------------------|-----|-----|
| 2 | `functions/src/runs/index.ts:1813` `getRunRecap` + `shared/runRecap.ts:57-67` `buildRunRecap` | recap photos | `buildRunRecap` collects `rec.photoUrl` for **every** approved/correct task record — **including hidden-location tasks** — with **no `shouldFeedTask` filter**. `getRunRecap` is participant-reachable and gated only on `leaderboard.published`, which an organizer **can flip true mid-run** (`refreshLeaderboard({publish:true})` for a live TV/staged reveal). If it carried hidden-spot photos, teams still hunting could read them via the access code. | **No leak now:** no server code writes `photoUrl`/`verificationOutcome` onto `stages[].tasks[]` records — photos live on `team.taskSubmissions[taskId]` — so `recap.photos` is currently always empty. Pure latent coupling. | Low now / would-be **High** | When recap is ever wired to real photos (from stage records or `taskSubmissions`), filter hidden-location tasks via `shouldFeedTask`, mirroring the feed. Add the filter to `buildRunRecap` proactively so the two surfaces can't diverge. |
| 3 | `functions/src/runs/index.ts:3528` `getMyTeamState` → `run.hotZone` | hot-zone center coords | The active hot-zone center coordinates are shipped to every participant. If an organizer centers a hot zone on a hidden task's exact spot, that leaks the location. | Organizer-set and independent of tasks; only leaks by deliberate/accidental organizer overlap, not automatically. Comment already treats zone coords as run-public. | Low | Optional: warn in the console when a hot-zone center falls within a hidden task's radius. Not a code-correctness fix. |

---

## Highest-severity takeaway

**Finding #1 (`requestTaskHint` lacks `assertStageActiveForTask`) is the only
confirmed live leak** — it is a future/unreached-stage hint oracle that, for a
hidden-location task, hands back the sealed find-the-spot hint for a stage the
team has not reached. One-line fix: add the same stage-scope guard the answer
callables already carry. Finding #2 (recap photos) is a latent trap to fix
proactively before recap photos are wired up; everything else is clean.
