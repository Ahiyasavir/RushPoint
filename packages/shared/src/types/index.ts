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
export type StaffPermission = 'announce' | 'review_photos' | 'track_locations';
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
  // audio-tasks: on a photo-type task, capture an audio clip instead of a photo
  // (rides the same ingest/review pipeline). Default absent = 'photo'; only
  // meaningful on photo-type tasks. NOT secret — the client needs it to render the
  // right capture widget, so the sanitizer must pass it through.
  captureKind?: 'photo' | 'audio';

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
}


// ─── Game (template) ─────────────────────────────────────────────────────────
// Stored at: users/{ownerUid}/games/{gameId}
// The canonical definition a Creator builds. Instantiated into Runs.

export interface ScoringOptions {
  transitPenaltyEnabled?: boolean;  // exponential late penalty for distance-based stages
  sprintPenaltyEnabled?: boolean;   // exponential late penalty for timed stages
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
  // outside it triggers a server-side alert + soft-pause.
  safeZone?: import('./../safeZone').SafeZone;
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
  createdAt: string;
  updatedAt: string;
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
  coordinates: GeoPoint;
  difficulty: number;
  estimatedMinutes: number;
  pointValue: number;
  tags?: string[];
  copyCount: number;
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
  /** emoji → count, e.g. { '🔥': 3 }. Zero-count keys are dropped. */
  reactions: Record<string, number>;
  /** uid → emoji: dedup/switch source of truth (one reaction per uid). */
  reactedBy: Record<string, string>;
  /** hideFeedItem sets false; listeners filter active == true. */
  active: boolean;
  createdAt: string;
  hiddenAt?: string;
  hiddenBy?: string;
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
  title: string;
  priority: number;
  estimatedMinutes: number;
  difficulty: number;
  currentLoad: number;
  distanceKm: number;
}
