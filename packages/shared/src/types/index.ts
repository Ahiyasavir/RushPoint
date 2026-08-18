import type { MediaKind } from '../mediaKinds';

// ═══════════════════════════════════════════════════════════════════════════════
// @rushpoint/shared — v2 Platform types
//
// Firestore path convention:
//
//   users/{uid}/games/{gameId}                               ← Game template
//   users/{uid}/games/{gameId}/runs/{runId}                  ← Live run
//   users/{uid}/games/{gameId}/runs/{runId}/teams/{teamId}   ← Participant state
//   publicGames/{gameId}                                     ← Gallery index
//   publicTasks/{taskId}                                     ← Task library
//   wallets/{uid}                                            ← Creator wallet
//   wallets/{uid}/transactions/{txId}
//   accessCodes/{code}                                       ← Join codes
//   auditLogs/{id}
// ═══════════════════════════════════════════════════════════════════════════════


// ─── Firestore path helpers ───────────────────────────────────────────────────

export const COLLECTIONS = {
  // Creator-scoped
  GAMES:         'games',
  RUNS:          'runs',
  TEAMS:         'teams',
  STAFF_INVITES: 'staffInvites',

  // Public gallery
  PUBLIC_GAMES:  'publicGames',
  PUBLIC_TASKS:  'publicTasks',
  // One like per (kind, item, user) — see FIRESTORE_PATHS.publicLike.
  PUBLIC_LIKES:  'publicLikes',

  // Payments
  WALLETS:      'wallets',
  TRANSACTIONS: 'transactions',

  // Join codes
  ACCESS_CODES: 'accessCodes',

  // Smart stations
  STATION_SECRETS: 'stationSecrets',
  STATION_REVIEWS: 'stationReviews',

  // Live ops (per run, nested under run doc as sub-collections or fields)
  ANNOUNCEMENTS:  'announcements',
  ADMIN_ALERTS:   'adminAlerts',
  TEAM_LOCATIONS: 'teamLocations',
  FLASH_MISSIONS: 'flashMissions',

  // Audit
  AUDIT_LOGS: 'auditLogs',
} as const;

