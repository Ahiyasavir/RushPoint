// Typed wrappers around every creator-facing Cloud Function callable.
import { callable, publicCallable } from './api';
import type {
  Game,
  CreateGamePayload,
  UpdateGamePayload,
  PublicGame,
  PublicTask,
  Wallet,
  WalletStatus,
  EventPackageId,
  LeaderboardEntry,
  HotZone,
  TaskAnalytics,
  ReplayEvent,
  ScorePoint,
  RunRecap,
  RunSummary,
  RunFeedback,
  RunFeedbackSummary,
  LiveRunSummary,
  RunHeatmapResult,
  Trackable,
  CaptureZone,
  GameFile,
  StationStatus,
  GalleryGameFacets,
  GalleryTaskFacets,
  AdminUserSummary,
  TemplateGenre,
  RunPlayerReport,
  GameShareLink,
  ShareLinkRefusal,
  SharedGameView,
} from '@rushpoint/shared';

// ── Games ──
export const createGame    = callable<CreateGamePayload, { gameId: string }>('createGame');
export const updateGame    = callable<UpdateGamePayload, { ok: boolean }>('updateGame');
// SOFT delete (change: recoverable-game-deletion): tombstones the game and
// revokes its join codes. Destroys nothing — see purgeGameNow / the trash view.
export const deleteGame    = callable<{ gameId: string }, { ok: boolean; deletedAt: string; purgeDueAt: string | null }>('deleteGame');
// `shareToken` is the third door (change: game-share-link): the token resolves
// the owner and the game itself, so gameId/sourceOwnerUid are not sent with it.
export const duplicateGame = callable<
  { gameId?: string; sourceOwnerUid?: string; shareToken?: string },
  { gameId: string }
>('duplicateGame');
export const publishGame   = callable<{ gameId: string; visibility: 'public' | 'private' }, { ok: boolean; visibility: string }>('publishGame');
export const getGame       = callable<{ gameId: string }, { game: Game }>('getGame');

// ── Share links (change: game-share-link) ──
// A read-only link to an UNPUBLISHED game. `getSharedGame` needs no account: it
// is the one call this app makes that a signed-out visitor is expected to make.
export const createGameShareLink = callable<
  { gameId: string; allowCopy?: boolean; revealAnswers?: boolean; expiresInDays?: number },
  { link: GameShareLink }
>('createGameShareLink');
export const listGameShareLinks = callable<
  { gameId: string },
  { links: (GameShareLink & { refusal: ShareLinkRefusal | null })[] }
>('listGameShareLinks');
export const revokeGameShareLink = callable<{ token: string }, { ok: boolean; revokedAt: string }>('revokeGameShareLink');
export const getSharedGame = publicCallable<
  { token: string },
  { game: SharedGameView; allowCopy: boolean; sharedAt: string }
>('getSharedGame');
export const listGames     = callable<void, { games: Game[] }>('listGames');
// Creator-owned portability (change: game-file-export-import). exportGameFile is
// OWNER-ONLY: the document it returns deliberately contains answer keys, hint text,
// station codes and hidden-location coordinates, so it must never be surfaced
// anywhere but the owner's own console.
//
// importGameFile has TWO doors. Without `targetGameId` it creates a NEW game (the
// Dashboard's "import a game"). With one, it REPLACES the authored content of a game
// the caller already owns, keeping that document's server-owned fields — which is the
// only way to update an admin template from a file: the template flag deliberately
// cannot travel in the file, so a fresh-document import always lands as an ordinary
// game in "my games".
export const exportGameFile = callable<{ gameId: string }, { file: GameFile }>('exportGameFile');
export const importGameFile = callable<
  { file: GameFile; targetGameId?: string },
  { gameId: string; stageCount: number; replaced?: boolean }
>('importGameFile');

