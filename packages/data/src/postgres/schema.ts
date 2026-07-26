// ─── One declared field map per aggregate ────────────────────────────────────
//
// Every column name, SQL type and nullability in this implementation lives HERE
// and nowhere else. A method never spells out a column; it names a map.
//
// HOW TO READ AN ENTRY
//   nullable         the column may hold NULL. Absent ⇒ the column is NOT NULL,
//                    and a DELETE / null patch writes its DEFAULT instead.
//   emitNull         a NULL column reads back as a real `null` rather than as an
//                    absent key. Set it EXACTLY where the domain type says
//                    `| null` (`RunTeam.activeTaskId`, `Wallet.proExpiresAt`, …)
//                    — that is what makes `contract.ts`'s patch scenario pass.
//   omitWhenDefault  a NOT NULL column whose DEFAULT is indistinguishable from
//                    "the field was never there" in the domain. Completes the
//                    DELETE round trip for an optional field over a NOT NULL
//                    column (`RunTeam.smartStreak` over `not null default 0`).
//   readOnly         decoded on read, never written by the generic builders.
//                    Two cases: GENERATED columns, and IDENTITY columns whose
//                    domain value has to be resolved through a join (see ids.ts
//                    on `legacy_firebase_uid`).
//
// FIELDS WITH NO COLUMN are listed at the bottom of each map with the reason.
// A silently missing field is the bug class this file exists to prevent.

import type { FieldMap } from './mapping';


/** Empty array / object columns read back as ABSENT, matching a Firestore doc
 *  that simply had no such field. Returning `[]` where the domain says optional
 *  makes every `if (team.memberNames)` branch flip. */
const emptyArrayIsAbsent = (v: unknown): unknown => {
  const a = Array.isArray(v) ? v : [];
  return a.length === 0 ? undefined : a;
};

/** Epoch-milliseconds domain field over a `timestamptz` column.
 *  `RunTeam.answerPenalties[*].cooldownUntil` and `.lastFailureAt` were stored
 *  as epoch ms while every other instant in the codebase was an ISO string;
 *  0001_core_schema.sql normalises them and says the loader must convert. */
export const msToInstant = (v: unknown): unknown =>
  v === null || v === undefined ? null : new Date(Number(v)).toISOString();
export const instantToMs = (v: unknown): unknown =>
  v instanceof Date ? v.getTime() : Date.parse(String(v));


// ═══════════════════════════════════════════════════════════════════════════
// users
// ═══════════════════════════════════════════════════════════════════════════
//
// NO COLUMN: `email`, `photoURL`, `lang`, and the `[k: string]: unknown`
// grab-bag on `CreatorProfile`. In Supabase the first two belong to
// `auth.users` (GoTrue owns them) and this table deliberately does not
// duplicate identity data. A profile written through this repository therefore
// round-trips its uid / displayName / timestamps and NOTHING ELSE — which is a
// real behavioural difference from Firestore and is called out in the class
// docstring rather than hidden here.

export const USER_COLUMNS: FieldMap = {
  // Resolved by the SELECT as `coalesce(legacy_firebase_uid, uid::text)`.
  uid: { name: 'domain_uid', type: 'text', readOnly: true },
  displayName: { name: 'display_name', type: 'text', nullable: true },
  createdAt: { name: 'created_at', type: 'timestamptz' },
  updatedAt: { name: 'updated_at', type: 'timestamptz' },
};


// ═══════════════════════════════════════════════════════════════════════════
// wallets  /  wallet_transactions
// ═══════════════════════════════════════════════════════════════════════════
//
// NO COLUMN: `Wallet.processedSessions[]`. 0001 replaces it with the
// `stripe_processed_sessions` TABLE, on purpose — it was an unbounded array on
// a hot document that every webhook had to read, scan and rewrite. It is
// reached through `creditWallet`'s idempotency key, not through the wallet
// aggregate, so it is not part of this map.