export const FIRESTORE_PATHS = {
  game:       (ownerUid: string, gameId: string) =>
    `users/${ownerUid}/games/${gameId}`,

  run:        (ownerUid: string, gameId: string, runId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}`,

  team:       (ownerUid: string, gameId: string, runId: string, teamId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`,

  teamsCol:   (ownerUid: string, gameId: string, runId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/teams`,

  staffInvite: (ownerUid: string, gameId: string, runId: string, inviteId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/staffInvites/${inviteId}`,

  publicGame:  (gameId: string) => `publicGames/${gameId}`,
  publicTask:  (taskId: string) => `publicTasks/${taskId}`,

  // Public-content likes (change: gallery-popularity-ranking). The document id is
  // DERIVED from (kind, itemId, uid), so "one like per user per item" is a
  // property of the address itself — a second like from the same user resolves to
  // the same document and cannot create a second record, whatever the client
  // sends. Server-write-only; clients can neither read nor write this collection
  // (like state is served back through the gallery search callables).
  publicLike:    (kind: 'game' | 'task', itemId: string, uid: string) =>
    `publicLikes/${kind}_${itemId}_${uid}`,
  publicLikesCol: () => 'publicLikes',

  // Hidden geofenced discovery POIs on a game (surprise-trivia-waypoints).
  // Creator read/write; play clients denied (coordinates are server-secret).
  discoveryPoisCol: (ownerUid: string, gameId: string) =>
    `users/${ownerUid}/games/${gameId}/discoveryPois`,
  discoveryPoi: (ownerUid: string, gameId: string, poiId: string) =>
    `users/${ownerUid}/games/${gameId}/discoveryPois/${poiId}`,

  wallet:      (uid: string) => `wallets/${uid}`,
  transaction: (uid: string, txId: string) => `wallets/${uid}/transactions/${txId}`,

  accessCode:  (code: string) => `accessCodes/${code}`,

  runAnnouncement: (ownerUid: string, gameId: string, runId: string, id: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/announcements/${id}`,

  runAlert: (ownerUid: string, gameId: string, runId: string, id: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/adminAlerts/${id}`,

  // Team ↔ HQ chat (change: team-hq-chat): one thread doc per team, server-write
  // only. Participants read their own doc; staff/owner read the collection.
  runChat: (ownerUid: string, gameId: string, runId: string, teamId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/chat/${teamId}`,
  runChatCol: (ownerUid: string, gameId: string, runId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/chat`,

  // Staff ↔ admin channel (change: staff-console-field-ops): ONE shared thread per
  // run — a singleton doc, not a collection, because there is exactly one channel
  // (unlike runChat, which is one thread per team). Server-write only; the owner and
  // any token carrying this run's staff claims may read it. Participants may not.
  runStaffChannel: (ownerUid: string, gameId: string, runId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/staffChannel/thread`,

  // Device-membership reverse index (fix: shared-team-devices live-ops read).
  // A secondary phone attached via joinTeamAsDevice has NO team doc of its own —
  // its uid only lives inside the FOUNDER's `deviceUids` array. firestore.rules
  // cannot query a collection, so from an announcement/flashMission/feedItem doc
  // there is no way to ask "is this uid in ANY team's deviceUids in this run"
  // (isAttachedDevice() works on the team + chat docs only because deviceUids is
  // on the very document being read). This marker is that missing reverse index:
  // one tiny doc keyed by the DEVICE uid that rules can `exists()` in O(1).
  // Server-write-only; holds {teamId, joinedAt} — no PII, so it is not part of
  // the retention prune's PII_BULK_SUBCOLLECTIONS.
  runDeviceMember: (ownerUid: string, gameId: string, runId: string, deviceUid: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/deviceMembers/${deviceUid}`,
  runDeviceMembersCol: (ownerUid: string, gameId: string, runId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/deviceMembers`,

  teamLocation: (ownerUid: string, gameId: string, runId: string, teamId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/teamLocations/${teamId}`,

  stationSecret: (taskId: string) => `stationSecrets/${taskId}`,

  stationReview: (reviewId: string) => `stationReviews/${reviewId}`,

  auditLog: (id: string) => `auditLogs/${id}`,

  // Per-uid callable rate-limit counters (change: callable-rate-limiting, Appendix B #19).
  // Server-write-only; clients are denied read + write in firestore.rules.
  rateLimit: (bucket: string, uid: string) => `rateLimits/${bucket}__${uid}`,

  // Post-game feedback (change: post-game-feedback): one response per player uid,
  // written only by submitRunFeedback, owner-read-only. Dies with the run in the
  // 90-day PII prune (it holds free text).
  feedback: (ownerUid: string, gameId: string, runId: string, uid: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/feedback/${uid}`,
  feedbackCol: (ownerUid: string, gameId: string, runId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/feedback`,

  // Live photo feed (change: live-photo-feed): server-written on photo approval,
  // any authed participant reads (announcements pattern); reactions go through
  // reactToFeedItem. Pruned with the run's PII (holds photo URLs + team names).
  feedItem: (ownerUid: string, gameId: string, runId: string, id: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems/${id}`,
  feedItemsCol: (ownerUid: string, gameId: string, runId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems`,
} as const;


// ─── Primitive types ──────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type GameMode        = 'individual' | 'team';
export type ScoringPreset   = 'time_only' | 'fixed_points_speed' | 'smart_weighted';
export type TaskType        = 'field' | 'smart_station' | 'photo' | 'self_report'
                            | 'quiz' | 'numeric' | 'geofence' | 'sequence' | 'survey';
// How a task is triggered/completed (change: task-trigger-modes). Default 'radius'.
//   radius       — fires within a creator-set radius (default 40m, editable)
//   exact        — fires only on precise arrival (tight default 4m, editable)
//   instant      — fires immediately on stage advance, no GPS/proximity check
//   locationless — purely digital, no map pin, no geospatial gate
export type TriggerMode     = 'radius' | 'exact' | 'instant' | 'locationless';
// Accurate play-anywhere vs GPS-required indicator for a game's welcome screen
// (change: fix-live-launch-demo-text), derived from task trigger modes.
export type GameRequirement = 'gps' | 'anywhere';
export type StageStatus     = 'locked' | 'active' | 'completed';
export type TaskStatus      = 'unassigned' | 'assigned' | 'completed' | 'skipped';
export type RunStatus       = 'draft' | 'live' | 'finished';
export type TeamStatus      = 'registered' | 'active' | 'finished';
export type FieldType       = 'text' | 'number' | 'phone' | 'checkbox' | 'select';
export type FieldLevel      = 'team' | 'member';
export type Visibility      = 'private' | 'public';
export type AccessCodeStatus = 'unused' | 'used' | 'revoked';
// `manage_teams` (change: staff-console-field-ops) covers the four actions that can
// materially change a team's outcome from the field console: hold/resume, an
// arbitrary-amount score adjustment, clearing out-of-bounds, and force-assigning a
// task. Deliberately ONE coarse flag rather than four — the desktop run console
// already trusts any authenticated staffer with the three that predate this change,
// so a single new permission is a net tightening, not a new axis of restriction.
export type StaffPermission = 'announce' | 'review_photos' | 'track_locations' | 'manage_teams';
export type AlertType       = 'sos' | 'technical' | 'stationary';
export type AnnouncementLevel = 'info' | 'warning' | 'critical';
export type VerificationType  = 'code_verification' | 'photo_upload';
export type StationSubmissionStatus = 'pending' | 'approved' | 'rejected';
export type VerifyOutcome   = 'correct' | 'wrong' | 'too-far' | 'limit-exceeded';
export type StationStatus   = 'active' | 'paused' | 'closed';
// Event-Credits billing model. Legacy 'topup'/'charge' are retained so wallet
// docs written before the migration still deserialize cleanly.
export type TransactionType =
  | 'topup_credits'      // bought Event Credits
  | 'charge_event'       // spent 1 credit launching a run
  | 'pro_subscription'   // Creator Pro payment
  | 'referral'           // referral reward (now a free run)
  | 'free_run_consumed'  // a lifetime free run was used ($0 log)
  | 'topup' | 'charge';  // legacy
export type AuditActionType = 'fine' | 'score_override' | 'skip' | 'evacuation' | 'manual_unlock';


// ─── Registration fields ──────────────────────────────────────────────────────

export interface RegistrationField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  level: FieldLevel;
  options?: string[];        // for 'select' fields
}

/** Default registration fields for a new game (just the required member name). */
export const DEFAULT_REGISTRATION_FIELDS: RegistrationField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true, level: 'member' },
];


// ─── Smart Station Config ─────────────────────────────────────────────────────
// Unchanged from v1. `manual_judge` type removed — only automated verification.

export interface SmartStationConfig {
  enabled: true;
  verificationType: VerificationType;

  longInstructions?: string;
  longInstructionsHe?: string;
  extraInfo?: string;
  mediaUrl?: string;
  imageUrl?: string;
  adminNotes?: string;

  timeLimitSeconds?: number;
  canSkip?: boolean;
  autoCompleteOnSuccess?: boolean;
  autoApprove?: boolean;   // photo_upload: approve without staff review (staffless events)
  // audio-tasks / video-submission-task: on a photo-type task, capture an audio or
  // video clip instead of a photo (rides the same ingest/review pipeline). Default
  // absent = 'photo'; only meaningful on photo-type tasks. NOT secret — the client
  // needs it to render the right capture widget, so the sanitizer must pass it through.
  captureKind?: 'photo' | 'audio' | 'video';
  // captureKind 'video' only: the creator's clip-length range, bounded by
  // VIDEO_DURATION_LIMITS (packages/shared/src/videoDuration.ts). Participant-visible
  // by necessity — the recorder cannot enforce a limit it cannot see.
  videoMinSeconds?: number;
  videoMaxSeconds?: number;

  geofenceRadiusMeters?: number;
  stationCoords?: GeoPoint;  // injected by assignTask; never authored

  codeInputLabel?: string;
  hasCode?: boolean;
  secretCode?: string;     // code_verification: the expected code. Owner-only — never
                           // copied into publicTasks and never returned to participants.
  attemptLimit?: number;
  hintCount?: number;

  photoReviewRequired?: boolean;
  allowRetry?: boolean;

  showIntroScreen?: boolean;
  showSuccessScreen?: boolean;
  showFailureScreen?: boolean;
  showPendingReviewScreen?: boolean;
  showHintsOverTime?: boolean;
}


// ─── Task ─────────────────────────────────────────────────────────────────────
// Embedded inside Stage (not a top-level Firestore document in a game template).
// At run time, tasks are indexed into RunTaskRecord by their id.

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  coordinates: GeoPoint;
  difficulty: number;            // 1–10
  estimatedMinutes: number;
  expectedDurationMinutes?: number;  // for Dynamic Time Bonus calculation
  pointValue: number;
  maxConcurrentTeams: number;   // default 3
  currentTeamCount?: number;    // runtime counter maintained per run (not on template)
  status?: StationStatus;       // operator override: paused/closed
  maxDurationMinutes?: number;  // staff warning threshold
  smart?: SmartStationConfig;
  // How this task is triggered (change: task-trigger-modes). Default 'radius'.
  // `geofenceRadiusMeters` carries the radius for 'radius'/'exact'. The
  // `locationless` boolean below is kept in sync (triggerMode==='locationless'
  // ⇔ locationless===true) for backward compatibility. Use normalizeTriggerMode()
  // to resolve the effective mode for legacy tasks (no triggerMode set).
  triggerMode?: TriggerMode;
  // A general task with no fixed map location — can be done from anywhere
  // (no travel, no map marker, no distance). Routing treats transit as zero.
  locationless?: boolean;
  // Hidden-location (treasure-hunt) flag: the task keeps real `coordinates` +
  // geofence radius SERVER-SIDE, but they are NEVER sent to the participant —
  // sanitizeTaskForParticipant strips them and emits `locationHidden`. The map
  // draws no pin; the player is guided only by `locationClue` and discovers the
  // spot by physically arriving (server-validated GPS, radius/exact trigger).
  // Orthogonal to TaskType — layers on any located task. Default absent = visible.
  hideLocation?: boolean;
  // The free, ALWAYS-VISIBLE clue/riddle that guides discovery of a hidden
  // location (bilingual). Distinct from the paid `hint` below: the clue is sent
  // to the participant in the task payload; the paid `hint` text is stripped and
  // only revealed for a point cost via requestTaskHint.
  locationClue?: string;
  locationClueHe?: string;
  // Optional paid hint: participants can reveal `hint` for a `hintPenalty`
  // point cost (default 25). The hint text is NEVER sent to clients in the task
  // payload — only via the requestTaskHint callable, which charges once.
  hint?: string;
  hintPenalty?: number;
  // Hint auto escalation (change: hint-auto-escalation): the paid hint becomes
  // FREE once the team has held the task ≥ N minutes (from RunTaskRecord.startedAt,
  // server clock — never a client clock) OR has recorded ≥ N wrong attempts
  // (team.taskAttempts[taskId]). OR semantics — either threshold met frees it;
  // evaluated server-side via isHintFree(). Fractional minutes honored. The
  // thresholds carry no secret (they never reveal the hint text) → sanitizer
  // passthrough. Absent = the hint stays paid forever.
  hintAutoRevealMinutes?: number;
  hintAutoRevealAttempts?: number;
  // Wrong-answer cost (change: wrong-answer-cost): per-task override of the game's
  // `scoringOptions.wrongAnswerPenalty`, so one brutal final riddle can be stricter
  // than the warm-up. Absent = inherit the game level (which itself defaults to
  // `off`). Carries no secret — it says what a wrong answer costs, never what the
  // answer is — so it is a sanitizer passthrough and the participant is TOLD the
  // rule before they answer.
  wrongAnswerPenalty?: WrongAnswerLevel;
  // Pause-clock tasks (change: pause-clock-tasks): while a team is on this task
  // its race clock STOPS, so hurrying buys nothing. The server measures the span
  // from its OWN stamps (RunTaskRecord.startedAt → completedAt) and subtracts it
  // from every time-derived scoring term (ranked duration, speed bonus, Z-Score);
  // under smart_weighted the task is scored on-estimate so its sigmoid multiplier
  // is time-independent. Offered on ANY task type; absent/false = today's
  // behaviour exactly, so no existing game or in-flight run changes. On a LOCATED
  // task the excluded span also covers the walk to the spot (the Builder says so).
  // Carries no secret — the player MUST be told the clock stopped, or they hurry
  // anyway — so it is a sanitizer passthrough.
  pausesTimer?: boolean;
  // ── Verification config by type. Answer keys (answers/numericAnswer/
  //    steps[].answer) are SERVER-SECRET — stripped from the participant payload. ──
  // quiz: render `choices` as buttons (if present) else a text box; correct
  //       when the answer matches any of `answers` (trimmed, case-insensitive).
  choices?: string[];
  answers?: string[];
  // quiz (ordering variant, change: quiz-ordering): 3–10 items authored in the
  // CORRECT order. The item TEXTS are public; the ORDER is the server-secret
  // answer key — sanitizeTaskForParticipant never emits the authored order, only
  // a per-team deterministically shuffled copy (seed teamId:taskId), and strips
  // the field entirely when no seed is available (fail closed). Mutually
  // exclusive with `choices`/`answers` on one task; graded via matchesOrderedAnswer.
  orderItems?: string[];
  // survey (change: survey-tasks): a no-right-answer data-collection task. When
  // `surveyChoices` (2–8 non-empty options) is present the player picks one;
  // ABSENT ⇒ a free-text response (trimmed, ≤ 500 chars). NOT a secret — there is
  // no answer key to protect, so sanitizeTaskForParticipant passes it through so
  // the choice buttons can render. Mutually exclusive with `answers`/`orderItems`/
  // `numericAnswer`. Any valid non-empty response completes the task for its fixed
  // `pointValue` (0 is a fine default — pure data collection). Validated via
  // validateSurveyResponse; the team's own response is stored on its task record
  // (RunTaskRecord.surveyResponse) — first response is final.
  surveyChoices?: string[];
  // numeric: correct when |entered − numericAnswer| ≤ numericTolerance (default 0).
  numericAnswer?: number;
  numericTolerance?: number;
  // geofence: auto-checks-in when the participant is within this radius of
  //           `coordinates` (default 50m). Server validates the GPS distance.
  geofenceRadiusMeters?: number;
  // change: quiz-location-verification. Opt-in presence gate for ANSWER tasks
  // (quiz/numeric/survey). When true AND the task has valid `coordinates`,
  // submitTaskAnswer grades only if the submitted GPS is within a LENIENT radius
  // (`geofenceRadiusMeters` or PRESENCE_DEFAULT_RADIUS_M = 150m). Default absent =
  // OFF. NOT secret — the client needs it to know it must send GPS; sanitizer
  // passes it through via `...rest`.
  requirePresence?: boolean;
  // sequence: ordered sub-steps done at one stop; the task completes after the last.
  steps?: TaskStep[];
  // General creator-authored media (images / videos / YouTube) shown with the task.
  // Orthogonal to type; validated + normalized server-side. Absent = no media.
  media?: TaskMedia[];
  // Scheduled / timed release (change: scheduled-release). When set, this task
  // becomes AVAILABLE (routable/assignable) only once released — at a wall-clock
  // instant (`releaseAt`, ISO) and/or `releaseAfterMinutes` after the run started.
  // Evaluated server-side via isReleased(); absent = available immediately. Carries
  // no secret → passed through by sanitizeTaskForParticipant for the countdown UI.
  releaseAt?: string;
  releaseAfterMinutes?: number;
  // Task expiry (change: task-expiry) — the mirror of scheduled release: minutes
  // after the run's `launchedAt` at which this task STOPS being available
  // (dropped from routing, refused by completion callables, auto-skipped when in
  // flight). Fractional minutes honored (lets tests exercise expiry without
  // waiting). Evaluated server-side via isExpired(); absent = never expires.
  // Carries no secret → sanitizer passthrough for the "expires in…" countdown UI.
  expiresAfterMinutes?: number;
  // Unlockable tasks (change: unlockable-tasks): ids of OTHER tasks in the SAME
  // stage that must ALL be completed before this one becomes available (AND
  // semantics). Evaluated server-side via isUnlocked(); validated at save time by
  // validateUnlockGraph (no self-reference / cross-stage ids / cycles). Absent or
  // empty = always unlocked. NOT a secret — the locked-task UI names its
  // prerequisites — so it passes through sanitizeTaskForParticipant.
  unlockAfterTaskIds?: string[];
  // Library metadata (for publicTasks index)
  tags?: string[];
}

// ─── Task media (change: task-media-attachments) ──────────────────────────────
// A creator-authored image / video / YouTube attachment shown to participants with
// the task instructions. Orthogonal to TaskType — MAY appear on any task type — and
// independent of the smart-station `smart.imageUrl`/`smart.mediaUrl` fields. For
// `image`/`video`, `url` is a Firebase Storage download URL (uploaded file); for
// `youtube`, `url` is the canonical `https://www.youtube.com/embed/<id>` form.
// Validated + normalized server-side by normalizeTaskMedia (see shared/validation).
// Carries no secret → passed through by sanitizeTaskForParticipant.
// (Declared AFTER Task so the sanitizer-coverage type parser resolves `Task` first.)
export interface TaskMedia {
  id: string;
  kind: 'image' | 'video' | 'youtube';
  url: string;
  caption?: string;
}

// One ordered sub-step of a `sequence` task. `answer` is server-secret (omit it
// for a simple tap-to-confirm step).
export interface TaskStep {
  id: string;
  prompt: string;
  answer?: string;
}


// ─── Stage ────────────────────────────────────────────────────────────────────
// A stage holds 1+ tasks. When tasks.length > 1, smart routing picks which task
// to assign. Stage is complete when ALL its tasks are complete.

// Narrative "beat" shown as a full card (change: narrative-chapters). Bilingual body
// (bodyHe optional; falls back to body). Not a secret — echoed to participants.
export interface StoryBeat {
  title?: string;
  body?: string;
  bodyHe?: string;
  imageUrl?: string;
}

// Game-level "How to play" primer (change: game-intro-instructions). Same shape
// as StoryBeat: bilingual body (bodyHe falls back to body) + an optional https-only
// cosmetic image. Not a secret — echoed to participants and, when the game is public,
// denormalized into publicGames. Cosmetic; never gates play.
export interface GameInstructions {
  title?: string;    // e.g. "How to play"
  body?: string;     // English / default primer text (multiline)
  bodyHe?: string;   // Hebrew primer (falls back to `body`)
  imageUrl?: string; // https-only cosmetic image (a mechanics diagram, etc.)
}

export interface Stage {
  id: string;
  order: number;
  title: string;
  tasks: Task[];
  isFinal?: boolean;  // triggers Final Run screen when completed
  // Story chapters (change: narrative-chapters). Optional intro shown when this
  // stage becomes active, and outro shown when it completes — turns a flat stage
  // into an authored chapter. Cosmetic: never gates progression.
  narrative?: { intro?: StoryBeat; outro?: StoryBeat };
  // How many of this stage's tasks each team must complete. Undefined or >=
  // tasks.length means ALL tasks. When fewer, each team is routed to the
  // best-suited subset (by distance/load/skill) and the stage completes once
  // they've finished this many — the rest are auto-skipped for that team.
  requiredTaskCount?: number;
  // Scheduled / timed release (change: scheduled-release). When set, this whole
  // stage stays LOCKED until released — at a wall-clock instant (`releaseAt`, ISO)
  // and/or `releaseAfterMinutes` after the run started. Evaluated server-side via
  // isReleased(); the next stage is only unlocked once its gate has opened. Enables
  // multi-day / timed-drop games. Absent = unlocks as soon as the prior stage ends.
  releaseAt?: string;
  releaseAfterMinutes?: number;
  // Mutually exclusive task groups (change: mutually-exclusive-tasks). Each entry
  // names a set of task ids WITHIN this stage of which a team may complete at most
  // ONE — completing any member locks the rest for that team (they are skipped, not
  // failed). Lets a creator offer "pick one of these three" alternatives without a
  // team farming every variant. Scoped to the stage: ids not present in
  // `tasks` are ignored. A task may appear in at most one group.
  exclusiveGroups?: ExclusiveTaskGroup[];
}

// One "choose at most one of these" set inside a Stage (change: mutually-exclusive-tasks).
export interface ExclusiveTaskGroup {
  id: string;
  // Task ids belonging to this stage. A group of fewer than 2 ids is inert.
  taskIds: string[];
}


// ─── Game (template) ─────────────────────────────────────────────────────────
// Stored at: users/{ownerUid}/games/{gameId}
// The canonical definition a Creator builds. Instantiated into Runs.

// Wrong-answer cost (change: wrong-answer-cost). How much a wrong answer on a
// graded task (quiz / numeric / ordering) costs the team. Four strictness levels
// so a kids' hunt and a competitive gibush can share one product. The numbers
// behind each level live in packages/shared/src/wrongAnswerPenalty.ts.
//
// ABSENT MEANS `off`, which is byte-for-byte the pre-change behavior — every game
// authored before this change keeps costing nothing, and no run in flight changes
// its rules. New games are seeded at DEFAULT_WRONG_ANSWER_LEVEL ('standard').
export type WrongAnswerLevel = 'off' | 'gentle' | 'standard' | 'strict';

export interface ScoringOptions {
  transitPenaltyEnabled?: boolean;  // exponential late penalty for distance-based stages
  sprintPenaltyEnabled?: boolean;   // exponential late penalty for timed stages
  // Game-wide default strictness for a wrong answer. A task may override it.
  wrongAnswerPenalty?: WrongAnswerLevel;
}

export interface GameBranding {
  logoUrl?: string;
  primaryColor?: string;
  name?: string;
}

export interface Game {
  id: string;
  ownerUid: string;
  title: string;
  description?: string;
  mode: GameMode;
  stages: Stage[];
  scoringPreset: ScoringPreset;
  scoringOptions?: ScoringOptions;
  registrationFields: RegistrationField[];
  branding?: GameBranding;
  visibility: Visibility;
  tags: string[];
  coverImage?: string;
  approxLocation?: GeoPoint & { label?: string };
  playCount: number;
  // Minors gate (change: guardian-consent-qr): when true, a guardian must approve
  // before a participant can start; minAge is the threshold the organizer sets.
  requiresGuardianConsent?: boolean;
  minAge?: number;
  // Safe-zone boundary (change: safe-zone-boundary): a circular play area; a team
  // outside it triggers a server-side alert + soft-pause. Nullable because the
  // Builder must be able to send an explicit CLEAR (change:
  // expose-enforced-settings): `undefined` already means "field not sent" on the
  // save payload, so removing a boundary needs a value of its own.
  safeZone?: import('./../safeZone').SafeZone | null;
  // Platform benchmark (change: platform-benchmark): opt this game's finished runs
  // out of the anonymized cross-platform aggregate contribution.
  benchmarkOptOut?: boolean;
  // Chat integration (change: chat-integrations): an owner-only Slack/Teams incoming
  // webhook URL. When set, announcements + flash missions on any run of this game are
  // mirrored to that channel (server-side, SSRF-validated). SECRET — never copied into
  // publicGames or any participant payload. `integrationPlatform` is derived on save.
  integrationWebhookUrl?: string;
  integrationPlatform?: 'slack' | 'teams';
  // Marketplace instant play (change: marketplace-instant-play): when true and the game
  // is published, any player can start a free, self-guided solo run on demand via
  // startInstantPlay — no organizer, no access code, no credit consumed.
  allowInstantPlay?: boolean;
  // Live photo feed (change: live-photo-feed): when false, approved photos are NOT
  // broadcast to the run's shared feed. Default true (undefined ⇒ enabled), so
  // every existing game keeps the feed on. Enforced write-side in the functions
  // (rules cannot conditionally gate feedItems reads on this flag).
  photoFeedEnabled?: boolean;
  // Power-ups (change: power-ups): when true, each completed task has a
  // seeded-deterministic ~25% chance to award a power-up (×2 next task or +15
  // flat). Default false — existing games are untouched. Never rolls on the
  // time_only preset (no task points to double; a flat bonus corrupts pure-time).
  powerUpsEnabled?: boolean;
  // Game-level intro/instructions primer (change: game-intro-instructions).
  // Optional: absent games render no primer. Not secret — echoed to participants
  // and, when public, denormalized into publicGames. Cosmetic; never gates play.
  instructions?: GameInstructions;
  // Staged leaderboard reveal (change: manual-leaderboard-reveal): when true,
  // finalizeRun leaves the final board UNPUBLISHED so players cannot see who won
  // the moment the run ends — the creator reveals it explicitly via
  // refreshLeaderboard({ publish: true }). Default false (undefined ⇒ auto-publish),
  // so every existing game keeps today's behaviour. Organizers always see the
  // standings regardless (they read the run doc directly); this flag gates only
  // the PARTICIPANT-visible board. Never denormalized into publicGames.
  manualLeaderboardReveal?: boolean;
  // Trash / tombstone (change: recoverable-game-deletion). PRESENCE of a non-empty
  // `deletedAt` means the game is deleted: it disappears from listGames, the
  // gallery and every play surface, but nothing beneath it is destroyed until the
  // grace period elapses (GAME_TRASH_RETENTION_DAYS) or the owner asks for
  // permanent destruction. Absence is the normal state, so existing games need no
  // migration. SERVER-WRITTEN ONLY — firestore.rules rejects any client write that
  // introduces, changes or removes these two fields. See gameLifecycle.ts.
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
  // Admin-managed game templates (change: admin-manage-game-templates). A template
  // is an ordinary Game, owned by whichever admin authored it, flagged so it shows
  // up in the creator-facing "new game" picker instead of that admin's own
  // dashboard-only games list. Admin-only-writable: setGameTemplateFlag is the only
  // path that sets these fields (never part of Builder's autosave field allowlist).
  isTemplate?: boolean;
  templateEmoji?: string;
  // Sort position in the picker; the MINIMUM across a templateGroupKey's siblings
  // is authoritative (see templateGroupKey below).
  templateOrder?: number;
  // Links this template to its translated siblings (produced via the existing
  // translateGame callable, then each flagged with the SAME templateGroupKey). A
  // template with no siblings is its own group of one. Undefined ⇒ not grouped.
  templateGroupKey?: string;
  // Which language THIS document's stage/task content is authored in, e.g. 'he' | 'en'.
  templateLang?: string;
  // Task-library priority (change: task-library-priority-boost). Creator-settable
  // (unlike PublicGame/PublicTask.pinnedLast, which is admin-only and set directly
  // in Firestore). When true, every task this game publishes carries
  // PublicTask.pinnedFirst — see that field for the ranking contract.
  pinnedFirst?: boolean;
  // הקמה מהירה / Quick Setup (change: quick-setup-wizard). The creator-facing
  // setup instructions a TEMPLATE carries, each one a POINTER at the single field
  // it is about — so the instruction stops living inside the player-facing prose it
  // describes. Creator-only: never sanitized into a task payload (it never reaches
  // one) and never denormalized into publicGames/publicTasks. Absent ⇒ this game has
  // no quick setup, which is every game that predates the feature.
  // See packages/shared/src/templateWizard.ts.
  wizardSteps?: import('../templateWizard').TemplateWizardStep[];
}


// ─── Public gallery index ─────────────────────────────────────────────────────
// Stored at: publicGames/{gameId}
// Denormalized snapshot synced from Game when visibility = 'public'.

export interface PublicGame {
  id: string;
  ownerUid: string;
  ownerDisplayName?: string;
  title: string;
  description?: string;
  mode: GameMode;
  scoringPreset: ScoringPreset;
  tags: string[];
  coverImage?: string;
  approxLocation?: GeoPoint & { label?: string };
  playCount: number;
  stageCount: number;
  taskCount: number;
  estimatedTotalMinutes: number;
  // Accurate GPS requirement derived from task trigger modes at publish time
  // (change: fix-live-launch-demo-text). 'gps' if any located task, else 'anywhere'.
  requirement?: GameRequirement;
  // Marketplace instant play (change: marketplace-instant-play): show a "Play now" CTA.
  allowInstantPlay?: boolean;
  // Game intro primer (change: game-intro-instructions): denormalized for the
  // pre-join promo teaser so a player can preview how the game plays before joining.
  instructions?: GameInstructions;
  // ── Popularity ranking (change: gallery-popularity-ranking) ──
  // SERVER-WRITE-ONLY, both of them. `likeCount` is the number of distinct users
  // who liked this game; `popularity` is popularityScore() applied to playCount +
  // likeCount + createdAt and is the field Firestore actually orders by. Optional
  // because games published before this change have neither — every reader treats
  // undefined as 0 and the document self-heals on its next signal.
  likeCount?: number;
  popularity?: number;
  // Always ranks after every non-pinned item, regardless of popularity/likes/uses
  // (change: gallery-pin-last). For content that must stay reachable but never
  // compete for the front of the gallery — e.g. the QA playground game.
  pinnedLast?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Stored at: publicTasks/{taskId}
// Individual tasks from public games — for the task library / copy-paste.
export interface PublicTask {
  id: string;
  sourceGameId: string;
  sourceGameTitle?: string;
  ownerUid: string;
  ownerDisplayName?: string;
  title: string;
  description?: string;
  type: TaskType;
  /**
   * @deprecated (change: task-library-map-view) The EXACT authored coordinate.
   * publicTasks is world-readable (`allow read: if true`), so publishing this was
   * a live exposure — and it was written even for `hideLocation` tasks, whose
   * coordinates are server-secret everywhere else in this codebase. No longer
   * written by publishGame and no longer read by anything; `searchTaskLibrary`
   * strips it from its response so documents published before that change stop
   * serving exact points too. Optional only so legacy stored docs still parse.
   */
  coordinates?: GeoPoint;
  /**
   * Coarse ~1 km area pin (change: task-library-map-view) — the centre of the grid
   * cell containing the authored coordinate, via `approximatePublicPoint`. ABSENT
   * for `hideLocation` tasks, locationless tasks and unplaced tasks: the exclusion
   * is applied at the WRITE, so no world-readable document ever holds the value.
   * The only location field any reader may use.
   */
  approxLocation?: GeoPoint;
  difficulty: number;
  estimatedMinutes: number;
  pointValue: number;
  tags?: string[];
  copyCount: number;
  // Popularity ranking (change: gallery-popularity-ranking) — server-write-only,
  // same contract as PublicGame above. `uses` for a task is its copyCount.
  likeCount?: number;
  popularity?: number;
  // See PublicGame.pinnedLast (change: gallery-pin-last) — same contract.
  pinnedLast?: boolean;
  // Task-library priority (change: task-library-priority-boost): the OPPOSITE of
  // pinnedLast — sorts BEFORE every non-pinned item in comparePopularity,
  // regardless of score/uses/likes. Set at publish time from the source game's
  // OWN `Game.pinnedFirst` toggle (creator-settable in the Builder), never
  // written directly. If a task is somehow flagged both `pinnedFirst` and
  // `pinnedLast`, `pinnedFirst` wins — see comparePopularity.
  pinnedFirst?: boolean;
  createdAt: string;
}

// Stored at: publicLikes/{kind}_{itemId}_{uid}  (FIRESTORE_PATHS.publicLike)
// One creator's like of one public game or public task. Written only by the
// setPublicLike callable; clients can neither read nor write it.
export interface PublicLike {
  id: string;
  kind: 'game' | 'task';
  /** publicGames/{itemId} or publicTasks/{itemId}. */
  itemId: string;
  uid: string;
  createdAt: string;
}


// ─── Run ─────────────────────────────────────────────────────────────────────
// Stored at: users/{ownerUid}/games/{gameId}/runs/{runId}
// A live instance of a Game. Multiple runs of the same Game are independent.

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  score: number;
  completedStages: number;
  finishedAt?: string;
  durationSeconds?: number;   // for time_only preset
  totalMinutes?: number;
}

export interface RunLeaderboard {
  rankings: LeaderboardEntry[];
  frozen: boolean;
  frozenAt?: string;
  // Whether participants may see this leaderboard. Organizers always see live
  // standings; participant visibility is opt-in so the reveal can be staged.
  // finalizeRun publishes automatically.
  published?: boolean;
  updatedAt: string;
}

export interface Run {
  id: string;
  gameId: string;
  ownerUid: string;
  status: RunStatus;
  accessCode: string;
  staffPin?: string;
  launchedAt?: string;
  finishedAt?: string;
  // ── Billing (Event Credits model) ──
  billingType: 'free' | 'credit' | 'pro' | 'test';
  maxParticipants: number;       // ceiling fixed at launch (from plan/package)
  // Test-drive (rehearsal) run (change: test-drive-mode): free, capped at 2,
  // excluded from cross-run aggregates (benchmarks, player profiles, playCount).
  // Absent on every normal run; every consumer treats absent as false.
  isTestDrive?: boolean;
  participantCount: number;      // grows with each joinRun (counts TEAMS)
  // Monotonic total phones (devices) across all teams — grows on every joinRun AND
  // joinTeamAsDevice, enforced against MAX_RUN_DEVICES. No detach path, so it never
  // decrements. Absent on legacy runs; consumers fall back to participantCount.
  deviceCount?: number;
  freeParticipantsUsed?: number; // legacy (pre-migration runs)
  leaderboard?: RunLeaderboard;
  hotZone?: HotZone;             // active timed score multiplier (hot-zone-bonus)
  // White-label Pro (change: white-label-pro): sealed at launch from the owner's
  // entitlement; share surfaces decide branding via resolveRunBrand.
  whiteLabel?: boolean;
  brand?: { name?: string; logoUrl?: string };
  // Marketplace instant play (change: marketplace-instant-play): a free self-guided solo
  // run started on demand from a public game, not launched by an organizer.
  selfGuided?: boolean;
  // Live task availability (change: live-task-pause): per RUN operator overrides of
  // a task's `status`, keyed by task id. Server written only (setRunTaskStatus).
  // Deliberately NOT on the game template: a stop that closed today must not stay
  // closed for tomorrow's run, for a duplicate, for an export, or in the gallery.
  // Routing resolves it via effectiveTaskStatus(); the completion path never reads
  // it, so a team already holding a paused task still finishes and scores it.
  taskStatusOverrides?: Record<string, StationStatus>;
  createdAt: string;
  updatedAt: string;
}

// A one-line summary of a live run for the multi-run GM overview
// (change: multi-run-gm-panel). Returned by listLiveRuns; the overview card
// deep-links into the existing per-run console.
export interface LiveRunSummary {
  ownerUid: string;
  gameId: string;
  runId: string;
  gameTitle: string;
  accessCode: string;
  participantCount: number;
  launchedAt: string | null;
  unackedAlerts: number;
}

// A timed, geofenced score multiplier an organizer activates on a run
// (change: hot-zone-bonus). Enforced server-side via hotZoneMultiplier.
export interface HotZone {
  center: GeoPoint;       // zone centre
  radiusMeters: number;   // inclusion radius
  multiplier: number;     // score multiplier (e.g. 2 for double points)
  startedAt: string;      // ISO — server-stamped activation
  expiresAt: string;      // ISO — server-stamped expiry
}


// ─── Staff Invite ─────────────────────────────────────────────────────────────
// Stored at: users/{ownerUid}/games/{gameId}/runs/{runId}/staffInvites/{id}

export interface StaffInvite {
  id: string;
  runId: string;
  gameId: string;
  ownerUid: string;
  pin: string;
  displayName?: string;
  permissions: StaffPermission[];
  usedAt?: string;
  createdAt: string;
}


// ─── RunTeam (participant state) ──────────────────────────────────────────────
// Stored at: users/{ownerUid}/games/{gameId}/runs/{runId}/teams/{teamId}
// One document per team/individual. Contains their full progress (stages+tasks).
// Written ONLY by Cloud Functions — client is read-only.

export interface TaskScoreBreakdown {
  taskScore: number;
  timeBonus?: number;
  penalty?: number;
  hotZoneMultiplier?: number;   // applied when completed inside an active hot zone
  total: number;
}

export interface RunTaskRecord {
  taskId: string;
  taskIndex: number;  // index into Stage.tasks for multi-task stages
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  actualMinutes?: number;
  // Pause-clock tasks (change: pause-clock-tasks): milliseconds of THIS team's
  // clock excluded because the game task carries `pausesTimer`. Stamped ONCE, at
  // completion, from the server's own startedAt → completedAt span (never from
  // anything a client reports), as part of the whole-object stage rewrite the
  // record already receives. Absent on every pre-existing record and read as 0.
  //
  // Two jobs, one field: buildRankings SUMS it (so live and final standings read
  // the same immutable number even if the creator edits `pausesTimer` mid-run),
  // and routing's computeSkillRatio drops any record that CARRIES it from the
  // team's measured pace — which is why it is stamped even when the span is 0.
  // `actualMinutes` above deliberately keeps the REAL measured span, because
  // benchmarks, per-type analytics and the staff over-duration warning read it.
  excludedMs?: number;
  // fix-fixed-points-speed-template-drift: the per-task EXPECTED route-time
  // contribution (minutes), snapshotted from the game template at the moment this
  // record reached a terminal state — the same value scoreFixedPointsSpeed's route
  // reduce reads today (expectedDurationMinutes ?? estimatedMinutes), with the same
  // finite-and->0 guard. buildRankings SUMS this stamp across the team's terminal
  // records instead of reducing over the live template, so a creator editing a
  // task's expected duration mid-run cannot retroactively re-score a team that has
  // already finished (which would jump the live board and break live/final parity).
  // Absent on every pre-change record and on any run started before this shipped —
  // read via a template fallback, never as 0.
  expectedDurationMinutesAtCompletion?: number;
  earnedScore?: number;
  scoreBreakdown?: TaskScoreBreakdown;
  // Smart station
  verificationOutcome?: 'correct' | 'photo_pending' | 'approved' | 'rejected';
  photoUrl?: string;
  // survey (change: survey-tasks): the team's own submitted survey response
  // (trimmed, ≤ 500 chars). Server-write-only like the whole team doc; first
  // response is final (the already-completed guard never overwrites it). Not
  // secret to its own team, so it flows through getMyTeamState unchanged.
  surveyResponse?: string;
  // Hidden-location arrival latch (change: play-task-gating). Server-written by
  // `reportArrival` once the team's GPS passed the SAME haversine/evaluateTrigger
  // check that gates a check-in. Once set it is never cleared — arrival is sticky,
  // so a reload / GPS loss / offline spell can never re-seal a task the player has
  // already reached. Until it is set, the sanitizer ships only the sealed stub.
  arrivedAt?: string;
}

export interface RunStageRecord {
  stageId: string;
  order: number;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  // Copied from Stage.requiredTaskCount at run-build time so the run is
  // self-contained. Undefined = all tasks required.
  requiredTaskCount?: number;
  tasks: RunTaskRecord[];
  earnedScore?: number;
}

// Shared team devices (change: shared-team-devices): one phone per attached
// participant; exactly one (controllerUid) may submit. Metadata for display.
export interface TeamDevice {
  uid: string;
  name: string;
  joinedAt: string;
}

export interface RunTeam {
  id: string;           // Firebase Auth UID (anonymous)
  runId: string;
  gameId: string;
  ownerUid: string;     // game owner, for path construction
  displayName: string;  // team name (team mode) or player name (individual)
  registrationData: Record<string, unknown>;
  memberNames?: string[];
  memberCount?: number;
  status: TeamStatus;
  stages: RunStageRecord[];
  score: number;
  // Sign convention: bonusPenalty is SUBTRACTED from the final score. A BONUS is a
  // NEGATIVE penalty (a decrement); a fine is a positive penalty. adjustTeamScore
  // (np = p - delta), zone-capture bonuses, and power-up bonuses all follow this.
  bonusPenalty: number;
  // Power-ups (change: power-ups): seeded-award state. `active` is a single armed
  // slot — at most one double_points pending; a second double rolled while one is
  // armed converts to a bonus_points award. Server-write-only (rides the team doc;
  // rules deny client writes). Not secret — it is the caller's own team state,
  // returned by getMyTeamState.
  powerUps?: import('./../powerUps').TeamPowerUps;
  // Guardian consent (change: guardian-consent-qr): present (with grantedAt) once
  // a guardian approves; gates start on runs that require consent.
  guardianConsent?: import('./../guardianConsent').GuardianConsent;
  // Safe-zone (change: safe-zone-boundary): set true while the team's last known
  // location is outside the play area; soft-pauses new task assignment.
  outOfBounds?: boolean;
  // Out-of-bounds recovery (change: out-of-bounds-recovery): when the latch was set
  // (ISO), and until when a staff release keeps it suppressed. Both optional — a team
  // document written before this change evaluates as "unknown", which fails OPEN.
  outOfBoundsAt?: string;
  outOfBoundsOverrideUntil?: string;
  // Staff-initiated per-team hold (change: staff-console-field-ops). A marshal parks
  // ONE team (injury, dispute, waiting on staff) without touching the run or any other
  // team. Lives here, not on the Run doc, because a hold is inherently per-team — the
  // same place every other per-team operational latch (outOfBounds above) already lives,
  // and therefore immune to template edits, duplication and export.
  //
  // While `held` is true every progress-advancing callable refuses (assertTeamNotHeld);
  // reads are deliberately NOT gated, so the participant app can explain the pause
  // instead of showing an opaque failure.
  held?: boolean;
  heldAt?: string;        // ISO — start of the CURRENT hold; cleared on resume
  heldReason?: string;    // optional staff free text, shown to the team
  heldBy?: string;        // staffName claim of whoever held them (attribution)
  // ACCUMULATED held milliseconds across every past hold in this run, stamped on each
  // resume (and at finalization for a still-open hold). Summed by buildRankings via
  // teamHeldExclusionMs so held time never counts against a team's race clock — the
  // team-level analogue of RunTaskRecord.excludedMs. Absent on every pre-change doc
  // and read as 0.
  heldMs?: number;
  /** Cooldown marker so an active override can't mint a breach alert every ping. */
  lastBreachAlertAt?: string;
  // Discovery POIs (change: surprise-trivia-waypoints): poiId → lifecycle state.
  discoveryState?: import('./../discoveryPoi').TeamDiscoveryState;
  activeTaskId?: string | null;  // mirror for getStationTeams query
  launched: boolean;
  startedAt?: string;
  finishedAt?: string;
  // Smart station streak
  smartStreak?: number;
  streakMultiplier?: number;
  stationHintsUsed?: Record<string, number[]>;
  smartVerifications?: Record<string, string[]>;
  // Live ops
  evacuatedFrom?: string | null;
  // Tasks for which this team has already paid to reveal the hint (charge once).
  taskHintsUsed?: string[];
  // Wrong answers recorded per task: taskId → count. Read by the attempt limit
  // (attemptLimitReached), by hint auto escalation (isHintFree) and by the
  // wrong-answer cost curve. A MAP field keyed by taskId, never an array element.
  taskAttempts?: Record<string, number>;
  // Wrong-answer cost ledger (change: wrong-answer-cost), taskId → state. A real
  // nested map; never written through a dotted key.
  //   charged       points already taken off this team for this task (enforces the cap)
  //   lastHash      hash of the last wrong answer (the duplicate-submission replay guard)
  //   cooldownUntil epoch ms the retry lockout expires; 0 when not cooling down
  // retry-lockout-clock-skew: the lockout is ALSO recorded as (server instant +
  // duration), which is what lets the server ship a remaining duration and bound
  // the wait by the level's own ceiling. All three are OPTIONAL — rows written
  // before that change carry only the fields above and keep working unchanged.
  //   lastFailureAt server instant of the wrong answer that started the lockout
  //   lockoutMs     the lockout duration that failure earned, in ms
  //   failureCount  charged-attempt index; diagnostic only, never trusted
  answerPenalties?: Record<string, {
    charged: number;
    lastHash: string;
    cooldownUntil: number;
    lastFailureAt?: number;
    lockoutMs?: number;
    failureCount?: number;
  }>;
  // Per-sequence-task progress: taskId → number of steps completed so far.
  taskStepProgress?: Record<string, number>;
  // Shared team devices (change: shared-team-devices). Absent on legacy docs —
  // the founding uid (id) is then the sole attached device and the controller.
  deviceUids?: string[];
  controllerUid?: string;
  deviceJoinCode?: string;
  devices?: TeamDevice[];
  updatedAt: string;
}


// ─── Post-game feedback (change: post-game-feedback) ──────────────────────────
// A short, playful survey each finished PLAYER (every attached device, not just
// the team) fills on the finish screen. Fixed question set so client render and
// server validation share one shape. Ratings are integers in the key's range;
// unanswered dimensions are simply absent.

// Each rating key with its inclusive [min,max]. 1–5 for feel/interest/bonding/
// recommend; 1–3 for the two "fit" questions.
export const FEEDBACK_RATINGS = {
  overall:    { min: 1, max: 5 },
  content:    { min: 1, max: 5 },
  bonding:    { min: 1, max: 5 },
  difficulty: { min: 1, max: 3 },
  smoothness: { min: 1, max: 3 },
  recommend:  { min: 1, max: 5 },
} as const;
export type FeedbackRatingKey = keyof typeof FEEDBACK_RATINGS;
export const FEEDBACK_RATING_KEYS = Object.keys(FEEDBACK_RATINGS) as FeedbackRatingKey[];

// Fixed set of "what went wrong" chips, offered when smoothness is not top.
export const FEEDBACK_ISSUES = [
  'gps', 'photo', 'station_code', 'task_unclear', 'slow', 'other',
] as const;
export type FeedbackIssue = typeof FEEDBACK_ISSUES[number];

export const FEEDBACK_COMMENT_MAX = 1000;

// The stored doc at runs/{runId}/feedback/{uid}.
export interface RunFeedback {
  uid: string;              // the responding player (device) uid == doc id
  teamId: string;           // the team they played on
  teamName: string;         // denormalized for the creator's list
  memberName?: string;      // this device's display name when known
  ratings: Partial<Record<FeedbackRatingKey, number>>;
  issues?: FeedbackIssue[];
  comment?: string;
  lang: string;             // 'he' | 'en' — which language they answered in
  createdAt: string;
}

// One dimension's rollup. distribution[i] = count of answers equal to (min+i).
export interface FeedbackRatingStat {
  avg: number;
  count: number;
  distribution: number[];
}

export interface RunFeedbackSummary {
  responseCount: number;
  participantCount: number;
  responseRate: number;     // 0..1, guarded against ÷0
  ratings: Partial<Record<FeedbackRatingKey, FeedbackRatingStat>>;
  recommendScore: number;   // 0..1 share of recommend answers that were 4 or 5
  issueCounts: Partial<Record<FeedbackIssue, number>>;
  commentCount: number;
}


// ─── Access Codes ─────────────────────────────────────────────────────────────
// Top-level: accessCodes/{code} — looked up directly by participants.

export interface AccessCode {
  code: string;
  ownerUid: string;
  gameId: string;
  runId: string;
  status: AccessCodeStatus;
  teamId?: string | null;
  createdAt: string;
  usedAt?: string | null;
  // Game trash (change: recoverable-game-deletion). Soft-deleting a game REVOKES
  // its codes rather than deleting them: a released code could be handed to a
  // different creator's run by uniqueCode() inside the grace period, so restoring
  // the game would hand back dead (or worse, misdirected) shared links. These two
  // fields let restore reinstate EXACTLY the codes this deletion revoked —
  // `revokedByGameDeletionAt` mirrors the game's `deletedAt` verbatim, and
  // `revokedFromStatus` is the status to put back. A code revoked for any other
  // reason carries neither field and is never resurrected by a restore.
  revokedByGameDeletionAt?: string;
  revokedFromStatus?: AccessCodeStatus;
}


// ─── Wallet & Payments ────────────────────────────────────────────────────────

// ── Event-Credits pricing model ──
// A "free run" is a whole event capped at 5 participants; every creator gets a
// few for life. Beyond that, runs cost 1 Event Credit (bought in packages) or
// are unlimited under Creator Pro.
export const FREE_RUNS_LIFETIME              = 3;
export const FREE_PARTICIPANTS_PER_FREE_RUN  = 5;
export const PRO_DEFAULT_MAX_PARTICIPANTS    = 50;
export const PRO_MONTHLY_ILS                 = 149;
export const PRO_ANNUAL_ILS                  = 990;
// Each successful referral grants ONE extra lifetime free run to both sides.
export const REFERRAL_BONUS_FREE_RUNS        = 1;
// Anti-farming cap: a single referrer can earn at most this many referral bonuses
// (auth-anticheat row 44). Past this, claimReferral is refused for that inviter.
export const REFERRAL_MAX_PER_REFERRER       = 20;

// Privacy retention: raw participant PII captured during a run (GPS location
// pings + uploaded photos) is auto-purged this many days after the run finishes.
// Aggregate results (scores/rankings) are kept while the account is active.
// Mirrors the commitment in our Privacy Policy. See functions/src/maintenance.
export const RUN_DATA_RETENTION_DAYS         = 90;

export type EventPackageId = 'starter' | 'standard' | 'pro_pack';
export interface EventPackageDef {
  credits: number;          // Event Credits granted
  maxParticipants: number;  // ceiling per run bought with this package
  priceILS: number;
  popular?: boolean;
}
export const EVENT_PACKAGES: Record<EventPackageId, EventPackageDef> = {
  starter:  { credits: 1,  maxParticipants: 15, priceILS: 79  },
  standard: { credits: 3,  maxParticipants: 30, priceILS: 179, popular: true },
  pro_pack: { credits: 10, maxParticipants: 50, priceILS: 449 },
};

export interface Wallet {
  uid: string;
  eventCredits: number;            // whole-event credits remaining
  lifetimeFreeRunsUsed: number;    // counts toward FREE_RUNS_LIFETIME (+ bonus)
  bonusFreeRuns?: number;          // extra free runs earned via referrals
  plan: 'free' | 'pro';
  proExpiresAt?: string | null;    // ISO; null when not Pro
  stripeCustomerId?: string;
  stripeSubscriptionId?: string | null;
  lastPackageMaxParticipants?: number; // ceiling applied to credit-funded runs
  processedSessions?: string[];    // Stripe session ids already credited (idempotency)
  updatedAt: string;
  // Referral program: who invited this creator (set once) + how many they invited.
  referredBy?: string;
  referralClaimedAt?: string;
  referralCount?: number;
  // Legacy (pre-migration) — optional so old docs still typecheck.
  balanceILS?: number;
}

// Client-safe wallet snapshot returned by getWalletStatus.
export interface WalletStatus {
  plan: 'free' | 'pro';
  proExpiresAt?: string | null;
  eventCredits: number;
  freeRunsRemaining: number;
  lastPackageMaxParticipants?: number;
  // Free mode: when false the whole app is free and clients hide every payment
  // surface. Mirrors PAYMENTS_ENABLED so clients render free mode without guessing.
  paymentsEnabled: boolean;
}

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  description: string;
  amountILS?: number;       // legacy / referral
  priceILS?: number;        // amount paid (credit/pro purchases)
  credits?: number;         // credits granted (topup_credits)
  creditCost?: number;      // credits spent (charge_event) — always 1
  packageId?: EventPackageId;
  maxParticipantsPerRun?: number;
  gameTitle?: string;
  runId?: string;
  teamId?: string;
  stripePaymentIntentId?: string;
  createdAt: string;
}


// ─── Live ops (per run) ───────────────────────────────────────────────────────

export interface Announcement {
  id: string;
  message: string;
  messageHe?: string;
  level: AnnouncementLevel;
  active: boolean;
  createdAt: string;
  operatorId?: string;
  // Targeted announcements (change: targeted-announcements).
  // `teamId` absent ⇒ global broadcast (every team sees it); present ⇒ addressed to
  // that one team. NOT SECRET and NOT server-enforced: Firestore rules cannot filter
  // documents within a collection read, so per-team visibility is a client courtesy
  // (see `announcementVisibleTo`) — the field never contains an answer key or a
  // scoring internal beyond the `delta` the audit log already records. Documented in
  // the `match /announcements` rules comment.
  teamId?: string;
  // `kind` discriminates a normal announcement from a team-targeted score notice that
  // `adjustTeamScore` writes so the team sees a toast. Absent ⇒ 'announcement' for
  // every pre-existing doc (back-compat).
  kind?: 'announcement' | 'score';
  // kind==='score' only: the applied bonus/penalty adjustment (signed).
  delta?: number;
}

export interface AdminAlert {
  id: string;
  type: AlertType;
  teamId: string;
  teamName?: string;
  taskId?: string;
  stationTitle?: string;
  location?: GeoPoint;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

export interface FlashMission {
  id: string;
  title: string;
  titleHe?: string;
  description: string;
  descriptionHe?: string;
  bonusPoints: number;
  expiresAt: string;
  isActive: boolean;
  createdAt?: string;
  winnerTeamId?: string;
}

// Live photo feed item (change: live-photo-feed). Written server-side on BOTH
// photo-approval paths (submitStationPhoto autoApprove + reviewStationSubmission
// approve); read by any authed participant of the run (announcements pattern).
// Contains ONLY celebratory, non-secret data — no task config, no answer keys.
// Video submissions ride the same two write sites (change:
// run-media-gallery-and-video-feed) — see `mediaKind` below. Audio never reaches
// the feed.
export interface FeedItem {
  id: string;
  taskId: string;
  /** Denormalized from the game doc at approval time. */
  taskTitle: string;
  teamId: string;
  /** Denormalized team.displayName. */
  teamName: string;
  /** Already Storage-validated by requireStorageUrl at submit time. */
  photoUrl: string;
  /**
   * What `photoUrl` actually is (change: run-media-gallery-and-video-feed). Absent
   * on every item written before this change — those are all photos, so renderers
   * must treat a missing value as `'photo'`, never as unknown. Audio never reaches
   * the feed, so this is only ever `'photo'` or `'video'` in practice.
   */
  mediaKind?: MediaKind;
  /** emoji → count, e.g. { '🔥': 3 }. Zero-count keys are dropped. */
  reactions: Record<string, number>;
  /** uid → emoji: dedup/switch source of truth (one reaction per uid). */
  reactedBy: Record<string, string>;
  /** hideFeedItem sets false; listeners filter active == true. */
  active: boolean;
  createdAt: string;
  hiddenAt?: string;
  hiddenBy?: string;
  /**
   * reporterKey (teamId, or `staff:<uid>`) → reason (change: feed-ugc-safety).
   * Written only by reportFeedItem via the pure applyReport reducer.
   */
  reportedBy?: Record<string, string>;
  /** Number of distinct reporterKeys in reportedBy (change: feed-ugc-safety). */
  reportCount?: number;
  /**
   * Set by hideFeedItem({ restore: true }) — disarms auto-hide permanently for
   * this item even as further reports keep accumulating (change: feed-ugc-safety).
   */
  reportsCleared?: boolean;
}

export interface TeamLocation {
  teamId: string;
  teamName?: string;
  lat: number;
  lng: number;
  stageOrder?: number;
  updatedAt: string;
}


// ─── Station Reviews ──────────────────────────────────────────────────────────

export interface StationSubmission {
  id: string;
  ownerUid: string;
  gameId: string;
  runId: string;
  teamId: string;
  teamName?: string;
  taskId: string;
  taskTitle?: string;
  verificationType: VerificationType;
  status: StationSubmissionStatus;
  photoUrl?: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
}

export interface VerifyAttempt {
  taskId: string;
  teamId: string;
  teamName: string | null;
  timestamp: string;
  outcome: VerifyOutcome;
  attemptsCount: number;
  codeProvided: string;
  distanceMetres?: number | null;
  streakCount?: number | null;
}


// ─── Audit trail ─────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  ownerUid: string;
  gameId?: string;
  runId?: string;
  teamId: string;
  teamName?: string;
  operatorId: string;
  actionType: AuditActionType;
  previousValue?: number | string | null;
  newValue?: number | string | null;
  reason?: string;
}


// ─── Admin console contract rows ──────────────────────────────────────────────

/** One row returned by listRunTeams — live progress for the ops dashboard. */
export interface TeamSummary {
  id: string;
  displayName: string;
  memberNames: string[];
  memberCount: number;
  status: TeamStatus;
  score: number;
  completedStages: number;
  activeStageOrder: number | null;
  finished: boolean;
  launched: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One row returned by listStationTeams — teams currently at a task. */
export interface StationTeamRow {
  teamId: string;
  teamName: string;
  memberNames: string[];
  memberCount: number;
  startedAt: string | null;
}

/** One row returned by listPendingReviews — photo submissions awaiting staff. */
export interface PendingReview {
  submissionId: string;
  teamId: string;
  teamName: string;
  taskId: string;
  taskTitle: string;
  photoUrl?: string;
  submittedAt: string;
}


// ─── API payload shapes ───────────────────────────────────────────────────────

// Game management
export interface CreateGamePayload {
  title: string;
  description?: string;
  mode: GameMode;
  tags?: string[];
}

export interface UpdateGamePayload {
  gameId: string;
  title?: string;
  description?: string;
  mode?: GameMode;
  stages?: Stage[];
  scoringPreset?: ScoringPreset;
  scoringOptions?: ScoringOptions;
  registrationFields?: RegistrationField[];
  branding?: GameBranding;
  tags?: string[];
  coverImage?: string;
  approxLocation?: GeoPoint & { label?: string };
  requiresGuardianConsent?: boolean;
  minAge?: number;
  safeZone?: import('./../safeZone').SafeZone | null;
  benchmarkOptOut?: boolean;
  // Chat integration (change: chat-integrations). Empty string clears it.
  integrationWebhookUrl?: string | null;
  // Marketplace instant play (change: marketplace-instant-play).
  allowInstantPlay?: boolean;
  // Live photo feed toggle (change: live-photo-feed). Default true when absent.
  photoFeedEnabled?: boolean;
  // Power-ups toggle (change: power-ups). Default false when absent.
  powerUpsEnabled?: boolean;
  // Staged leaderboard reveal (change: manual-leaderboard-reveal). Default false
  // when absent ⇒ finalizeRun auto-publishes the final board, today's behaviour.
  manualLeaderboardReveal?: boolean;
  // Game intro primer (change: game-intro-instructions). Empty/whitespace-only ⇒
  // the field is cleared server-side; a non-https image is dropped on clean.
  instructions?: GameInstructions | null;
  // Task-library priority (change: task-library-priority-boost). Default false
  // when absent.
  pinnedFirst?: boolean;
  // הקמה מהירה / Quick Setup (change: quick-setup-wizard). `null` is an explicit
  // clear; absent means "not sent" and leaves the stored steps alone. Steps whose
  // stage/mission no longer exists are DROPPED on save, never a refusal.
  wizardSteps?: import('../templateWizard').TemplateWizardStep[] | null;
}

// Run management
export interface LaunchRunPayload {
  gameId: string;
}

export interface JoinRunPayload {
  code: string;
  displayName: string;
  registrationData?: Record<string, unknown>;
  memberNames?: string[];
}

// Routing
export interface RequestNextTaskPayload {
  lat: number;
  lng: number;
  stageId: string;
}

export interface RequestNextTaskResult {
  taskId?: string;
  taskIndex?: number;
  alreadyAssigned?: boolean;
}

export interface TaskRecommendation {
  taskId: string;
  taskIndex: number;
  // play-task-gating: OPTIONAL because a hidden-location task withholds its title
  // until the team has arrived (the same secret the participant sanitizer seals).
  // When it is absent, `locationHidden` is set instead.
  title?: string;
  locationHidden?: boolean;
  priority: number;
  estimatedMinutes: number;
  difficulty: number;
  currentLoad: number;
  distanceKm: number;
}