// ── Game trash (change: recoverable-game-deletion) ──
// deleteGame no longer destroys anything: it tombstones the game, which stays
// recoverable for `retentionDays` before it is permanently purged.
export type TrashedGame = Game & { purgeDueAt: string | null };
export const listDeletedGames = callable<void, { games: TrashedGame[]; retentionDays: number }>('listDeletedGames');
export const restoreGame      = callable<{ gameId: string }, { ok: boolean; alreadyRestored?: boolean; restoredCodes?: number }>('restoreGame');
export const purgeGameNow     = callable<{ gameId: string }, { ok: boolean }>('purgeGameNow');

// ── Runs ──
export const launchRun     = callable<{ gameId: string; testDrive?: boolean }, { runId: string; accessCode: string }>('launchRun');
// `heldForConsent` counts teams the server refused to start because the game
// requires guardian consent and none is recorded (change: expose-enforced-settings).
// Optional so an older backend simply reports nothing rather than breaking.
export const startTeams    = callable<{ gameId: string; runId: string; teamIds?: string[] }, { launched: number; heldForConsent?: number }>('startTeams');
export const skipStage     = callable<{ gameId: string; runId: string; teamId: string }, { ok: boolean }>('skipStage');
// Skip ONE mission for ONE team, keeping them inside the same stage
// (change: skip-single-task). `taskId` omitted means "the mission this team is on
// right now", resolved server-side. `requiredTaskCount` comes back so the console
// can say when the skip lowered what that team must complete in the stage.
export const skipTaskForTeam = callable<
  { ownerUid?: string; gameId: string; runId: string; teamId: string; taskId?: string; reason?: string },
  {
    ok: boolean; taskId: string; stageCompleted: boolean;
    requiredTaskCount: number; requirementLowered: boolean;
    nextTaskId: string | null; nextReason: string | null;
  }
>('skipTaskForTeam');
export const finalizeRun   = callable<{ gameId: string; runId: string }, { rankings: LeaderboardEntry[] }>('finalizeRun');
export const refreshLeaderboard = callable<
  { ownerUid: string; gameId: string; runId: string; publish?: boolean; frozen?: boolean },
  { rankings: LeaderboardEntry[]; published: boolean; frozen: boolean }
>('refreshLeaderboard');
export const listRunTeams  = callable<{ gameId: string; runId: string }, { teams: RunTeamRow[] }>('listRunTeams');

// ── Live-ops & post-run tools (deferred-UI callables now wired) ──
export const activateHotZone = callable<
  { gameId: string; runId: string; center: { lat: number; lng: number }; radiusMeters: number; multiplier: number; durationMinutes: number },
  { ok: boolean; hotZone: HotZone }
>('activateHotZone');
export const deactivateHotZone = callable<{ gameId: string; runId: string }, { ok: boolean }>('deactivateHotZone');
export const getRunAnalytics = callable<{ code: string }, RunAnalyticsResult>('getRunAnalytics');
export const getRunHeatmap   = callable<{ code: string }, RunHeatmapResult>('getRunHeatmap');
export type { RunHeatmapResult } from '@rushpoint/shared';
export const getRunReplay    = callable<{ code: string }, RunReplayResult>('getRunReplay');
export const getRunRecap     = callable<{ code: string }, RunRecapResult>('getRunRecap');
// Post-run organizer summary (change: run-summary-report) — standings + completion
// + feedback digest folded into one; also emailed to the organizer on finalize.
export const getRunSummary   = callable<{ code: string }, RunSummary>('getRunSummary');
export const getRunFeedbackSummary = callable<
  { gameId: string; runId: string },
  { summary: RunFeedbackSummary; responses: RunFeedback[] }
>('getRunFeedbackSummary');
// Survey results (change: survey-tasks) — owner / run-staff read-only aggregation.
export interface SurveyResultRow {
  taskId: string;
  title: string;
  surveyChoices?: string[];                          // present ⇒ choice survey
  counts?: Record<string, number>;                   // choice: per-choice tally (0-filled)
  responses?: { teamName: string; response: string }[]; // free-text rows
  responseCount: number;
}
export const getRunSurveyResults = callable<
  { gameId: string; runId: string },
  { results: SurveyResultRow[] }
