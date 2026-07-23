import { callable } from './firebase';
import type { RunTeam, GameBranding, RunLeaderboard, LeaderboardEntry, Task, RegistrationField, GameRequirement, RunRecap, HotZone, PlayerProfile, Trackable, CaptureZone, CeremonyFeedItem, ScoringPreset, GameInstructions, AnswerCostDisplay } from '@rushpoint/shared';

// Cross-run player profile (change: player-profile-badges).
export const getMyProfile = callable<Record<string, never>, { profile: PlayerProfile }>('getMyProfile');

// Marketplace instant play (change: marketplace-instant-play).
export const startInstantPlay = callable<
  { gameId: string; displayName?: string },
  { ownerUid: string; gameId: string; runId: string; accessCode: string }
>('startInstantPlay');

// Trackable collectibles (change: trackable-collectibles).
type TrackableCtx = { ownerUid: string; gameId: string; runId: string };
export const getRunTrackables = callable<TrackableCtx, { trackables: Trackable[] }>('getRunTrackables');
export const pickUpTrackable  = callable<TrackableCtx & { trackableId: string; taskId?: string }, { ok: boolean; trackable: Trackable }>('pickUpTrackable');
export const dropTrackable    = callable<TrackableCtx & { trackableId: string; taskId?: string }, { ok: boolean; trackable: Trackable }>('dropTrackable');

// Territory / contested-zone capture (change: territory-capture).
export const getRunZones = callable<TrackableCtx & { code?: string }, { zones: CaptureZone[] }>('getRunZones');
export const captureZone = callable<TrackableCtx & { zoneId: string; lat: number; lng: number }, { ok: boolean; zone: CaptureZone }>('captureZone');

export interface JoinInfo {
  context: { ownerUid: string; gameId: string; runId: string };
  title: string;
  description: string;
  mode: 'individual' | 'team';
  branding: GameBranding | null;
  registrationFields: RegistrationField[];
  runStatus: string;
  // Test-drive (rehearsal) run flag (change: test-drive-mode): play-web shows a
  // persistent "TEST RUN" banner while playing one. Absent on normal runs → false.
  isTestDrive?: boolean;
  // Accurate GPS requirement derived from task trigger modes (change:
  // fix-live-launch-demo-text). Optional until the server populates it.
  requirement?: GameRequirement;
}
export const getJoinInfo = callable<{ code: string }, JoinInfo>('getJoinInfo');

// Challenge-a-friend teaser: server-checked, non-scoring answer. Returns only
// whether the answer is correct — the key never reaches the client.
export const checkChallengeAnswer = callable<
  { gameId: string; taskId: string; answer: string },
  { correct: boolean }
>('checkChallengeAnswer');

export interface PublicLeaderboard {
  title: string;
  branding: GameBranding | null;
  runStatus: string;
  published: boolean;
  frozen: boolean;
  updatedAt: string | null;
  rankings: LeaderboardEntry[];
  // Ceremony mode (change: ceremony-mode): server-selected top-liked feed photos,
  // published-gated; [] for unpublished/legacy/pruned runs.
  ceremonyFeed: CeremonyFeedItem[];
  // The `time_only` preset's `score` is a meaningless placeholder (e.g. 500/0) —
  // teams are ranked by time, not points. Public/TV leaderboard surfaces should
  // hide the score column and show elapsed time instead when this is `time_only`.
  scoringPreset: ScoringPreset;
}
export const getPublicLeaderboard = callable<{ code: string }, PublicLeaderboard>('getPublicLeaderboard');

export interface RunRecapResult extends RunRecap {
  title: string;
  branding: GameBranding | null;
  runStatus: string;
  published: boolean;
}
export const getRunRecap = callable<{ code: string }, RunRecapResult>('getRunRecap');

export interface JoinResult {
  teamId: string; runId: string; gameId: string; ownerUid: string; alreadyJoined: boolean;
}
export const joinRun = callable<
  { code: string; displayName: string; registrationData?: Record<string, unknown>; memberNames?: string[] },
  JoinResult
>('joinRun');