export const WALLET_COLUMNS: FieldMap = {
  uid: { name: 'domain_uid', type: 'text', readOnly: true },
  eventCredits: { name: 'event_credits', type: 'integer' },
  lifetimeFreeRunsUsed: { name: 'lifetime_free_runs_used', type: 'integer' },
  bonusFreeRuns: { name: 'bonus_free_runs', type: 'integer', omitWhenDefault: 0 },
  plan: { name: 'plan', type: 'enum', enumType: 'wallet_plan' },
  proExpiresAt: { name: 'pro_expires_at', type: 'timestamptz', nullable: true, emitNull: true },
  stripeCustomerId: { name: 'stripe_customer_id', type: 'text', nullable: true },
  stripeSubscriptionId: {
    name: 'stripe_subscription_id', type: 'text', nullable: true, emitNull: true,
  },
  lastPackageMaxParticipants: {
    name: 'last_package_max_participants', type: 'integer', nullable: true,
  },
  referredBy: { name: 'referred_by', type: 'uuid', nullable: true },
  referralClaimedAt: { name: 'referral_claimed_at', type: 'timestamptz', nullable: true },
  referralCount: { name: 'referral_count', type: 'integer', omitWhenDefault: 0 },
  balanceILS: { name: 'balance_ils', type: 'numeric', nullable: true },
  updatedAt: { name: 'updated_at', type: 'timestamptz' },
};

export const WALLET_TX_COLUMNS: FieldMap = {
  id: { name: 'id', type: 'uuid' },
  type: { name: 'type', type: 'enum', enumType: 'transaction_type' },
  description: { name: 'description', type: 'text' },
  amountILS: { name: 'amount_ils', type: 'numeric', nullable: true },
  priceILS: { name: 'price_ils', type: 'numeric', nullable: true },
  credits: { name: 'credits', type: 'integer', nullable: true },
  creditCost: { name: 'credit_cost', type: 'integer', nullable: true },
  packageId: { name: 'package_id', type: 'text', nullable: true },
  maxParticipantsPerRun: { name: 'max_participants_per_run', type: 'integer', nullable: true },
  gameTitle: { name: 'game_title', type: 'text', nullable: true },
  runId: { name: 'run_id', type: 'text', nullable: true },
  teamId: { name: 'team_id', type: 'uuid', nullable: true },
  stripePaymentIntentId: {
    name: 'stripe_payment_intent_id', type: 'text', nullable: true,
  },
  createdAt: { name: 'created_at', type: 'timestamptz' },
};


// ═══════════════════════════════════════════════════════════════════════════
// games
// ═══════════════════════════════════════════════════════════════════════════
//
// `stages` stays a BLOB (README §6, and the long rationale on the table in
// 0001). It is written wholesale by the Builder, validated as a whole unit, and
// copied verbatim by import/export/duplicate/publish. There is deliberately no
// getTask / updateTask / listTasks on this interface.
//
// HANDLED OUTSIDE THIS MAP: `approxLocation` — one domain field over THREE
// columns (approx_lat / approx_lng / approx_label), because the gallery filters
// and sorts on it and a jsonb point cannot use a btree range scan. See
// `expandApproxLocation` / `readApproxLocation` in repository.ts.

export const GAME_COLUMNS: FieldMap = {
  id: { name: 'id', type: 'text', readOnly: true },
  ownerUid: { name: 'domain_owner_uid', type: 'text', readOnly: true },
  title: { name: 'title', type: 'text' },
  description: { name: 'description', type: 'text', nullable: true },
  mode: { name: 'mode', type: 'enum', enumType: 'game_mode' },
  stages: { name: 'stages', type: 'jsonb' },
  scoringPreset: { name: 'scoring_preset', type: 'enum', enumType: 'scoring_preset' },
  scoringOptions: { name: 'scoring_options', type: 'jsonb', nullable: true },
  registrationFields: { name: 'registration_fields', type: 'jsonb' },
  branding: { name: 'branding', type: 'jsonb', nullable: true },
  visibility: { name: 'visibility', type: 'enum', enumType: 'visibility' },
  tags: { name: 'tags', type: 'text[]' },
  coverImage: { name: 'cover_image', type: 'text', nullable: true },
  playCount: { name: 'play_count', type: 'integer' },
  requiresGuardianConsent: {
    name: 'requires_guardian_consent', type: 'boolean', omitWhenDefault: false,
  },
  minAge: { name: 'min_age', type: 'integer', nullable: true },
  // `SafeZone | null` — the canonical ABSENT-vs-NULL case in the whole codebase.
  safeZone: { name: 'safe_zone', type: 'jsonb', nullable: true, emitNull: true },
  benchmarkOptOut: { name: 'benchmark_opt_out', type: 'boolean', omitWhenDefault: false },
  integrationWebhookUrl: { name: 'integration_webhook_url', type: 'text', nullable: true },
  integrationPlatform: { name: 'integration_platform', type: 'text', nullable: true },
  allowInstantPlay: { name: 'allow_instant_play', type: 'boolean', omitWhenDefault: false },
  photoFeedEnabled: { name: 'photo_feed_enabled', type: 'boolean' },
  powerUpsEnabled: { name: 'power_ups_enabled', type: 'boolean', omitWhenDefault: false },
  manualLeaderboardReveal: {
    name: 'manual_leaderboard_reveal', type: 'boolean', omitWhenDefault: false,
  },
  instructions: { name: 'instructions', type: 'jsonb', nullable: true },
  // TOMBSTONE. `games_tombstone_pair` requires both or neither, so the two are
  // always patched together by the soft-delete caller.
  deletedAt: { name: 'deleted_at', type: 'timestamptz', nullable: true },
  deletedBy: { name: 'deleted_by', type: 'uuid', nullable: true },
  createdAt: { name: 'created_at', type: 'timestamptz' },
  updatedAt: { name: 'updated_at', type: 'timestamptz' },
};


