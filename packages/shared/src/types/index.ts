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

  wallet:      (uid: string) => `wallets/${uid}`,
  transaction: (uid: string, txId: string) => `wallets/${uid}/transactions/${txId}`,

  accessCode:  (code: string) => `accessCodes/${code}`,

  runAnnouncement: (ownerUid: string, gameId: string, runId: string, id: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/announcements/${id}`,

  runAlert: (ownerUid: string, gameId: string, runId: string, id: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/adminAlerts/${id}`,

  teamLocation: (ownerUid: string, gameId: string, runId: string, teamId: string) =>
    `users/${ownerUid}/games/${gameId}/runs/${runId}/teamLocations/${teamId}`,

  stationSecret: (taskId: string) => `stationSecrets/${taskId}`,

  stationReview: (reviewId: string) => `stationReviews/${reviewId}`,

  auditLog: (id: string) => `auditLogs/${id}`,
} as const;


// ─── Primitive types ──────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type GameMode        = 'individual' | 'team';
export type ScoringPreset   = 'time_only' | 'fixed_points_speed' | 'smart_weighted';
export type TaskType        = 'field' | 'smart_station' | 'photo' | 'self_report'
                            | 'quiz' | 'numeric' | 'geofence' | 'sequence';
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
export type TransactionType = 'topup' | 'charge';
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
  // A general task with no fixed map location — can be done from anywhere
  // (no travel, no map marker, no distance). Routing treats transit as zero.
  locationless?: boolean;
  // Optional paid hint: participants can reveal `hint` for a `hintPenalty`
  // point cost (default 25). The hint text is NEVER sent to clients in the task
  // payload — only via the requestTaskHint callable, which charges once.
  hint?: string;
  hintPenalty?: number;
  // ── Verification config by type. Answer keys (answers/numericAnswer/
  //    steps[].answer) are SERVER-SECRET — stripped from the participant payload. ──
  // quiz: render `choices` as buttons (if present) else a text box; correct
  //       when the answer matches any of `answers` (trimmed, case-insensitive).
  choices?: string[];
  answers?: string[];
  // numeric: correct when |entered − numericAnswer| ≤ numericTolerance (default 0).
  numericAnswer?: number;
  numericTolerance?: number;
  // geofence: auto-checks-in when the participant is within this radius of
  //           `coordinates` (default 50m). Server validates the GPS distance.
  geofenceRadiusMeters?: number;
  // sequence: ordered sub-steps done at one stop; the task completes after the last.
  steps?: TaskStep[];
  // Library metadata (for publicTasks index)
  tags?: string[];
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

export interface Stage {
  id: string;
  order: number;
  title: string;
  tasks: Task[];
  isFinal?: boolean;  // triggers Final Run screen when completed
  // How many of this stage's tasks each team must complete. Undefined or >=
  // tasks.length means ALL tasks. When fewer, each team is routed to the
  // best-suited subset (by distance/load/skill) and the stage completes once
  // they've finished this many — the rest are auto-skipped for that team.
  requiredTaskCount?: number;
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
  freeParticipantsUsed: number;  // toward the 2-free limit
  leaderboard?: RunLeaderboard;
  createdAt: string;
  updatedAt: string;
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
  bonusPenalty: number;
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
  updatedAt: string;
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

export const FREE_PARTICIPANTS_PER_RUN = 2;
export const PRICE_ILS_INDIVIDUAL      = 35;   // per additional participant (individual mode)
export const PRICE_ILS_TEAM            = 100;  // per additional team (team mode)

export interface Wallet {
  uid: string;
  balanceILS: number;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  amountILS: number;
  description: string;
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
