// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Growth & virality
// ───────────────────────────────────────────────────────────────────────────
// See v21-data-and-scalability.todo.test.ts for how to use this file.
// Maps to TECH_SPEC.md Appendix B rows 5, 6, 7, 20, 22.
import { describe, test } from 'vitest';

describe('Appendix B #5 — hostless / self-paced "play anytime" run mode (Game.pacing) [§8.A]', () => {
  // RED blueprint — one test.todo per numbered requirement in TECH_SPEC §8.A. These become the
  // failing tests written first when this change is implemented via /opsx:apply. The [pure] rows
  // (resolver) are runnable in the unit lane the moment resolvePacing() lands; the [e2e] rows extend
  // scripts/e2e-verify.mjs; the [ui] rows verify via the preview tools.
  // R1 — data model + default
  test.todo('[pure] resolvePacing(game): unset ⇒ "host" (back-compat); explicit "self_paced" ⇒ "self_paced"');
  // R2 — self-paced join launches the team
  test.todo('[e2e] self_paced joinRun launches that team: launched:true, status:active, startedAt stamped');
  test.todo('[e2e] self_paced joinRun assigns the first task via assignNextInActiveStage — no startTeams call');
  // R3 — startTeams is a safe no-op on already-launched self_paced teams
  test.todo('[e2e] startTeams on a self_paced run does NOT re-stamp startedAt or re-assign the first task');
  // R4 — per-team clock, not a shared gun
  test.todo('[e2e] self_paced scoring uses each team\'s own startedAt (teams joining apart scored independently)');
  // R5 — idempotent re-join
  test.todo('[e2e] re-calling joinRun returns {alreadyJoined:true} and never re-launches or re-stamps startedAt');
  // R6 — capacity still enforced
  test.todo('[e2e] self_paced joinRun rejects with resource-exhausted once maxParticipants is reached');
  // R7 — routing start coordinate
  test.todo('[pure] first-task assignment uses the join location, else the game start/first-task coord (no hardcoded center)');
  // R8 — finish/lifecycle unchanged
  test.todo('[e2e] a finished self_paced run still rejects new joins; finalizeRun ends it like any run');
  // R9 — host mode untouched
  test.todo('[e2e] host mode unchanged: joinRun leaves the team registered+waiting until startTeams');
  // R9 (UI) / R10 / R11
  test.todo('[ui] self_paced participants skip the "Waiting for the host…" screen and land on the first task');
  test.todo('[ui] the Builder Settings step exposes a host-driven ↔ play-anytime pacing toggle with tradeoff copy');
  test.todo('[pure] self_paced is gated behind the launch feature flag (§26.6) — dark until explicitly enabled');
});

describe('Appendix B #6 — Gemini Vision auto photo verification (visionPrompt) [§7.B, §12]', () => {
  test.todo('[pure] sanitizeTaskForParticipant strips visionPrompt + visionThreshold (server-secret)');
  test.todo('[pure] verdict mapper: confidence >= visionThreshold → auto-pass; below → route to staff queue');
  test.todo('[e2e] a photo scoring above threshold auto-completes the task (never enters the staff queue)');
  test.todo('[e2e] a low-confidence photo lands in the staff review queue as a fallback');
  test.todo('[e2e] the Gemini call is mocked in the emulator (no live API key needed for e2e)');
  test.todo('[pure] GEMINI_API_KEY is read server-side only; never present in any VITE_* / client payload');
});

describe('Appendix B #7 — QR-enabled story cards [§14.A]', () => {
  test.todo('[pure] story-card QR target resolves to <play-url>/?game=<gameId> (promo) or ?code=<accessCode> (joinable)');
  test.todo('[pure] QR is generated client-side via the existing qrcode lib (no server round-trip, no static asset)');
  test.todo('[ui] the rendered card shows a high-contrast, brand-tinted, scannable QR chip');
  test.todo('[ui] scanning the card QR opens the promo/join page for that game');
});

describe('Appendix B #20 — PWA Web Push notifications [§21]', () => {
  test.todo('[pure] subscription payload shape stored per team; absent/denied → graceful no-op');
  test.todo('[e2e] startTeams / stage-unlock / pushAnnouncement enqueue an FCM push to subscribed teams');
  test.todo('[e2e] a team without a push subscription is skipped without error');
  test.todo('[ui] permission prompt appears on join/start; denial does not block play');
  test.todo('[ui] a background notification deep-links back into the active run');
});

describe('Appendix B #22 — creator post-run analytics dashboard [§10, §17]', () => {
  // Pure aggregation over finished-run team data → the dashboard payload.
  test.todo('[pure] computeRunAnalytics: median/p90 time per task across teams');
  test.todo('[pure] computeRunAnalytics: per-stage completion rate + drop-off (stuck-stage heatmap input)');
  test.todo('[pure] computeRunAnalytics: hint-usage and skip counts per task');
  test.todo('[e2e] getRunAnalytics is owner-only and returns the aggregate for a finished run');
  test.todo('[e2e] analytics respect PII retention: available from aggregates even after pruneRunPII');
  test.todo('[ui] the dashboard renders the heatmap + time-per-task table (Pro-gated surface)');
});