// ═══════════════════════════════════════════════════════════════════════════
// runs
// ═══════════════════════════════════════════════════════════════════════════
//
// HANDLED OUTSIDE THIS MAP: `taskStatusOverrides` — a Record<taskId, status>
// that 0001 promotes to the `run_task_overrides` CHILD TABLE, so one stop can be
// closed without rewriting a map. Read as an aggregate sub-select, written as a
// replace. See `readTaskStatusOverrides` / `writeTaskStatusOverrides`.

export const RUN_COLUMNS: FieldMap = {
  id: { name: 'id', type: 'text', readOnly: true },
  gameId: { name: 'game_id', type: 'text', readOnly: true },
  ownerUid: { name: 'domain_owner_uid', type: 'text', readOnly: true },
  status: { name: 'status', type: 'enum', enumType: 'run_status' },
  accessCode: { name: 'access_code', type: 'text' },
  staffPin: { name: 'staff_pin', type: 'text', nullable: true },
  launchedAt: { name: 'launched_at', type: 'timestamptz', nullable: true },
  finishedAt: { name: 'finished_at', type: 'timestamptz', nullable: true },
  billingType: { name: 'billing_type', type: 'enum', enumType: 'billing_type' },
  maxParticipants: { name: 'max_participants', type: 'integer' },
  isTestDrive: { name: 'is_test_drive', type: 'boolean', omitWhenDefault: false },
  participantCount: { name: 'participant_count', type: 'integer' },
  deviceCount: { name: 'device_count', type: 'integer', omitWhenDefault: 0 },
  freeParticipantsUsed: { name: 'free_participants_used', type: 'integer', nullable: true },
  leaderboard: { name: 'leaderboard', type: 'jsonb', nullable: true },
  hotZone: { name: 'hot_zone', type: 'jsonb', nullable: true },
  whiteLabel: { name: 'white_label', type: 'boolean', omitWhenDefault: false },
  brand: { name: 'brand', type: 'jsonb', nullable: true },
  selfGuided: { name: 'self_guided', type: 'boolean', omitWhenDefault: false },
  createdAt: { name: 'created_at', type: 'timestamptz' },
  updatedAt: { name: 'updated_at', type: 'timestamptz' },
};


// ═══════════════════════════════════════════════════════════════════════════
// run_teams  (+ run_team_stages, run_task_records)
// ═══════════════════════════════════════════════════════════════════════════
//
// `RunTeam.stages[] -> RunStageRecord.tasks[] -> RunTaskRecord` was ONE
// Firestore document and is THREE tables here. `stages` therefore has no column
// and is NOT in this map — `patchTeam` is contractually top-level-only, and the
// tree is written by `putTeam` / `replaceTeamStages` / `patchStageRecord` /
// `patchTaskRecord` (README §5).
//
// ALSO NOT HERE, and folded onto `run_task_records` instead — these were maps
// keyed by taskId only because Firestore had nowhere else to put a per-(team,
// task) fact (see the table comment in 0001):
//   taskHintsUsed[]        → run_task_records.hint_purchased
//   taskAttempts{}         → .attempts
//   taskStepProgress{}     → .step_progress
//   stationHintsUsed{}     → .station_hints_used
//   smartVerifications{}   → .smart_verifications
//   answerPenalties{}      → .penalty_charged / .last_answer_hash /
//                            .cooldown_until / .last_failure_at / .lockout_ms /
//                            .failure_count
// They are folded on write and REASSEMBLED on read, so the domain object a
// caller gets back is the same shape Firestore returned.