>('getRunSurveyResults');
export const translateGame   = callable<{ gameId: string; targetLang: string }, { gameId: string; targetLang: string }>('translateGame');
// Multi-run GM overview (change: multi-run-gm-panel).
export const listLiveRuns    = callable<Record<string, never>, { runs: LiveRunSummary[] }>('listLiveRuns');

// ── Run history + the post-run report (change: post-run-player-report) ──
// Addressed by {gameId, runId}, NOT by access code, on purpose: every other
// post-run surface resolves through `accessCodes/{CODE}`, and a code is revoked
// when a game is trashed and is not something a creator still holds weeks later —
// which is exactly why a finished run used to be unreachable.
export interface MyRunRow {
  ownerUid: string;
  gameId: string;
  runId: string;
  gameTitle: string;
  accessCode: string;
  status: string;
  launchedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  participantCount: number;
  isTestDrive: boolean;
  leaderboardPublished: boolean;
  topTeamName: string | null;
  topScore: number | null;
}
export const listMyRuns = callable<
  { gameId?: string; limit?: number },
  { runs: MyRunRow[]; truncated: boolean }
>('listMyRuns');

// OWNER-ONLY. The response deliberately carries team-level identity AND the answer
// keys AND what each player submitted — everything `getRunAnalytics` is careful to
// keep out of an anonymous aggregate — so it must never be surfaced anywhere but
// the owner's own console.
export type { RunPlayerReport } from '@rushpoint/shared';
export const getRunPlayerReport = callable<
  { gameId: string; runId: string },
  RunPlayerReport
>('getRunPlayerReport');
// Trackable collectibles (change: trackable-collectibles).
export const createTrackable  = callable<{ gameId: string; runId: string; name: string; description?: string; homeTaskId?: string }, { trackable: Trackable }>('createTrackable');
export const getRunTrackables = callable<{ ownerUid?: string; gameId?: string; runId?: string; code?: string }, { trackables: Trackable[] }>('getRunTrackables');
// Territory / contested-zone capture (change: territory-capture).
export const createZone   = callable<{ gameId: string; runId: string; title: string; lat: number; lng: number; radiusMeters?: number; captureBonus?: number }, { zone: CaptureZone }>('createZone');
export const deleteZone   = callable<{ gameId: string; runId: string; zoneId: string }, { ok: boolean }>('deleteZone');
export const getRunZones  = callable<{ ownerUid?: string; gameId?: string; runId?: string; code?: string }, { zones: CaptureZone[] }>('getRunZones');

export interface RunAnalyticsResult { title: string; runStatus: string; teamCount: number; overallCompletionRate: number; tasks: TaskAnalytics[] }
export interface RunReplayResult { title: string; runStatus: string; events: ReplayEvent[]; scoreSeries: Record<string, ScorePoint[]>; teams: { teamId: string; teamName: string }[] }
export interface RunRecapResult extends RunRecap { title: string; runStatus: string; published: boolean }

export interface RunTeamRow {
  id: string;
  displayName: string;
  memberNames: string[];
  memberCount: number;
  status: string;
  score: number;
  /** Hints + staff adjustments; subtracted from score at ranking time. */
  bonusPenalty: number;
  completedStages: number;
  /** Pending photo/audio station submissions awaiting staff review (WO-4). */
  pendingReviews: number;
  activeStageOrder: number | null;
  finished: boolean;
  launched: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Safe-zone latch: the team is soft-paused until it is verifiably back inside. */
  outOfBounds?: boolean;
  // ── Attention signals (change: run-console-attention) ──
  // Read-only projections consumed by `lib/teamAttention`. All optional: a row
  // without them classifies as "no evidence", never as a false alarm.
  /** `RunTeam.updatedAt` — last server write for this team; the idle clock. */
  updatedAt?: string | null;
  /** Latest expiry (epoch ms) across the wrong-answer retry lockouts, or null. */
  answerLockoutUntil?: number | null;
  /** `teamLocations/{teamId}.updatedAt` — GPS stream freshness, not a position. */
  lastLocationAt?: string | null;
  /**
   * The team is one `startTeams` would hold back (change: held-team-visibility).
   * A boolean, never a guardian's identity. Optional: a backend that predates the
   * projection degrades to "not held" rather than to a false alarm.
   */
  heldForConsent?: boolean;
}

