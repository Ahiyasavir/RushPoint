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
export type TeamStatus = 'registered' | 'active' | 'park' | 'crafting' | 'sprinting' | 'finished';
export type MatchStatus = 'waiting' | 'matched' | 'won' | 'lost' | 'bypassed';
export type EventStatus = 'pre' | 'live' | 'frozen' | 'ended';
export type CheckInStatus = 'pending' | 'approved' | 'rejected';


// ─── Slot ─────────────────────────────────────────────────────────────────────
// A single entry in the 8-slot task board.
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
  index: number;       // 0–7 (fixed positions: 0-3 green, 4 orange, 5-7 gold)
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
  slots: SlotRecord[];  // always exactly 8 entries
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

  isActive: boolean;    // admin can toggle off without deleting
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
  taskId?: string;
  location?: GeoPoint;
  message: string;
  timestamp: string;    // ISO 8601
  acknowledged: boolean;
}

export interface SosEvent {
  id: string;
  teamId: string;
  location: GeoPoint;
  timestamp: string;    // ISO 8601
  resolved: boolean;
  resolvedAt?: string;
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