export const RUN_TEAM_COLUMNS: FieldMap = {
  id: { name: 'domain_team_id', type: 'text', readOnly: true },
  runId: { name: 'run_id', type: 'text', readOnly: true },
  ownerUid: { name: 'domain_owner_uid', type: 'text', readOnly: true },
  gameId: { name: 'game_id', type: 'text' },
  displayName: { name: 'display_name', type: 'text' },
  registrationData: { name: 'registration_data', type: 'jsonb' },
  memberNames: { name: 'member_names', type: 'text[]', decode: emptyArrayIsAbsent },
  memberCount: { name: 'member_count', type: 'integer', nullable: true },
  status: { name: 'status', type: 'enum', enumType: 'team_status' },
  score: { name: 'score', type: 'numeric' },
  bonusPenalty: { name: 'bonus_penalty', type: 'numeric' },
  powerUps: { name: 'power_ups', type: 'jsonb', nullable: true },
  guardianConsent: { name: 'guardian_consent', type: 'jsonb', nullable: true },
  outOfBounds: { name: 'out_of_bounds', type: 'boolean', omitWhenDefault: false },
  outOfBoundsAt: { name: 'out_of_bounds_at', type: 'timestamptz', nullable: true },
  outOfBoundsOverrideUntil: {
    name: 'out_of_bounds_override_until', type: 'timestamptz', nullable: true,
  },
  lastBreachAlertAt: { name: 'last_breach_alert_at', type: 'timestamptz', nullable: true },
  discoveryState: { name: 'discovery_state', type: 'jsonb', nullable: true },
  // `string | null` — the station-occupancy mirror, and the field `contract.ts`
  // uses to prove that null, DELETE and omission are three different patches.
  activeTaskId: { name: 'active_task_id', type: 'text', nullable: true, emitNull: true },
  launched: { name: 'launched', type: 'boolean' },
  startedAt: { name: 'started_at', type: 'timestamptz', nullable: true },
  finishedAt: { name: 'finished_at', type: 'timestamptz', nullable: true },
  // `not null default 0` over an OPTIONAL domain field: 0 and "no streak" are
  // the same fact, so DELETE ⇒ DEFAULT ⇒ read back as absent.
  smartStreak: { name: 'smart_streak', type: 'integer', omitWhenDefault: 0 },
  streakMultiplier: { name: 'streak_multiplier', type: 'numeric', nullable: true },
  evacuatedFrom: { name: 'evacuated_from', type: 'text', nullable: true, emitNull: true },
  deviceUids: { name: 'device_uids', type: 'uuid[]', decode: emptyArrayIsAbsent },
  controllerUid: { name: 'controller_uid', type: 'uuid', nullable: true },
  deviceJoinCode: { name: 'device_join_code', type: 'text', nullable: true },
  devices: { name: 'devices', type: 'jsonb', decode: emptyArrayIsAbsent },
  updatedAt: { name: 'updated_at', type: 'timestamptz' },
};

export const STAGE_COLUMNS: FieldMap = {
  stageId: { name: 'stage_id', type: 'text', readOnly: true },
  order: { name: 'stage_order', type: 'integer' },
  status: { name: 'status', type: 'enum', enumType: 'stage_status' },
  startedAt: { name: 'started_at', type: 'timestamptz', nullable: true },
  completedAt: { name: 'completed_at', type: 'timestamptz', nullable: true },
  requiredTaskCount: { name: 'required_task_count', type: 'integer', nullable: true },
  earnedScore: { name: 'earned_score', type: 'numeric', omitWhenDefault: 0 },
  // `tasks` has no column — it is the run_task_records rows.
};

export const TASK_COLUMNS: FieldMap = {
  taskId: { name: 'task_id', type: 'text', readOnly: true },
  taskIndex: { name: 'task_index', type: 'integer' },
  status: { name: 'status', type: 'enum', enumType: 'task_status' },
  startedAt: { name: 'started_at', type: 'timestamptz', nullable: true },
  completedAt: { name: 'completed_at', type: 'timestamptz', nullable: true },
  arrivedAt: { name: 'arrived_at', type: 'timestamptz', nullable: true },
  actualMinutes: { name: 'actual_minutes', type: 'numeric', nullable: true },
  excludedMs: { name: 'excluded_ms', type: 'bigint', nullable: true },
  expectedDurationMinutesAtCompletion: {
    name: 'expected_duration_minutes_at_completion', type: 'numeric', nullable: true,
  },
  earnedScore: { name: 'earned_score', type: 'numeric', nullable: true },
  scoreBreakdown: { name: 'score_breakdown', type: 'jsonb', nullable: true },
  verificationOutcome: {
    name: 'verification_outcome', type: 'enum', enumType: 'verification_outcome', nullable: true,
  },
  photoUrl: { name: 'photo_url', type: 'text', nullable: true },
  surveyResponse: { name: 'survey_response', type: 'text', nullable: true },
};

