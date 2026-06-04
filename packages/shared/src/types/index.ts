// ═══════════════════════════════════════════════════════════════════════════════
// @rushpoint/shared — canonical type definitions
//
// Firestore path convention (strictly enforced — never deviate):
//
//   PUBLIC  →  artifacts/{appId}/public/data/{collection}/{docId}
//   PRIVATE →  artifacts/{appId}/users/{userId}/{collection}/{docId}
//
// Collection name constants are in COLLECTIONS below.
// Path builder helpers are in FIRESTORE_PATHS below.
// ═══════════════════════════════════════════════════════════════════════════════


// ─── Firestore path helpers ───────────────────────────────────────────────────

/** Type-safe Firestore collection name constants. */
export const COLLECTIONS = {
  // Public collections
  TASKS:          'tasks',
  EVENTS:         'events',
  LEADERBOARD:    'leaderboard',
  FLASH_MISSIONS: 'flashMissions',
  ADMIN_ALERTS:   'adminAlerts',
  BASKET_ZONES:   'basketZones',
  MATCH_QUEUE:    'matchQueue',
  MATCHES:        'matches',
  ANNOUNCEMENTS:  'announcements',
  TEAM_LOCATIONS: 'teamLocations',

  // Admin-only collection (read gated to admins; written by Cloud Functions)
  AUDIT_LOGS:     'auditLogs',

  // Private per-user collections
  PROFILE:        'profile',
  GAME_STATE:     'gameState',
  CHECK_INS:      'checkIns',
  ASSIGNMENTS:    'assignments',
} as const;

/** Build Firestore collection paths consistently. */
export const FIRESTORE_PATHS = {
  /** artifacts/{appId}/public/data/{collection} */
  public: (appId: string, collection: string) =>
    `artifacts/${appId}/public/data/${collection}`,

  /** artifacts/{appId}/users/{userId}/{collection} */
  private: (appId: string, userId: string, collection: string) =>
    `artifacts/${appId}/users/${userId}/${collection}`,
} as const;


// ─── Primitive types ──────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type SlotType   = 'green' | 'gate' | 'orange' | 'gold';
export type SlotStatus = 'locked' | 'active' | 'completed' | 'skipped';
export type TaskType   = 'green' | 'orange' | 'gold';
export type StationStatus = 'active' | 'paused' | 'closed';
export type TeamStatus = 'registered' | 'active' | 'park' | 'crafting' | 'sprinting' | 'finished';
export type MatchStatus = 'waiting' | 'matched' | 'won' | 'lost' | 'bypassed';
export type EventStatus = 'pre' | 'live' | 'frozen' | 'ended';
// pending  = team declared arrival, awaiting the arrival volunteer's confirmation
// arrived  = arrival volunteer confirmed; now in the judge's scoring queue
// approved = judge scored it (terminal); rejected = cancelled/removed
export type CheckInStatus = 'pending' | 'arrived' | 'approved' | 'rejected';


/**
 * Number of slots on every team's board (the fixed game structure):
 * 0–2 green · 3 gate · 4 orange · 5 gold. The pool of *stations* per stage can be
 * arbitrarily large (routing spreads teams), but each team always plays 6 slots.
 * Single source of truth — used by the leaderboard UI and the finalize logic.
 */
export const SLOT_COUNT = 6;

// ─── Slot ─────────────────────────────────────────────────────────────────────
// A single entry in the 6-slot task board.
// Stored inside GameState (not as its own Firestore document).

export interface SlotScoreBreakdown {
  products?: string[];
  productScore?: number;
  designScore?: number;
  presentationScore?: number;
  taskScore?: number;
  total?: number;
}

export interface SlotRecord {
  index: number;       // 0–5 (fixed positions: 0-2 green, 3 gate, 4 orange, 5 gold)
  type: SlotType;
  status: SlotStatus;
  taskId?: string;     // populated when a task is assigned to this slot
  taskTitle?: string;  // denormalised for display (avoids extra read)
  startedAt?: string;  // ISO 8601 — stamped when slot becomes active
  completedAt?: string; // ISO 8601
  earnedScore?: number;
  scoreBreakdown?: SlotScoreBreakdown;
}


