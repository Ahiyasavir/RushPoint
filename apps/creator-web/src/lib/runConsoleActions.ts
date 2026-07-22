// Run Console action severity (change: run-console-progressive-disclosure).
//
// Every control the console offers is classified once, here. Two of them rewrite
// or end a real event ("end the run", "adjust a team's score") and used to sit at
// the same visual weight as "Refresh standings" — one of them was a bare `±`
// glyph with no label, no tooltip and no accessible name at all.
//
// The map is keyed by a CLOSED union, so adding a control without classifying it
// is a typecheck failure rather than a review miss. Pure: no React, no Firebase.

export type RunActionId =
  | 'startTeams' | 'refreshStandings' | 'publishStandings' | 'revealStandings'
  | 'inviteStaff' | 'acknowledgeAlert' | 'printStationQr' | 'copyShareLink'
  | 'broadcastAnnouncement' | 'deactivateAnnouncement' | 'pushFlashMission'
  | 'activateHotZone' | 'deactivateHotZone'
  | 'createTrackable' | 'createZone' | 'deleteZone'
  | 'approvePhoto' | 'rejectPhoto' | 'hideFeedPhoto' | 'sendChatReply'
  | 'loadHeatmap' | 'loadAnalytics' | 'exportAnalyticsCsv' | 'refreshSurvey'
  | 'skipStage' | 'adjustTeamScore' | 'finalizeRun';

export type ActionSeverity = 'routine' | 'cautionary' | 'destructive';

/**
 * How long a pushed flash mission stays active. This used to be a bare
 * `ttlSeconds: 600` at the call site, so the lifetime was knowable only by
 * reading the source. Both the callable payload and the copy that states the
 * lifetime now read this one constant.
 */
export const FLASH_MISSION_TTL_SECONDS = 600;
export const FLASH_MISSION_TTL_MINUTES = FLASH_MISSION_TTL_SECONDS / 60;

const SEVERITY: Record<RunActionId, ActionSeverity> = {
  startTeams: 'routine',
  refreshStandings: 'routine',
  publishStandings: 'routine',
  revealStandings: 'routine',
  inviteStaff: 'routine',
  acknowledgeAlert: 'routine',
  printStationQr: 'routine',
  copyShareLink: 'routine',
  broadcastAnnouncement: 'routine',
  pushFlashMission: 'routine',
  activateHotZone: 'routine',
  createTrackable: 'routine',
  createZone: 'routine',
  approvePhoto: 'routine',
  sendChatReply: 'routine',
  loadHeatmap: 'routine',
  loadAnalytics: 'routine',
  exportAnalyticsCsv: 'routine',
  refreshSurvey: 'routine',

  // Reversible, but they take something away from a team or an audience.
  deactivateAnnouncement: 'cautionary',
  deactivateHotZone: 'cautionary',
  deleteZone: 'cautionary',
  rejectPhoto: 'cautionary',
  hideFeedPhoto: 'cautionary',
  skipStage: 'cautionary',

  // Irreversible for the players: the run ends, or a score is rewritten.
  adjustTeamScore: 'destructive',
  finalizeRun: 'destructive',
};

export const RUN_ACTION_IDS = Object.keys(SEVERITY) as RunActionId[];

export function classifyRunAction(id: RunActionId): ActionSeverity {
  return SEVERITY[id];
}

/**
 * The one place severity turns into chrome, so the classification and the
 * rendering cannot disagree.
 */
export function runActionVariant(id: RunActionId): 'primary' | 'ghost' | 'danger' | 'subtle' {
  switch (classifyRunAction(id)) {
    case 'destructive': return 'danger';
    case 'cautionary': return 'subtle';
    case 'routine': return 'primary';
  }
}

// The console's manual adjustment parser already lives on its own (it predates
// this change and is covered by scoreAdjustment.test.ts). Re exported so an
// action's parsing and its severity are reached from one module.
export { parseScoreDelta, MAX_SCORE_DELTA } from './scoreAdjustment';