// Sanitized task shape returned to participants — every answer key is stripped
// server-side (secretCode, hint text, quiz answers, numeric target, step answers).
export type SafeTask = Omit<Task, 'smart' | 'hint' | 'answers' | 'numericAnswer' | 'steps' | 'coordinates' | 'title' | 'type'> & {
  // play-task-gating: a SEALED hidden-location task (see `arrivalPending`) ships
  // as a stub with NO title and NO type — the client must render the clue card
  // and must never assume these exist. They return the moment the server
  // confirms arrival.
  title?: string;
  type?: Task['type'];
  // play-task-gating: true while a hidden-location task has not yet been
  // unsealed by `reportArrival`. Everything but the clue is absent from the
  // payload — this is not a UI-level hide.
  arrivalPending?: boolean;
  hasHint?: boolean;
  hintPenalty?: number;
  // Hint auto escalation: server-computed display flag — the paid hint is FREE
  // right now (time or wrong-attempt threshold met). The charge decision is
  // re-made server-side inside requestTaskHint, so this can never mischarge.
  hintFreeNow?: boolean;
  // Wrong-answer cost (change: wrong-answer-cost): server-computed, display-only.
  // Present only on the team's ACTIVE graded task and only when the creator set a
  // cost level, so a game authored before this change never carries it. Derived
  // from the team's own progress; it says what a wrong answer COSTS, never what
  // the answer is.
  answerCost?: AnswerCostDisplay;
  // Hidden-location tasks have their coordinates stripped server-side and carry
  // `locationHidden`; the client suppresses the pin and shows `locationClue`.
  coordinates?: Task['coordinates'];
  locationHidden?: boolean;
  steps?: { id: string; prompt: string }[];
  smart?: {
    enabled: boolean;
    verificationType: 'code_verification' | 'photo_upload';
    longInstructions?: string;
    codeInputLabel?: string;
    hasCode?: boolean;
    autoApprove?: boolean;
    // audio-tasks: on a photo task, capture an audio clip instead of a photo.
    captureKind?: 'photo' | 'audio';
    stationCoords?: { lat: number; lng: number };
    // How many wrong answers this task allows before submitTaskAnswer refuses
    // with 'resource-exhausted'. Already shipped by sanitizeTaskForParticipant;
    // the client needs it so a single mis-tap can't silently spend one
    // (change: play-touch-rtl-a11y).
    attemptLimit?: number;
  };
};

export interface StoryBeatSafe { title?: string; body?: string; bodyHe?: string; imageUrl?: string }
export interface StageNarrative {
  stageId: string;
  order: number;
  title: string;
  status: 'active' | 'completed';
  narrative: { intro?: StoryBeatSafe; outro?: StoryBeatSafe };
}

export interface MyTeamState {
  team: RunTeam;
  // Why this team has not been started, or null when nothing is holding it
  // (change: held-team-visibility). A REASON only: no guardian name, contact or
  // token. Optional on the wire so a console/app talking to a backend that
  // predates it degrades to "nothing known", never to a fabricated hold.
  holdReason?: 'guardian_consent' | null;
  run: { id: string; status: string; accessCode: string; billingType: 'free' | 'credit' | 'pro'; launchedAt?: string | null; leaderboard: RunLeaderboard | null; hotZone: HotZone | null };
  game: { id: string; title: string; mode: string; scoringPreset: string; branding: GameBranding | null; stageCount: number; photoFeedEnabled?: boolean; instructions?: GameInstructions | null };
  activeStageTasks: SafeTask[];
  // Completed-mission pins (change: hidden-mission-map): the coordinates + title of
  // every mission this team has ALREADY COMPLETED, across all stages — a trail of
  // where they've been. Built server-side by construction from completed task
  // records only, so it can never carry a hidden-not-arrived / unassigned / sealed
  // task's location. The play map plots these + the client's own GPS while the
  // active mission is a still-sealed hidden target. Locationless/coordinate-less
  // completed tasks are omitted, so this can be shorter than the completed count.
  completedTaskPins: { id: string; coordinates: { lat: number; lng: number }; title: string }[];
  // wave-f (next-task-regression, Bug A): ids of active-stage tasks that are
  // GENUINELY gated (release-scheduled and not yet released, or unlock-gated with
  // an unmet prerequisite) — i.e. routing cannot hand them out yet. Ids only, no
  // content. The play UI uses this to distinguish "all remaining tasks are locked"
  // from "unassigned because routing hasn't picked one yet", since wave D omits
  // non-assigned task content from `activeStageTasks`.
  lockedTaskIds?: string[];
  // Narrative chapters: intro/outro beats for stages the team has reached (active or
  // completed). The play UI shows an intro when a chapter opens, an outro when it ends.
  stageNarratives?: StageNarrative[];
  // Scheduled-release: when the team is waiting on a timed stage "drop", the ms
  // epoch it unlocks (else null) — drives the "next chapter unlocks in…" countdown.
  nextStageReleaseAt?: number | null;
  // Shared team devices: this caller's role on the team (controller = may
  // submit; viewer = read-only until control is transferred/claimed).
  myRole: 'controller' | 'viewer' | null;
  context: { ownerUid: string; gameId: string; runId: string };
}
export const getMyTeamState = callable<
  { ownerUid?: string; gameId?: string; runId?: string; code?: string },
  MyTeamState