// ─── Team ─────────────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/users/{userId}/profile/team
//
// Identity only — no score or slot data here. Score lives in GameState.
// The leaderboard reads from LeaderboardEntry (public), not from Team directly.

export interface Team {
  id: string;           // = Firebase Auth UID (anonymous or custom-token)
  name: string;         // "Team Alpha"
  code: string;         // short code, e.g. "ALPH1" (for QR / judge lookup)
  memberNames: string[];
  status: TeamStatus;
  createdAt: string;    // ISO 8601
  startedAt?: string;
  finishedAt?: string;
}


// ─── GameState ────────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/users/{userId}/gameState/current
//
// The authoritative record of a team's slot progression.
// Written ONLY by Cloud Functions — client is read-only on this document.

export interface JudgingState {
  slotIndex: number;
  checkInId: string;
  arrivedAt: string;
}

export interface GameState {
  teamId: string;
  slots: SlotRecord[];  // always exactly 6 entries (0-2 green, 3 gate, 4 orange, 5 gold)
  score: number;
  bonusPenalty: number; // accumulated deductions (transit, sprint, hints)
  currentTaskId?: string;
  lastSyncedAt?: string; // last successful server sync (ISO 8601)
  updatedAt: string;    // ISO 8601
  // Phase 3 fields
  judging?: JudgingState | null;
  gateArrivedAt?: string;       // stamped when team checks in at Bible Park gate
  craftingStartedAt?: string;   // stamped when team scans basket QR (20-min clock starts)
  finalSprintStartedAt?: string; // stamped when 20-min crafting ends
  matchStatus?: MatchStatus;
  gateCooldownUntil?: string | null; // ISO — after a duel loss, the team waits out a
                                     // 90s cooldown before they may re-enter the gate queue
  teneSelection?: string[];     // product ids the team selected during crafting (slot 5)
  evacuatedFrom?: string | null; // station title the team was force-evacuated from (transient)
  smartStreak?: number;          // consecutive fast smart-station completions (default 0)
  streakMultiplier?: number;     // active smart-station task-score multiplier (default 1.0; 1.5 once streak ≥ 3)
  stationHintsUsed?: Record<string, number[]>; // taskId → hint indices already paid for (idempotent pay-per-hint)
  smartVerifications?: Record<string, string[]>; // taskId → accepted code keys (idempotent smart-station submit; blocks double-complete on rapid taps)
}


// ─── Task ─────────────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/tasks/{taskId}
//
// Read-only for teams. Written by admins / seed scripts.
// The routing algorithm assigns tasks; teams never pick their own.

export interface Task {
  id: string;
  title: string;
  titleHe?: string;     // Hebrew title
  description: string;
  descriptionHe?: string;
  type: TaskType;

  // Location — optional; orange/gold tasks may not have GPS coords
  coordinates?: GeoPoint;
  locationHint?: string;

  // Verification
  qrCode: string;       // unique token encoded in the physical QR sticker
  photoRequired: boolean;

  // Load-balancing
  maxConcurrentTeams: number;  // default 3
  currentTeamCount: number;    // denormalised counter (no arrays — Firestore limit)

  // Scoring / routing weights
  difficulty: number;        // 1–10 task difficulty rating (sigmoid scoring)
  pointValue: number;
  estimatedMinutes: number;
  /**
   * Difficulty baseline for the Dynamic Time-Bonus algorithm (minutes).
   * Per-task expected duration (e.g. Easy green ≈10, Hard green ≈18). Summed
   * across a team's 6 assigned slots → their personal Route Target (T_expected),
   * which finalizeLeaderboard compares to actual race time for a fairness bonus.
   * Optional for back-compat; callers fall back to `estimatedMinutes`.
   */
  expectedDurationMinutes?: number;

  isActive: boolean;    // admin can toggle off without deleting

  // Operational controls (Phase 3)
  status?: StationStatus;     // missing = 'active'. 'paused'/'closed' excluded from routing
  maxDurationMinutes?: number; // safety cap: operator is warned past this once a team checks in