// ── Gallery ──
// Results come back most-popular-first (relevance first when a query is set), and
// `likedIds` is the CALLER'S own likes among the returned items — so the like
// button renders correctly on first paint with no second round trip and without
// any client ever reading the (server-only) publicLikes collection.
// The optional facet fields (mode / sort for games; type / difficulty /
// hasLocation / sort for tasks) mirror the server's `applyGalleryFacets`
// (change: gallery-facet-filters); reuse the shared facet shapes so the two can
// never drift.
export const searchGallery     = callable<{ query?: string; tags?: string[]; limit?: number } & GalleryGameFacets, { games: PublicGame[]; likedIds: string[] }>('searchGallery');
export const searchTaskLibrary = callable<{ query?: string; tags?: string[]; limit?: number } & GalleryTaskFacets, { tasks: PublicTask[]; likedIds: string[] }>('searchTaskLibrary');
export const incrementTaskCopyCount = callable<{ publicTaskId: string }, { ok: boolean; applied?: boolean }>('incrementTaskCopyCount');
// Desired-END-STATE setter, not a toggle: sending `liked: true` twice is a no-op,
// so a retry or a double tap can never double-count (change: gallery-popularity-ranking).
export const setPublicLike     = callable<
  { kind: 'game' | 'task'; itemId: string; liked: boolean },
  { liked: boolean; likeCount: number; popularity: number }
>('setPublicLike');

// ── Popular tags (Builder quick-add suggestions) ──
// Most-used tags across the gallery, so the Builder can offer a one-tap "add this
// tag" row. Callable per the deployed backend (functions/src/gallery/index.ts).
export const getPopularTags = callable<{ limit?: number }, { tags: string[] }>('getPopularTags');
// Memoized once per session so the game-tags field and the task-tags field share a
// single round trip instead of each calling. Fails SAFE: any error resolves to an
// empty list, so a suggestion row that cannot load simply never renders — it never
// throws into the Builder.
let popularTagsCache: Promise<string[]> | undefined;
export function loadPopularTags(limit = 20): Promise<string[]> {
  if (!popularTagsCache) {
    popularTagsCache = getPopularTags({ limit })
      .then((r) => (Array.isArray(r?.tags) ? r.tags : []))
      .catch(() => []);
  }
  return popularTagsCache;
}

// ── Account management ──
export const updateMyProfile = callable<{ displayName: string }, { ok: boolean; displayName: string }>('updateMyProfile');
export const exportMyData    = callable<void, MyDataExport>('exportMyData');
export const deleteMyAccount = callable<{ confirm: boolean }, { ok: boolean }>('deleteMyAccount');

export interface MyDataExport {
  exportedAt: string;
  account: {
    uid: string;
    email: string | null;
    displayName: string | null;
    createdAt: string | null;
    lastSignIn: string | null;
    providers: string[];
  };
  profile: Record<string, unknown> | null;
  games: unknown[];
  wallet: Wallet | null;
  transactions: unknown[];
}

// ── Wallet & billing (Event Credits) ──
export const getWallet       = callable<void, { wallet: Wallet }>('getWallet');
export const getWalletStatus = callable<void, WalletStatus>('getWalletStatus');
export const purchaseCredits = callable<{ packageId: EventPackageId }, { checkoutUrl: string | null; mock?: boolean; credits?: number }>('purchaseCredits');
export const subscribePro    = callable<{ interval: 'month' | 'year' }, { checkoutUrl: string | null; mock?: boolean; plan?: string }>('subscribePro');
export const claimReferral   = callable<{ referrerUid: string }, { ok: boolean; alreadyClaimed: boolean; bonusFreeRuns: number }>('claimReferral');