/** The folded per-(team,task) columns, written and read outside TASK_COLUMNS. */
export const FOLDED_TASK_COLUMNS = {
  attempts: 'attempts',
  hintPurchased: 'hint_purchased',
  penaltyCharged: 'penalty_charged',
  cooldownUntil: 'cooldown_until',
  lastFailureAt: 'last_failure_at',
  lockoutMs: 'lockout_ms',
  failureCount: 'failure_count',
  lastAnswerHash: 'last_answer_hash',
  stepProgress: 'step_progress',
  stationHintsUsed: 'station_hints_used',
  smartVerifications: 'smart_verifications',
} as const;


// ═══════════════════════════════════════════════════════════════════════════
// staff_invites
// ═══════════════════════════════════════════════════════════════════════════
//
// `staff_invites.id` is `uuid`; `StaffInvite.id` is a string and there is no
// `legacy_firebase_uid` companion on this table. A non-uuid invite id therefore
// resolves DETERMINISTICALLY to a row (so get / consume by that id work) but
// reads back as the derived uuid. See ids.ts.

export const INVITE_COLUMNS: FieldMap = {
  id: { name: 'id', type: 'uuid', readOnly: true },
  runId: { name: 'run_id', type: 'text', readOnly: true },
  gameId: { name: 'game_id', type: 'text' },
  ownerUid: { name: 'domain_owner_uid', type: 'text', readOnly: true },
  pin: { name: 'pin', type: 'text' },
  displayName: { name: 'display_name', type: 'text', nullable: true },
  permissions: { name: 'permissions', type: 'enum[]', enumType: 'staff_permission' },
  usedAt: { name: 'used_at', type: 'timestamptz', nullable: true },
  createdAt: { name: 'created_at', type: 'timestamptz' },
};


// ═══════════════════════════════════════════════════════════════════════════
// access_codes
// ═══════════════════════════════════════════════════════════════════════════

export const ACCESS_CODE_COLUMNS: FieldMap = {
  code: { name: 'code', type: 'text', readOnly: true },
  ownerUid: { name: 'domain_owner_uid', type: 'text', readOnly: true },
  gameId: { name: 'game_id', type: 'text' },
  runId: { name: 'run_id', type: 'text' },
  status: { name: 'status', type: 'enum', enumType: 'access_code_status' },
  teamId: { name: 'team_id', type: 'uuid', nullable: true, emitNull: true },
  usedAt: { name: 'used_at', type: 'timestamptz', nullable: true, emitNull: true },
  revokedByGameDeletionAt: {
    name: 'revoked_by_game_deletion_at', type: 'timestamptz', nullable: true,
  },
  revokedFromStatus: {
    name: 'revoked_from_status', type: 'enum', enumType: 'access_code_status', nullable: true,
  },
  createdAt: { name: 'created_at', type: 'timestamptz' },
};


// ═══════════════════════════════════════════════════════════════════════════
// audit_logs — append-only by contract; there is no patch and no delete
// ═══════════════════════════════════════════════════════════════════════════
//
// NOTE the domain calls the instant `timestamp`; the column is `created_at`.
// `previousValue`/`newValue` are `number | string | null` in the domain and
// plain `text` here, so a numeric adjustment reads back as its decimal string.
// That is the schema's choice, not this file's, and it is why the audit trail is
// display-only and nothing computes on it.

export const AUDIT_COLUMNS: FieldMap = {
  id: { name: 'id', type: 'uuid' },
  timestamp: { name: 'created_at', type: 'timestamptz' },
  ownerUid: { name: 'owner_uid', type: 'uuid' },
  gameId: { name: 'game_id', type: 'text', nullable: true },
  runId: { name: 'run_id', type: 'text', nullable: true },
  teamId: { name: 'team_id', type: 'uuid', nullable: true },
  teamName: { name: 'team_name', type: 'text', nullable: true },
  operatorId: { name: 'operator_id', type: 'uuid' },
  actionType: { name: 'action_type', type: 'enum', enumType: 'audit_action_type' },
  previousValue: { name: 'previous_value', type: 'text', nullable: true, emitNull: true },
  newValue: { name: 'new_value', type: 'text', nullable: true, emitNull: true },
  reason: { name: 'reason', type: 'text', nullable: true },
};
