export * from './types';
export * from './canonicalHosts';
export * from './geo';
export * from './validation';
export * from './scoringPresets';
export * from './mapStyle';
export * from './perfBudget';
export * from './registration';
export * from './freeMode';
export * from './staffThrottle';
export * from './rateLimit';
// Which hostnames report to Google Analytics, and how the tag is hardened
// (change: google-analytics-tag). Pure — the inline copy in each app's index.html
// is pinned to it by scripts/test-analytics-gate.ts.
export * from './analytics';
// Public gallery / task library ranking (change: gallery-popularity-ranking).
export * from './popularity';
// What a PUBLIC task may say about where it is (change: task-library-map-view).
export * from './publicTaskLocation';
// What a SEALED hidden mission may say about where it is, to the PLAYER — a
// separate, finer coarsening for a separate audience (change:
// hidden-mission-search-area). Deliberately independent of publicTaskLocation.
export * from './hiddenSearchArea';
// One-off repair of documents published before that contract existed
// (change: public-task-coordinates-backfill).
export * from './publicTaskBackfill';
export * from './answerAttempts';
// What a participant actually SUBMITTED, right and wrong (change:
// post-run-player-report). Bounded, owner-only by construction (never added to
// sanitizeTeamForParticipant's allow-list), destroyed after 30 days.
export * from './answerLog';
// What a wrong answer costs (change: wrong-answer-cost) — escalating, capped,
// preset-aware. Shared by the charge, the participant display and the Builder.
export * from './wrongAnswerPenalty';
// Pause-clock tasks (change: pause-clock-tasks) — the single, server-authoritative
// definition of the excluded duration and the adjusted elapsed time.
export * from './pausedClock';
export * from './guardianConsent';
export * from './safeZone';
export * from './shareBranding';
export * from './podium';
export * from './challenge';
export * from './streak';
export * from './tv';
export * from './hotZone';
export * from './discoveryPoi';
export * from './runRecap';
export * from './runReplay';
export * from './importSheet';
export * from './runBrand';
export * from './translateFields';
export * from './benchmark';
export * from './playtest';
export * from './runAnalytics';
export * from './runSummary';
export * from './runEmailEligibility';
export * from './runDigest';
export * from './reactions';
export * from './schedule';
export * from './gating';
export * from './env';
// Firebase App Check wiring decision (change: app-check-ready) — READY BUT DARK:
// never in an emulator build, never without a site key, enforcement opt-in.
export * from './appCheck';
export * from './webhookPayload';
export * from './narrative';
export * from './gameInstructions';
export * from './movementHeatmap';
export * from './playerProfile';
export * from './trackable';
export * from './captureZone';
export * from './hintEscalation';
export * from './ordering';
export * from './survey';
// Per-interaction default task durations (change: task-duration-defaults).
export * from './taskDuration';
export * from './taskEstimate';
export * from './feedReactions';
export * from './feedReports';
export * from './feedMute';
export * from './ceremony';
export * from './announcements';
export * from './powerUps';
export * from './qrPayload';
export * from './chat';
export * from './mediaKinds';
export * from './photoQueue';
export * from './storedDocs';
export * from './gameStats';
export * from './sanitizeFinite';
export * from './locationLeak';
export * from './runCapacity';
export * from './taskCompletability';
export * from './mutualExclusion';
// Skipping ONE mission for ONE team (change: skip-single-task) — the decision that
// keeps the skip inside the stage and keeps the stage winnable afterwards.
export * from './taskSkip';
export * from './templateWizard';
export * from './videoDuration';
export * from './playStore';
// Game trash / tombstone lifecycle (change: recoverable-game-deletion).
export * from './gameLifecycle';
// Creator-owned portable game file (change: game-file-export-import).
export * from './gameFile';
// THE one definition of a tag list — split/trim/dedupe/cap (change: game-task-tags).
// Shared so the client parser and the server guard can never disagree.
export * from './tags';
// Live per-run task availability — the pause/close/resume decision both the
// routing filters and the run console read (change: live-task-pause).
export * from './liveTaskStatus';
// Test mode / assessment mode (change: test-mode-hidden-scoring) — the seal
// predicate, the participant team projection (a SECURITY boundary, not chrome)
// and the accuracy-derived routing strength.
export * from './testMode';
// Admin-managed game templates (change: admin-manage-game-templates) — the
// sibling-emoji/order-match predicate shared by setGameTemplateFlag and its test.
export * from './gameTemplates';
// In-memory gallery FACET filters applied after the tags DB query + ranking,
// before the page slice (change: gallery-facet-filters).
export * from './galleryFilter';
// Time on site accounting (change: admin-engagement-and-outreach).
export * from './engagement';
// Operator notes on a creator (change: admin-user-notes).
export * from './adminNotes';
// Admin-only creator activity rollup — pure aggregation, no Firestore/Auth I/O
// (change: admin-user-activity-dashboard).
export * from './adminUserActivity';
// Template personalization — the structural rules the new-game wizard's answers
// produce (capacity, mode, consent, pacing), applied server-side inside
// createGameFromTemplate (change: guided-new-game-wizard).
export * from './gamePersonalization';
export * from './docCachePolicy';
// Firestore op accounting + the per-run quota projection (change: spark-tier-location-load)
// — what a run costs in reads/writes, and whether it fits a fixed daily ceiling.
export * from './firestoreOpBudget';
// What a location ping is allowed to cost — the pin-write and track-retention verdicts.
// The ONLY module that can cause a position to go unrecorded, so it fails open.
export * from './locationPingEconomy';
// The OWNER-ONLY per-player run report (change: post-run-player-report) — who
// played, how they did, and mission by mission what they actually answered.
export * from './runPlayerReport';