// ── Staff / live-ops ──
export const inviteStaff           = callable<{ ownerUid: string; gameId: string; runId: string; name: string; permissions: string[] }, { inviteId: string; pin: string }>('inviteStaff');
export const pushAnnouncement      = callable<{ ownerUid: string; gameId: string; runId: string; message: string; messageHe?: string; teamId?: string }, { announcementId: string }>('pushAnnouncement');
// Team ↔ HQ chat (change: team-hq-chat): HQ replies into one team's thread as from:'hq'.
export const sendTeamChatMessage   = callable<{ ownerUid: string; gameId: string; runId: string; teamId: string; text: string; senderName?: string }, { messageId: string }>('sendTeamChatMessage');
// The run's ONE shared staff↔admin thread (change: staff-console-field-ops). No
// teamId: it is run-scoped, not per team. The server stamps this side as 'admin'
// because the caller is the owner.
export const sendStaffChannelMessage = callable<{ ownerUid: string; gameId: string; runId: string; text: string; senderName?: string }, { messageId: string }>('sendStaffChannelMessage');
export const pushFlashMission      = callable<{ ownerUid: string; gameId: string; runId: string; title: string; description?: string; bonusPoints: number; ttlSeconds: number }, { id: string; expiresAt: string }>('pushFlashMission');
export const acknowledgeAlert      = callable<{ ownerUid: string; gameId: string; runId: string; alertId: string }, { ok: boolean }>('acknowledgeAlert');
// Out-of-bounds recovery: release a team the safe-zone latch is holding. The server
// keeps a short grace window so a broken phone's next bad fix can't re-latch them.
export const clearTeamOutOfBounds  = callable<{ ownerUid: string; gameId: string; runId: string; teamId: string; reason?: string }, { ok: boolean; overrideUntil: string }>('clearTeamOutOfBounds');
export const reviewStationSubmission = callable<{ ownerUid: string; gameId: string; runId: string; teamId: string; taskId: string; approved: boolean; note?: string }, { ok: boolean; approved: boolean }>('reviewStationSubmission');
export const adjustTeamScore       = callable<{ ownerUid: string; gameId: string; runId: string; teamId: string; delta: number; reason?: string }, { ok: boolean; newBonusPenalty: number }>('adjustTeamScore');
// Live photo feed moderation (change: live-photo-feed): hide an item from the run's feed.
export const hideFeedItem          = callable<{ ownerUid: string; gameId: string; runId: string; itemId: string }, { ok: boolean }>('hideFeedItem');
// Live task availability (change: live-task-pause): take one task out of play for
// THIS run, or put it back. Run scoped — the game template is never touched. A team
// already holding the task keeps it (`teamsHolding` says how many that is). The
// server refuses a change that would leave the owning stage unwinnable unless
// `force` is set, answering with details.code === 'stageUnwinnable'.
export const setRunTaskStatus      = callable<
  { ownerUid: string; gameId: string; runId: string; taskId: string; status: StationStatus; reason?: string; force?: boolean },
  {
    ok: boolean; taskId: string; status: StationStatus; previousStatus: StationStatus;
    noop: boolean; teamsHolding: number; availableCount: number; requiredCount: number;
    stageUnwinnable: boolean;
  }
>('setRunTaskStatus');

// Admin-only creator activity rollup (change: admin-user-activity-dashboard). Only
// resolves when the signed-in user's ID token carries the `admin` custom claim —
// see AdminUsersPage, which gates the call itself on `isAdminClaim`.
export const listPlatformUsers = callable<
  { limit?: number },
  { users: AdminUserSummary[]; truncated: boolean }
>('listPlatformUsers');

// Time on site flush (change: admin-engagement-and-outreach). Every signed in creator
// calls this for THEMSELVES; the server takes the uid from the token and clamps the value,
// so the payload can only ever move the caller's own total, forward, by a bounded amount.
export const recordEngagement = callable<
  { deltaMs: number },
  { ok: boolean; applied: number }
>('recordEngagement');

// Private operator note about one creator (change: admin-user-notes). Admin only.
// An empty `note` CLEARS it (the server deletes the document rather than storing a blank).
// `emailed` is OPTIONAL on purpose: omitting it leaves the tick untouched, so saving a
// note never clears the tick and ticking never wipes the note.
export const setUserNote = callable<
  { uid: string; note: string; emailed?: boolean },
  {
    ok: boolean; note: string; noteUpdatedAt: string | null;
    emailed: boolean; emailedAt: string | null; cleared: boolean;
  }