  // Smart station (optional) — rich, self-running station config. A task with
  // `smart` set renders the smart play flow on mobile and is verified per
  // `smart.verificationType`. Absent ⇒ a plain station (unchanged behaviour).
  smart?: SmartStationConfig;
}

// ─── Smart stations ─────────────────────────────────────────────────────────
// How a smart station is completed:
//  - manual_judge:     waits in the admin review queue until an admin approves.
//  - code_verification: team enters a code; validated server-side against the
//                       secret in stationSecrets/{taskId} (NEVER sent to client).
//  - photo_upload:      team uploads a photo → pending review → admin approves/rejects.
export type VerificationType = 'manual_judge' | 'code_verification' | 'photo_upload';

/**
 * Client-safe smart-station config persisted on the public task doc. The secret
 * `expectedCode` is NOT here — it lives in stationSecrets/{taskId} (server-only)
 * and `hasCode` just flags that a code is configured.
 */
export interface SmartStationConfig {
  enabled: true;
  verificationType: VerificationType;

  // Content shown to the team
  longInstructions?: string;
  longInstructionsHe?: string;
  extraInfo?: string;
  mediaUrl?: string;        // video / rich media
  imageUrl?: string;
  adminNotes?: string;      // internal, not shown to teams

  // Timing / flow
  timeLimitSeconds?: number;
  canSkip?: boolean;

  // Geofence — reject station-code submissions made too far from the station.
  // metres; undefined or 0 = disabled (GPS not required).
  geofenceRadiusMeters?: number;
  // Station location, mirrored from the task's `coordinates` onto the slot so the
  // mobile play screen can show a live "distance away" badge. Only used (and only
  // present) when geofenceRadiusMeters > 0.
  stationCoords?: GeoPoint;

  // code_verification
  codeInputLabel?: string;
  hasCode?: boolean;        // true ⇒ an expectedCode is stored server-side
  autoCompleteOnSuccess?: boolean;
  attemptLimit?: number;    // 0 / undefined = unlimited
  hintCount?: number;

  // photo_upload / manual_judge
  photoReviewRequired?: boolean;
  needsAdminApproval?: boolean;
  allowRetry?: boolean;

  // Screen toggles
  showIntroScreen?: boolean;
  showSuccessScreen?: boolean;
  showFailureScreen?: boolean;
  showPendingReviewScreen?: boolean;
  showHintsOverTime?: boolean;
}

export type StationSubmissionStatus = 'pending' | 'approved' | 'rejected';

/**
 * A team's attempt at a smart station that needs admin review (photo_upload /
 * manual_judge). Stored at artifacts/{appId}/public/data/stationReviews/{id}
 * so the admin queue can read across all teams. Function-written only.
 */
export interface StationSubmission {
  id: string;
  teamId: string;
  teamName?: string;
  taskId: string;
  taskTitle?: string;
  verificationType: VerificationType;
  status: StationSubmissionStatus;
  photoUrl?: string;        // photo_upload only
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
}

// ─── Access codes ───────────────────────────────────────────────────────────
// artifacts/{appId}/accessCodes/{code}. `claimed`/`teamId` are kept for
// back-compat with the registration flow; `status` is the canonical lifecycle.
export type AccessCodeStatus = 'unused' | 'used' | 'revoked';

export interface AccessCode {
  code: string;
  status: AccessCodeStatus;
  gameId?: string;          // which game/event this code is for
  label?: string | null;
  claimed: boolean;         // legacy mirror of status === 'used'
  teamId?: string | null;   // legacy
  assignedTeamId?: string | null;
  createdAt: string;
  usedAt?: string | null;
  createdBy?: string | null;
}


// ─── Assignment ───────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/users/{userId}/assignments/current
//
// Written by the routing Cloud Function. Tracks which tasks are queued/done.

export interface InjectedRiddle {
  id: string;
  question: string;
  answer: string;        // checked server-side — never send to client plaintext in prod
  penaltyPoints: number;
}

export interface Assignment {
  teamId: string;
  taskQueue: string[];          // ordered list of upcoming task IDs
  currentTaskId?: string;
  completedTaskIds: string[];
  injectedRiddle?: InjectedRiddle; // set when park is at capacity
  updatedAt: string;
}


