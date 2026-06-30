// ⚠️ RED-PHASE BLUEPRINT — NOT COVERAGE. The test.todo() lines below are the
// intended future RED tests for the mapped Appendix B roadmap rows; they assert
// nothing yet. Do not read this file's existence as test coverage. When a row is
// started, convert its todos into real failing tests first (see openspec/config.yaml).
// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Feature expansion (the 20-idea sweep, minus #8/#10/#13)
// ───────────────────────────────────────────────────────────────────────────
// Each test.todo becomes a real failing test when the change is implemented via /opsx:apply.
// OpenSpec changes (one per idea): no-signup-demo · podium-share-moment · challenge-a-friend ·
//   live-emoji-reactions · hot-zone-bonus · import-game-spreadsheet · duplicate-translate-game ·
//   white-label-pro · run-replay-vod · guardian-consent-qr · safe-zone-boundary · platform-benchmark
// (TV mode, streak, heatmap already covered in v21-engagement-and-analytics.todo.test.ts.)
// Lane tags: [pure] · [e2e] · [ui] · [rules]
import { describe, test } from 'vitest';

describe('no-signup-demo (#1) — logged-out Builder with deferred signup', () => {
  test.todo('[pure] serializeDraft → deserializeDraft round-trips to the original game shape');
  test.todo('[pure] deserializeDraft on a version-mismatched payload returns null');
  test.todo('[pure] isDraftClaimable is true only for a non-empty valid game (≥1 stage with ≥1 task)');
  test.todo('[ui] demo edits persist to localStorage and survive a refresh with no Firestore write');
  test.todo('[ui] first Save → auth modal → claimDraft createGame+updateGame → local draft cleared');
  test.todo('[ui] signup elsewhere with a claimable draft offers an import');
});

describe('podium-share-moment (#3) — animated finish + branded podium share', () => {
  test.todo('[pure] selectPodium maps ranks 1/2/3 to gold/silver/bronze; <3 teams leaves slots empty');
  test.todo('[pure] computePodiumLayout heights ordered gold>silver>bronze, centered, in-bounds');
  test.todo('[ui] Final screen plays the podium reveal; prefers-reduced-motion → instant podium');
  test.todo('[ui] "Share podium" produces a branded image via the share-branding stamp');
});

describe('challenge-a-friend (#5) — shareable single-task teaser', () => {
  test.todo('[pure] parseChallengeParam("gameId:taskId") → object; malformed/empty → null');
  test.todo('[e2e] checkChallengeAnswer correct → {correct:true}; wrong → {correct:false}');
  test.todo('[e2e] checkChallengeAnswer response never contains the answer key');
  test.todo('[e2e] a non-owner challenge on an unpublished task is refused');
  test.todo('[ui] ?challenge= opens the timed teaser with build/join CTAs');
});

describe('live-emoji-reactions (#6) — ephemeral RTDB reactions', () => {
  test.todo('[pure] shouldThrottleReaction: first allowed; within-gap throttled; after-gap allowed; null allowed');
  test.todo('[pure] reactions are restricted to the closed REACTION_EMOJI set (no free text)');
  test.todo('[ui] tapping an emoji floats a reaction for all viewers via RTDB; nothing written to Firestore');
  test.todo('[ui] prefers-reduced-motion fades reactions in place instead of floating');
});

describe('hot-zone-bonus (#7) — timed geofenced scoring multiplier', () => {
  test.todo('[pure] hotZoneMultiplier: active+inside → multiplier; outside → 1; expired → 1; before start → 1; no coords → 1');
  test.todo('[e2e] activateHotZone writes run.hotZone with server startedAt/expiresAt');
  test.todo('[e2e] in-zone in-window completion is multiplied; out-of-zone/after-expiry is not');
  test.todo('[e2e] the multiplier is server-enforced (client cannot assert it)');
  test.todo('[ui] participants see a Hot Zone countdown banner + map circle that clears on expiry');
});

