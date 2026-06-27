import { callable } from './firebase';
import type { RunTeam, GameBranding, RunLeaderboard, LeaderboardEntry, Task, RegistrationField, GameRequirement } from '@rushpoint/shared';

export interface JoinInfo {
  context: { ownerUid: string; gameId: string; runId: string };
  title: string;
  description: string;
  mode: 'individual' | 'team';
  branding: GameBranding | null;
  registrationFields: RegistrationField[];
  runStatus: string;
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
}
export const getPublicLeaderboard = callable<{ code: string }, PublicLeaderboard>('getPublicLeaderboard');

export interface JoinResult {
  teamId: string; runId: string; gameId: string; ownerUid: string; alreadyJoined: boolean;
}
export const joinRun = callable<
  { code: string; displayName: string; registrationData?: Record<string, unknown>; memberNames?: string[] },
  JoinResult
>('joinRun');

// Sanitized task shape returned to participants — every answer key is stripped
// server-side (secretCode, hint text, quiz answers, numeric target, step answers).
export type SafeTask = Omit<Task, 'smart' | 'hint' | 'answers' | 'numericAnswer' | 'steps'> & {
  hasHint?: boolean;
  hintPenalty?: number;
  steps?: { id: string; prompt: string }[];
  smart?: {
    enabled: boolean;
    verificationType: 'code_verification' | 'photo_upload';
    longInstructions?: string;
    codeInputLabel?: string;
    hasCode?: boolean;
    autoApprove?: boolean;
    stationCoords?: { lat: number; lng: number };
  };
};

export interface MyTeamState {
  team: RunTeam;
  run: { id: string; status: string; accessCode: string; billingType: 'free' | 'credit' | 'pro'; leaderboard: RunLeaderboard | null };
  game: { id: string; title: string; mode: string; scoringPreset: string; branding: GameBranding | null; stageCount: number };
  activeStageTasks: SafeTask[];
  context: { ownerUid: string; gameId: string; runId: string };
}
export const getMyTeamState = callable<
  { ownerUid?: string; gameId?: string; runId?: string; code?: string },
  MyTeamState
>('getMyTeamState');

type Ctx = { ownerUid: string; gameId: string; runId: string };

export const completeTask = callable<
  Ctx & { taskId: string; lat?: number; lng?: number },
  { ok: boolean; nextTaskId: string | null }
>('completeTask');

export const requestNextTask = callable<Ctx & { lat?: number; lng?: number }, { taskId: string | null }>('requestNextTask');

export const requestTaskHint = callable<
  Ctx & { taskId: string },
  { hint: string; penalty: number; alreadyUsed: boolean }
>('requestTaskHint');

export const submitTaskAnswer = callable<
  Ctx & { taskId: string; answer: string; lat?: number; lng?: number },
  { correct: boolean; nextTaskId?: string | null }
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
  Ctx & { teamId: string; taskId: string; photoUrl: string },
  { submitted: boolean; autoApproved: boolean }
>('submitStationPhoto');

export const triggerSOS = callable<
  Ctx & { lat?: number; lng?: number; message?: string },
  { alertId: string }
>('triggerSOS');

export const updateLocation = callable<Ctx & { lat: number; lng: number }, { ok: boolean }>('updateLocation');

export const staffSignIn = callable<
  { ownerUid: string; gameId: string; runId: string; pin: string },
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