// ─── CheckIn ──────────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/users/{userId}/checkIns/{checkInId}
//
// Created by the mobile app (QR scan / photo upload).
// Updated by a judge or Cloud Function (approved/rejected).

export interface CheckIn {
  id: string;
  teamId: string;
  taskId: string;
  timestamp: string;    // ISO 8601
  photoUrl?: string;    // Firebase Storage download URL
  status: CheckInStatus;
  location?: GeoPoint;  // GPS at time of check-in

  // Populated by judge after review
  judgeId?: string;
  judgeNote?: string;
  judgeScore?: number;  // 0–100, only for gold basket tasks
}


// ─── Leaderboard ──────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/leaderboard/current
//
// Written by Cloud Functions only. Frozen flag hides rankings in the client
// 30 minutes before the event ends (Phase 3).

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  score: number;
  completedSlots: number;
  finishedAt?: string;  // ISO 8601 — undefined if still racing
  durationSeconds?: number;
}

export interface Leaderboard {
  eventId: string;
  rankings: LeaderboardEntry[];
  frozen: boolean;
  frozenAt?: string;    // ISO 8601
  updatedAt: string;
}


// ─── Event ────────────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/events/current
//
// Single document per running event. Admin writes; everyone reads.

export interface EventSettings {
  maxTeamsPerStation: number;      // default 3
  freezeMinutesBeforeEnd: number;  // default 30 (Phase 3)
  clueHintPenaltyPoints: number;   // default 50 (Phase 3)
  clueHintLockSeconds: number;     // default 60 (Phase 3)
  stationaryAlertMinutes: number;  // default 15 (Phase 2 admin heatmap)
}

export interface Event {
  id: string;
  name: string;
  nameHe?: string;
  status: EventStatus;
  startedAt?: string;  // ISO 8601
  endedAt?: string;
  settings: EventSettings;
}


// ─── Flash Mission ────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/flashMissions/{missionId}
//
// Phase 3. Admin broadcasts a time-limited bonus mission to all teams.

export interface FlashMission {
  id: string;
  eventId: string;
  title: string;
  titleHe?: string;
  description: string;
  descriptionHe?: string;
  bonusPoints: number;
  expiresAt: string;    // ISO 8601
  createdAt?: string;   // ISO 8601
  isActive: boolean;
  winnerTeamId?: string;
}


// ─── Admin Alert ──────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/adminAlerts/{alertId}
//
// Phase 2. Generated by Cloud Functions (stationary team, crowded station, SOS).

export type AlertType = 'stationary' | 'crowded' | 'sos';

export interface AdminAlert {
  id: string;
  type: AlertType;
  teamId: string;
  teamName?: string;
  taskId?: string;
  location?: GeoPoint;
  message: string;
  timestamp: string;    // ISO 8601
  acknowledged: boolean;
  acknowledgedAt?: string;
}

export interface SosEvent {
  id: string;
  teamId: string;
  location: GeoPoint;
  timestamp: string;    // ISO 8601
  resolved: boolean;
  resolvedAt?: string;
}


// ─── Operational Broadcast (Phase 3) ──────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/announcements/{id}
// Global administrative announcements (distinct from gamified flash missions).
// Persist until the admin deactivates them; teams dismiss locally per-device.

export type AnnouncementLevel = 'info' | 'warning' | 'critical';

export interface Announcement {
  id: string;
  message: string;
  messageHe?: string;
  level: AnnouncementLevel;
  active: boolean;
  createdAt: string;    // ISO 8601
  operatorId?: string;
}


// ─── Audit Trail (Phase 3) ────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/auditLogs/{id} (admin-read-only; Cloud-Function-written)
// Immutable record of every administrative action, for dispute resolution.

export type AuditActionType =
  | 'fine'
  | 'score_override'
  | 'manual_unlock'
  | 'evacuation'
  | 'skip';

export interface AuditLogEntry {
  id: string;
  timestamp: string;    // ISO 8601
  teamId: string;
  teamName?: string;
  operatorId: string;
  actionType: AuditActionType;
  previousValue?: number | string | null;
  newValue?: number | string | null;
  reason?: string;
}