describe('import-game-spreadsheet (#9) — CSV/XLSX → game importer', () => {
  test.todo('[pure] parseGameRows: valid rows → correct stages/tasks; empty sheet → empty game');
  test.todo('[pure] parseGameRows flags unknown task type, quiz-without-answer, invalid coordinates');
  test.todo('[ui] drag-drop shows a preview + validation report; create is blocked while blocking errors exist');
  test.todo('[ui] confirmed import creates a NEW game via createGame+updateGame (never overwrites)');
});

describe('duplicate-translate-game (#11) — server-side content translation', () => {
  test.todo('[pure] collectTranslatableFields targets user-facing text only (excludes coords/types)');
  test.todo('[pure] applyTranslations re-injects deterministically; identity map round-trips to original');
  test.todo('[e2e] translateGame (mocked API) creates a new game in the target language; coords/types/scoring identical');
  test.todo('[e2e] free-text translation keeps the original answer as an accepted alias');
  test.todo('[pure] translation API key is server-side only — never in a client payload');
});

describe('white-label-pro (#12) — server-validated branding suppression', () => {
  test.todo('[pure] resolveRunBrand: white-label+brand → creator brand, footer hidden');
  test.todo('[pure] resolveRunBrand: white-label without brand → RushPoint fallback (no half-branded state)');
  test.todo('[pure] resolveRunBrand: standard → RushPoint brand + "Powered by RushPoint" footer');
  test.todo('[e2e] launchRun seals the entitlement+brand onto the run; client cannot fake it');
  test.todo('[ui] white-label run finish screen shows the creator brand and hides the RushPoint footer');
});

describe('run-replay-vod (#14) — finished-run timeline', () => {
  test.todo('[pure] buildRunTimeline: events globally time-ordered across all teams');
  test.todo('[pure] buildRunTimeline: cumulative score series correct (10 then 25)');
  test.todo('[pure] buildRunTimeline: pruned team omitted without error; empty run → empty timeline');
  test.todo('[e2e] getRunReplay is owner-only; non-owner → permission-denied');
  test.todo('[ui] Replay page renders timeline + scrubber + photo gallery + score chart');
});

describe('guardian-consent-qr (#15) — minors consent gate', () => {
  test.todo('[pure] isConsentSatisfied: not-required → true; required+no record → false; required+record → true');
  test.todo('[e2e] consent-required run holds the team in pending-consent; cannot start until granted');
  test.todo('[e2e] grantGuardianConsent records consent; an invalid/used token is refused');
  test.todo('[e2e] consent records are cleared by the 90-day PII prune');
  test.todo('[ui] consent screen shows a QR + link; the ?consent= guardian page approves and advances the child');
});

describe('safe-zone-boundary (#16) — geographic boundary with auto-alert', () => {
  test.todo('[pure] isOutsideSafeZone: inside → false; on-boundary → false; outside → true; invalid coords → throws');
  test.todo('[e2e] out-of-zone location raises an alert + sets team.outOfBounds + assigns no new task');
  test.todo('[e2e] returning inside clears outOfBounds and resumes assignment');
  test.todo('[e2e] breach is computed server-side (client cannot assert "inside")');
  test.todo('[ui] participant sees the out-of-bounds warning; RunConsole map flags the team');
});

describe('platform-benchmark (#18) — anonymized cross-run comparisons', () => {
  test.todo('[pure] mergeBenchmark: init from null (count 1); rolling update increments count');
  test.todo('[pure] benchmarkIndicator: ±10% → on_par; below → faster; above → slower; null median → unknown');
  test.todo('[e2e] finalizeRun updates benchmarks/{taskType} with aggregate-only fields (NO run/game/team ids)');
  test.todo('[e2e] opt-out skips contribution; a second run reads back a non-null platform median');
  test.todo('[ui] analytics table shows real ↑/↓/≈ benchmark indicators once a benchmark exists');
});
