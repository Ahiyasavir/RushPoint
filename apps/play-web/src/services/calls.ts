import { callable } from './firebase';
import type { RunTeam, GameBranding, RunLeaderboard, Task, RegistrationField } from '@rushpoint/shared';

export interface JoinInfo {
  context: { ownerUid: string; gameId: string; runId: string };
  title: string;
  description: string;
  mode: 'individual' | 'team';
  branding: GameBranding | null;
  registrationFields: RegistrationField[];
  runStatus: string;
}
export const getJoinInfo = callable<{ code: string }, JoinInfo>('getJoinInfo');

export interface JoinResult {
  teamId: string; runId: string; gameId: string; ownerUid: string; alreadyJoined: boolean;
}
export const joinRun = callable<
  { code: string; displayName: string; registrationData?: Record<string, unknown>; memberNames?: string[] },
  JoinResult
>('joinRun');

// Sanitized task shape returned to participants (no secretCode)
export type SafeTask = Omit<Task, 'smart'> & {
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
  run: { id: string; status: string; accessCode: string; leaderboard: RunLeaderboard | null };
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