>('getMyTeamState');

type Ctx = { ownerUid: string; gameId: string; runId: string };

// `reason` explains why routing handed back no task: 'stationsFull' (transient —
// every eligible station is at cap; wait and retry), 'allLocked' (only gated
// tasks remain), or 'none'. `already` marks an idempotent replay (WO-3).
export type NoAssignmentReason = 'stationsFull' | 'allLocked' | 'none';

// Safe-zone verdicts (`evaluateSafeZoneStatus`). `requestNextTask` reuses `reason`
// for them when it answers `outOfBounds: true`, so the two spaces are distinguished
// by that flag, never by the string. Typed as an open string on the wire because the
// server may be a version ahead; `blockedGuidance()` is the total mapping.
export type SafeZoneBlockReason =
  | 'outside' | 'low_confidence' | 'stale_fix' | 'no_fix' | 'invalid_fix'
  | 'override' | 'inside' | 'no_zone' | 'unverifiable';

export const completeTask = callable<
  Ctx & { taskId: string; lat?: number; lng?: number },
  { ok: boolean; nextTaskId: string | null; already?: boolean; nextReason?: NoAssignmentReason | null }
>('completeTask');

export const requestNextTask = callable<
  Ctx & { lat?: number; lng?: number },
  {
    taskId: string | null;
    reason?: NoAssignmentReason | SafeZoneBlockReason | (string & {}) | null;
    // Safe-zone soft-pause: the server refused to route because the team is out of
    // bounds. `metersOutside` is metres BEYOND the boundary (never the zone itself),
    // present only on a confirmed breach.
    outOfBounds?: boolean;
    metersOutside?: number | null;
  }
>('requestNextTask');

export const requestTaskHint = callable<
  Ctx & { taskId: string },
  { hint: string; penalty: number; alreadyUsed: boolean; free?: boolean }
>('requestTaskHint');

// play-task-gating: ask the server whether we have ARRIVED at a hidden-location
// task. The server re-checks GPS against the secret coordinates with the same
// rule as a check-in and latches the verdict, so a reload / GPS dropout can
// never re-seal a spot the team already found. Never returns a distance.
export const reportArrival = callable<
  Ctx & { taskId: string; lat?: number; lng?: number },
  { arrived: boolean; reason?: string }
>('reportArrival');

export const submitTaskAnswer = callable<
  // quiz/numeric take `answer`; an ordering quiz takes `orderedAnswer` (the
  // player's arrangement) instead — the server rejects a mixed/missing payload.
  Ctx & { taskId: string; answer?: string; orderedAnswer?: string[]; lat?: number; lng?: number },
  {
    correct: boolean;
    nextTaskId?: string | null;
    // Wrong-answer cost (change: wrong-answer-cost). Present on the wrong path
    // only, and only when the creator set a cost level. `penalty` is the points
    // just charged (always 0 under the time_only preset, which has no points),
    // `retryAfterMs` drives the retry countdown, and `replay` marks a duplicate
    // submission that was deliberately NOT charged.
    penalty?: number;
    // retry-lockout-clock-skew: milliseconds LEFT, computed server-side against
    // the server clock. The client turns it into a deadline on its OWN clock, so
    // a device with a wrong clock still counts down the right number of seconds.
    retryAfterMs?: number;
    // Deprecated: an ABSOLUTE server instant. Comparing it to the device clock is
    // the bug retry-lockout-clock-skew removed. Kept only as a fallback for a
    // server that has not been redeployed yet.
    cooldownUntil?: number;
    retryAfterSeconds?: number;
    attemptsUsed?: number;
    replay?: boolean;
  }
>('submitTaskAnswer');

export const submitSequenceStep = callable<
  Ctx & { taskId: string; stepIndex: number; answer?: string; lat?: number; lng?: number },
  { stepCorrect: boolean; stepsDone: number; totalSteps: number; taskComplete: boolean }
>('submitSequenceStep');

export const verifyStationCode = callable<
  Ctx & { teamId: string; taskId: string; code: string },
  { verified: boolean }
>('verifyStationCode');

export const submitStationPhoto = callable<
  // audio-tasks: contentType is optional (photo clients may omit it) and is
  // validated server-side against the task's captureKind.
  Ctx & { teamId: string; taskId: string; photoUrl: string; contentType?: string },
  { submitted: boolean; autoApproved: boolean }
