// Typed wrappers around every creator-facing Cloud Function callable.
import { callable } from './api';
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
} from '@rushpoint/shared';

// ── Games ──
export const createGame    = callable<CreateGamePayload, { gameId: string }>('createGame');
export const updateGame    = callable<UpdateGamePayload, { ok: boolean }>('updateGame');
export const deleteGame    = callable<{ gameId: string }, { ok: boolean }>('deleteGame');
export const duplicateGame = callable<{ gameId: string; sourceOwnerUid?: string }, { gameId: string }>('duplicateGame');
export const publishGame   = callable<{ gameId: string; visibility: 'public' | 'private' }, { ok: boolean; visibility: string }>('publishGame');
export const getGame       = callable<{ gameId: string }, { game: Game }>('getGame');
export const listGames     = callable<void, { games: Game[] }>('listGames');

// ── Runs ──
export const launchRun     = callable<{ gameId: string }, { runId: string; accessCode: string }>('launchRun');
export const startTeams    = callable<{ gameId: string; runId: string; teamIds?: string[] }, { launched: number }>('startTeams');
export const skipStage     = callable<{ gameId: string; runId: string; teamId: string }, { ok: boolean }>('skipStage');
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
export const getRunReplay    = callable<{ code: string }, RunReplayResult>('getRunReplay');
export const getRunRecap     = callable<{ code: string }, RunRecapResult>('getRunRecap');
export const translateGame   = callable<{ gameId: string; targetLang: string }, { gameId: string; targetLang: string }>('translateGame');

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
  completedStages: number;
  activeStageOrder: number | null;
  finished: boolean;
  launched: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

// ── Gallery ──
export const searchGallery     = callable<{ query?: string; tags?: string[]; limit?: number }, { games: PublicGame[] }>('searchGallery');
export const searchTaskLibrary = callable<{ query?: string; tags?: string[]; limit?: number }, { tasks: PublicTask[] }>('searchTaskLibrary');
export const incrementTaskCopyCount = callable<{ publicTaskId: string }, { ok: boolean }>('incrementTaskCopyCount');

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
export const pushAnnouncement      = callable<{ ownerUid: string; gameId: string; runId: string; message: string; messageHe?: string }, { announcementId: string }>('pushAnnouncement');
export const pushFlashMission      = callable<{ ownerUid: string; gameId: string; runId: string; title: string; description?: string; bonusPoints: number; ttlSeconds: number }, { id: string; expiresAt: string }>('pushFlashMission');
export const acknowledgeAlert      = callable<{ ownerUid: string; gameId: string; runId: string; alertId: string }, { ok: boolean }>('acknowledgeAlert');
export const reviewStationSubmission = callable<{ ownerUid: string; gameId: string; runId: string; teamId: string; taskId: string; approved: boolean; note?: string }, { ok: boolean; approved: boolean }>('reviewStationSubmission');
export const adjustTeamScore       = callable<{ ownerUid: string; gameId: string; runId: string; teamId: string; delta: number; reason?: string }, { ok: boolean; newBonusPenalty: number }>('adjustTeamScore');