>('setUserNote');

// ── Admin-managed game templates (change: admin-manage-game-templates) ──
// A template is an ordinary Game flagged isTemplate: true, owned by whichever
// admin authored it. setGameTemplateFlag is admin-gated server-side (assertAdmin);
// listGameTemplates/createGameFromTemplate are any-authenticated-user — see
// AdminTemplatesPage (management) and DashboardPage (the creator-facing picker).
export const setGameTemplateFlag = callable<
  {
    gameId: string; isTemplate: boolean; templateEmoji?: string;
    templateOrder?: number; templateGroupKey?: string; templateLang?: string;
    // What kind of game this template is, so the new-game wizard's conceptual
    // question can resolve to it (change: guided-new-game-wizard).
    templateGenre?: TemplateGenre;
  },
  { ok: boolean; gameId: string; isTemplate: boolean }
>('setGameTemplateFlag');

export interface TemplateVariant {
  id: string;
  ownerUid: string;
  title: string;
  description?: string;
  mode: Game['mode'];
  scoringPreset: Game['scoringPreset'];
  stageCount: number;
  taskCount: number;
  /** What kind of game this is, when the admin declared one — the new-game
   *  wizard's "a story, or missions?" answer resolves through this
   *  (change: guided-new-game-wizard). */
  templateGenre?: TemplateGenre;
}
export interface TemplateGroupEntry {
  groupKey: string;
  templateEmoji?: string;
  templateOrder?: number;
  variants: Record<string, TemplateVariant>;
}
export const listGameTemplates = callable<
  Record<string, never>,
  { templates: TemplateGroupEntry[] }
>('listGameTemplates');

// `templateOwnerUid` is the owner the picker was just told about, passed back as a
// HINT so the server can read that one document instead of downloading every
// template game in full to find it by id (perf: template-picker-latency). It is
// not an authorization input — the server still requires a live isTemplate:true
// document and falls back to the scan if the hint misses.
// `description` and `tags` arrive PRE-COMPOSED from the client on purpose
// (change: guided-new-game-wizard): they are user-facing Hebrew/English copy, and
// the dictionaries live here, not on the server. `personalize` carries only the
// structural answers, which the server turns into capacity, mode, consent and
// pacing through the shared pure rules. Every new field is optional, so the plain
// picker call is unchanged.
export const createGameFromTemplate = callable<
  {
    templateGameId: string; title: string;
    scoringPreset?: Game['scoringPreset']; templateOwnerUid?: string;
    description?: string; tags?: string[];
    personalize?: { groupSize?: number; durationMinutes?: number; minAge?: number };
  },
  {
    gameId: string;
    /** The server's own estimate — the client cannot compute one (the template
     *  projection carries counts, not stages), so this is the only honest source
     *  for "this may run longer than you asked". */
    estimatedMinutes?: number;
    fitsRequestedDuration?: boolean;
  }
>('createGameFromTemplate');

// The admin console's own list. NOT listGames + a client-side isTemplate filter:
// listGames is capped at 200 documents ordered by updatedAt, so an admin with more
// games than that watched real templates fall out of the tab every time an ordinary
// game was edited. This asks the server for `isTemplate == true`, uncapped.
export const listAdminTemplates = callable<
  Record<string, never>,
  { games: Game[] }
>('listAdminTemplates');

// Contact messages sent from the marketing site (change: marketing-site). Admin only
// and audit logged server-side: every document holds the name and email address of
// someone who is NOT a user of the platform and cannot see, correct or delete what is
// stored, so "who read this list, and when" is the only accountability available.
// AdminContactPage gates the call on `isAdminClaim`; `assertAdmin` is the real boundary.
export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  language: string | null;
  receivedAt: number;
  uid: string | null;
}

export const listContactMessages = callable<
  { limit?: number },
  { messages: ContactMessage[] }
>('listContactMessages');