// ─── Live Team Location (Phase 3) ─────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/teamLocations/{teamId}
// Written by the lean updateLocation callable; read by the admin heatmap.

export interface TeamLocation {
  teamId: string;
  teamName?: string;
  lat: number;
  lng: number;
  slotType?: SlotType;
  updatedAt: string;    // ISO 8601
}


// ─── API payloads (Cloud Function request/response shapes) ───────────────────

export interface RequestNextTaskPayload {
  teamId: string;
  lat: number;
  lng: number;
  completedTaskIds: string[];
  targetType: TaskType;
}

export interface RequestNextTaskResult {
  taskId?: string;
  injectRiddle?: boolean;
}

export interface SubmitJudgeScorePayload {
  teamId: string;
  checkInId: string;
  judgeScore: number;   // 0–100
  judgeNote?: string;
}

export interface SubmitJudgeScoreResult {
  success: boolean;
  newScore: number;
}

export interface GetRecommendedTasksPayload {
  lat: number;
  lng: number;
  targetType: TaskType;
}

export interface TaskRecommendation {
  taskId: string;
  title: string;
  titleHe?: string;
  priority: number;          // composite score, higher = better
  estimatedMinutes: number;
  difficulty: number;
  currentLoad: number;       // fraction 0..1 of capacity used
  distanceKm: number;
}

export interface GetRecommendedTasksResult {
  recommendations: TaskRecommendation[];
}


// ─── Basket Zone ──────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/basketZones/{zoneId}
// 3 zones in Bible Park; teams are routed to the least-crowded one.

export interface BasketZone {
  id: string;
  name: string;
  nameHe?: string;
  riddle: string;
  riddleHe?: string;
  coordinates: GeoPoint;
  currentTeamCount: number;
  maxTeams: number;
}


// ─── Matchmaking ──────────────────────────────────────────────────────────────
// Stored at: artifacts/{appId}/public/data/matchQueue/{teamId}
//            artifacts/{appId}/public/data/matches/{matchId}

export interface MatchQueueEntry {
  teamId: string;
  teamName: string;
  score: number;
  joinedAt: string;
  status: 'waiting' | 'matched' | 'resolved';
  matchId?: string;
}

export interface Match {
  id: string;
  teamAId: string;
  teamAName: string;
  teamBId: string;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  createdAt: string;
  resolvedAt?: string;
  winnerId?: string;
  penaltySeconds: number; // delay applied to the loser before they can access basket
}

// ─── Admin console contract rows ────────────────────────────────────────────
// Canonical shapes returned by the admin callables, shared by the Cloud Function
// that produces them and every admin page that consumes them — so the contract
// can't silently drift. (Pages may read a subset of these fields.)

/** One row of `listTeams` — a team's live progress for the admin tables. */
export interface TeamSummary {
  id: string;
  name: string;
  code: string;
  status: string;
  memberNames: string[];
  captainPhone: string;
  startedAt: string | null;
  score: number;
  completedSlots: number;
  stageIndex: number | null;
  stageType: SlotType | null;
  judging: boolean;
  crafting: boolean;
  finished: boolean;
  launched: boolean;
  launchAt: string | null;
}

/** One row of `listPendingArrivals` — a team waiting in / confirmed at the judge queue. */
export interface PendingArrival {
  checkInId: string;
  teamId: string;
  teamName: string;
  teamCode: string;
  memberNames?: string[];
  captainPhone?: string;
  taskId: string;
  taskTitle: string;
  timestamp: string | null;
  arrivedAt: string | null;
  teneSelection?: string[];
  maxDurationMinutes?: number | null;
  stationStatus?: string | null;
}

/** One row of `getStationTeams` — a team currently on a station operator's task. */
export interface StationTeamRow {
  teamId: string;
  teamName: string;
  teamCode: string;
  memberNames: string[];
  memberCount: number;
  captainPhone: string;
  slotIndex: number;
  startedAt: string | null;
}

/** One smart-station verification attempt — `listStationVerifyLog` / live monitoring feed. */
export type VerifyOutcome = 'correct' | 'wrong' | 'too-far' | 'limit-exceeded';

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