>('submitStationPhoto');

// Not idempotent — creates a fresh auto-id alert doc each call, so a retry after
// a timeout would post a DUPLICATE SOS. Opt out of the client retry wrapper.
export const triggerSOS = callable<
  Ctx & { lat?: number; lng?: number; message?: string },
  { alertId: string }
>('triggerSOS', { retry: false });

// `accuracyMeters` is the fix's own error radius (change: out-of-bounds-recovery). It
// is REPORTING, not authority: the server still decides whether a team is out of
// bounds — it just stops treating a 500 m-accuracy fix as proof of a 5 m violation.
export const updateLocation = callable<Ctx & { lat: number; lng: number; accuracyMeters?: number }, { ok: boolean }>('updateLocation');

// ── Team ↔ HQ chat (change: team-hq-chat) ──
// Participants (any attached device, no controller gating like SOS) send with just
// text — the server resolves their team and sets from:'team'. The STAFF console
// (also hosted in play-web) sends as HQ with an explicit teamId + senderName; the
// server enforces the role, so these fields are optional on the wrapper.
export const sendTeamChatMessage = callable<
  Ctx & { text: string; teamId?: string; senderName?: string },
  { messageId: string }
>('sendTeamChatMessage');

// ── Shared team devices (change: shared-team-devices) ──
// Attach this phone to an existing team via the run access code + the team's
// device join code (shown on the phones already attached).
export const joinTeamAsDevice = callable<
  { code: string; teamCode: string; memberName?: string },
  { ownerUid: string; gameId: string; runId: string; teamId: string; role: 'controller' | 'viewer' | null; alreadyAttached: boolean }
>('joinTeamAsDevice');

export const transferController = callable<
  Ctx & { toUid: string },
  { ok: boolean; controllerUid: string }
>('transferController');

export const claimController = callable<Ctx, { ok: boolean; controllerUid: string }>('claimController');

// ── Post-game feedback (change: post-game-feedback) ──
// One survey response per player; the server rejects a repeat with already:true.
export const submitRunFeedback = callable<
  Ctx & {
    ratings: Record<string, number>;
    issues?: string[];
    comment?: string;
    lang: string;
  },
  { ok: boolean; already: boolean }
>('submitRunFeedback');

// ── Live photo feed (change: live-photo-feed) ──
// One emoji reaction per uid per item; re-reacting switches the emoji.
export const reactToFeedItem = callable<
  Ctx & { itemId: string; emoji: string },
  { ok: boolean; changed: boolean; reactions: Record<string, number> }
>('reactToFeedItem');

// Staff/owner moderation: hide a feed item (listeners filter active == true).
// `restore` (change: feed-ugc-safety) reverses a hide (auto or staff) and
// disarms future auto-hiding for the item; authz is unchanged (staff/owner).
export const hideFeedItem = callable<
  Ctx & { itemId: string; restore?: boolean },
  { ok: boolean }
>('hideFeedItem');

// Any run participant (or staff/owner) reports a feed item from a closed
// reason set (change: feed-ugc-safety). Idempotent per caller's team; a
// second distinct team's report may auto-hide the item (`hidden: true`).
export const reportFeedItem = callable<
  Ctx & { itemId: string; reason: 'inappropriate' | 'harassment' | 'privacy' | 'other' },
  { ok: boolean; reportCount: number; hidden: boolean }
>('reportFeedItem');

export const staffSignIn = callable<
  // `name` is the staffer's self-declared display name (attribution only — the
  // server treats it as untrusted and it grants nothing). Omitted ⇒ the invite's name.
  { ownerUid: string; gameId: string; runId: string; pin: string; name?: string },
  { customToken: string; name: string; permissions: string[] }
>('staffSignIn');

// ── Staff console actions ──
export const reviewStationSubmission = callable<
  Ctx & { teamId: string; taskId: string; approved: boolean; note?: string },
  { ok: boolean; approved: boolean }
>('reviewStationSubmission');

export const acknowledgeAlert = callable<
  Ctx & { alertId: string },
  { ok: boolean }
>('acknowledgeAlert');

export const pushAnnouncement = callable<
  Ctx & { message: string; messageHe?: string },
  { announcementId: string }
>('pushAnnouncement');

// Manual bonus / deduction from the staff console (server-authoritative; the
// staff custom token satisfies assertStaffOrOwner). Positive delta = bonus.
export const adjustTeamScore = callable<
  Ctx & { teamId: string; delta: number; reason?: string },
  { ok: boolean; newBonusPenalty: number }
>('adjustTeamScore');
