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
  | 'inviteStaff' | 'acknowledgeAlert' | 'clearTeamOutOfBounds' | 'printStationQr' | 'copyShareLink'
  | 'broadcastAnnouncement' | 'deactivateAnnouncement' | 'pushFlashMission'
  | 'activateHotZone' | 'deactivateHotZone'
  | 'pauseTask' | 'closeTask' | 'resumeTask'
  | 'createTrackable' | 'createZone' | 'deleteZone'
  | 'approvePhoto' | 'rejectPhoto' | 'hideFeedPhoto' | 'sendChatReply'
  | 'loadHeatmap' | 'loadAnalytics' | 'exportAnalyticsCsv' | 'refreshSurvey'
  | 'skipStage' | 'skipTask' | 'sendBack' | 'adjustTeamScore' | 'finalizeRun'
  // team-lifecycle-controls: start ONE team, pause/resume it, take it out of the game and back.
  | 'startTeam' | 'holdTeam' | 'resumeTeam' | 'removeTeam' | 'restoreTeam'
  // route-team-to-mission: send ONE team to ANY mission, waiving exactly what blocks it.
  | 'routeTeam';

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
  // Releasing a player the safe-zone latch is holding is a SAFETY action: it must
  // not be buried behind a red destructive confirm (change: out-of-bounds-recovery).
  clearTeamOutOfBounds: 'routine',
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
  // Putting a stop back in play only ever ADDS options for teams.
  resumeTask: 'routine',
  // team-lifecycle-controls. Starting one team is the routine act of the run; resuming and
  // bringing back only give a team its game back.
  startTeam: 'routine',
  resumeTeam: 'routine',
  restoreTeam: 'routine',

  // Reversible, but they take something away from a team or an audience.
  deactivateAnnouncement: 'cautionary',
  deactivateHotZone: 'cautionary',
  deleteZone: 'cautionary',
  rejectPhoto: 'cautionary',
  hideFeedPhoto: 'cautionary',
  skipStage: 'cautionary',
  // Removes ONE mission from ONE team (change: skip-single-task). Reversible in
  // effect (the team keeps playing the stage) but it does take a scoring
  // opportunity away, so it carries the same weight as the whole stage skip.
  skipTask: 'cautionary',
  // Sends ONE team back to a mission or stage (change: send-team-back). It moves a score and a
  // route, so it is confirmed with the server's own preview; it undoes a skip rather than
  // destroying anything, so it is cautionary, not destructive.
  sendBack: 'cautionary',
  // Moves ONE team's route and can waive a gate for it; previewed (the exact blockers) and confirmed.
  routeTeam: 'cautionary',
  // Reversible, but they take a scoring opportunity away from every team that has
  // not reached the stop yet (change: live-task-pause).
  pauseTask: 'cautionary',
  // Both take the game away from ONE team, and both are reversible (resume / bring back), so
  // they are cautionary rather than destructive. Removal is confirmed; a pause is not.
  holdTeam: 'cautionary',
  removeTeam: 'cautionary',
  // Final for every team already playing (change: live-task-close-rules): the team on it is moved
  // off with no points and every team's stage shrinks.
  closeTask: 'destructive',

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

// ── What a control actually DOES (change: run-console-clarity) ───────────────
//
// Severity says how loud a button should look. It does not say who the click
// reaches, whether it can be taken back, or whether the organizer should be
// asked first — and that gap is most of the "some of the things there are not
// 100% clear" complaint. Four controls were the evidence:
//
//   * the publish toggle was a raw <button> whose LABEL WAS ITS CURRENT STATE,
//     with no verb and no confirm, one click from showing live standings to
//     every player;
//   * "Start all teams" started every race clock in the field with nothing said,
//     while "End run" (one row below) did confirm;
//   * "Acknowledge" reads as "seen", but the alert query is
//     `acknowledged == false`, so the row never comes back;
//   * skipping removed the team's WHOLE STAGE and said only "Skip".
//
// One table, keyed by the SAME closed union as SEVERITY, so severity and
// consequence can never cover different sets of controls.

export type ActionAudience = 'nobody' | 'oneTeam' | 'allTeams' | 'public';

export type RunActionConsequence = {
  /** Who feels this click. `nobody` = a read only or organizer only action. */
  audience: ActionAudience;
  /** Can the organizer put it back the way it was? */
  reversible: boolean;
  /** Must the organizer be asked first, with the effect named? */
  confirm: boolean;
  /** Leaf of `runConsole.consequence` in BOTH dictionaries. */
  copyKey: string;
};

/**
 * Two rules make this a contract rather than a list, and both are asserted:
 *  - everything `destructive` confirms;
 *  - everything the PUBLIC will see confirms.
 *
 * The deliberate non-rule: reaching every team is NOT on its own enough to earn
 * a modal. A host pushes announcements constantly, and a confirm on every one is
 * exactly how a confirm stops being read, which would cost the four that matter.
 */
const CONSEQUENCE: Record<RunActionId, RunActionConsequence> = {
  // ── Reaches every team, or the audience watching them ──
  startTeams: { audience: 'allTeams', reversible: false, confirm: true, copyKey: 'startTeams' },
  publishStandings: { audience: 'public', reversible: true, confirm: true, copyKey: 'publishStandings' },
  revealStandings: { audience: 'public', reversible: false, confirm: true, copyKey: 'revealStandings' },
  broadcastAnnouncement: { audience: 'allTeams', reversible: true, confirm: false, copyKey: 'broadcastAnnouncement' },
  deactivateAnnouncement: { audience: 'allTeams', reversible: true, confirm: false, copyKey: 'deactivateAnnouncement' },
  pushFlashMission: { audience: 'allTeams', reversible: false, confirm: false, copyKey: 'pushFlashMission' },
  activateHotZone: { audience: 'allTeams', reversible: true, confirm: false, copyKey: 'activateHotZone' },
  deactivateHotZone: { audience: 'allTeams', reversible: true, confirm: false, copyKey: 'deactivateHotZone' },
  pauseTask: { audience: 'allTeams', reversible: true, confirm: false, copyKey: 'pauseTask' },
  closeTask: { audience: 'allTeams', reversible: false, confirm: true, copyKey: 'closeTask' },
  resumeTask: { audience: 'allTeams', reversible: true, confirm: false, copyKey: 'resumeTask' },
  createZone: { audience: 'allTeams', reversible: true, confirm: false, copyKey: 'createZone' },
  deleteZone: { audience: 'allTeams', reversible: false, confirm: true, copyKey: 'deleteZone' },
  createTrackable: { audience: 'allTeams', reversible: false, confirm: false, copyKey: 'createTrackable' },
  hideFeedPhoto: { audience: 'allTeams', reversible: true, confirm: true, copyKey: 'hideFeedPhoto' },
  finalizeRun: { audience: 'allTeams', reversible: false, confirm: true, copyKey: 'finalizeRun' },

  // ── Reaches ONE team ──
  // Irreversible by construction: the alerts listener queries
  // `acknowledged == false`, so an acknowledged row never returns.
  acknowledgeAlert: { audience: 'oneTeam', reversible: false, confirm: true, copyKey: 'acknowledgeAlert' },
  // The one human escape hatch out of the safe-zone latch. It must NOT be
  // confirmed and must not look scary: staff hesitating over a safety action is
  // the failure mode (change: out-of-bounds-recovery).
  clearTeamOutOfBounds: { audience: 'oneTeam', reversible: true, confirm: false, copyKey: 'clearTeamOutOfBounds' },
  skipStage: { audience: 'oneTeam', reversible: false, confirm: true, copyKey: 'skipStage' },
  skipTask: { audience: 'oneTeam', reversible: false, confirm: true, copyKey: 'skipTask' },
  sendBack: { audience: 'oneTeam', reversible: false, confirm: true, copyKey: 'sendBack' },
  routeTeam: { audience: 'oneTeam', reversible: false, confirm: true, copyKey: 'routeTeam' },
  adjustTeamScore: { audience: 'oneTeam', reversible: false, confirm: true, copyKey: 'adjustTeamScore' },
  approvePhoto: { audience: 'oneTeam', reversible: false, confirm: false, copyKey: 'approvePhoto' },
  rejectPhoto: { audience: 'oneTeam', reversible: false, confirm: false, copyKey: 'rejectPhoto' },
  sendChatReply: { audience: 'oneTeam', reversible: false, confirm: false, copyKey: 'sendChatReply' },
  startTeam: { audience: 'oneTeam', reversible: false, confirm: false, copyKey: 'startTeam' },
  holdTeam: { audience: 'oneTeam', reversible: true, confirm: false, copyKey: 'holdTeam' },
  resumeTeam: { audience: 'oneTeam', reversible: true, confirm: false, copyKey: 'resumeTeam' },
  removeTeam: { audience: 'oneTeam', reversible: true, confirm: true, copyKey: 'removeTeam' },
  restoreTeam: { audience: 'oneTeam', reversible: true, confirm: false, copyKey: 'restoreTeam' },

  // ── Reaches nobody but the organizer ──
  refreshStandings: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'refreshStandings' },
  inviteStaff: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'inviteStaff' },
  printStationQr: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'printStationQr' },
  copyShareLink: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'copyShareLink' },
  loadHeatmap: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'loadHeatmap' },
  loadAnalytics: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'loadAnalytics' },
  exportAnalyticsCsv: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'exportAnalyticsCsv' },
  refreshSurvey: { audience: 'nobody', reversible: true, confirm: false, copyKey: 'refreshSurvey' },
};

export function runActionConsequence(id: RunActionId): RunActionConsequence {
  return CONSEQUENCE[id];
}

export function runActionNeedsConfirm(id: RunActionId): boolean {
  return CONSEQUENCE[id].confirm;
}

// ── The team row (change: run-console-clarity) ───────────────────────────────
//
// The row already carries a name, a status line, an out-of-bounds line, a held
// for consent line, an attention badge, a rescue button and a score before a
// single action button — and the per task skip (change: skip-single-task) made
// it four buttons wide. On a phone that row is unusable, and "unusable on a
// phone" is where a live organizer actually stands.
//
// The split is a DECISION, not a rendering accident, so it lives here:
//   * at most ONE control on the row itself;
//   * never a destructive one;
//   * the safety release is always immediate and never buried;
//   * every control appears in exactly one of the two lists.
//
// And the split reads the ATTENTION VERDICT, because burying the remedy for the
// one row that needs it is the same bug in a smaller box: a team flagged `stuck`
// carries the per-task skip ON the row (change: post-review-fixes C). `skipTask`
// is the right promotion — it is cautionary rather than destructive, it is
// confirmed, and it is the narrowest of the three: it removes ONE mission, not
// the stage and not a score.
//
// `watch` deliberately promotes nothing. `watch` means "keep an eye on this", and
// a console that grows a button on every amber row is exactly the flagged table
// the attention module was written to avoid.

export type TeamRowActions = { inline: RunActionId[]; overflow: RunActionId[] };

/** Least to most destructive, which is the order the menu renders. */
// `sendBack` (change: send-team-back) sits after the skips it most often undoes.
// team-lifecycle-controls: pausing sits with the other routing changes; removal is last, the
// heaviest thing a row can do (it takes the team out of every standing).
const TEAM_ROW_OVERFLOW: RunActionId[] = ['skipTask', 'skipStage', 'sendBack', 'routeTeam', 'holdTeam', 'adjustTeamScore', 'removeTeam'];

export function teamRowActions(
  team: { outOfBounds?: boolean; launched?: boolean; held?: boolean; removed?: boolean } | null | undefined,
  attention: { level: 'ok' | 'watch' | 'stuck' } | null | undefined,
): TeamRowActions {
  // A removed team has exactly one thing left to do with it: bring it back.
  if (team?.removed === true) return { inline: [], overflow: ['restoreTeam'] };

  const outOfBounds = team?.outOfBounds === true;
  // `launched === false`, not "not true": a row whose launch state is unknown stays as it was.
  const notStarted = team?.launched === false;
  const paused = team?.held === true;
  // Order of the single inline slot: the safety release outranks everything (an out-of-bounds
  // team cannot be routed anywhere until a human clears it); then the one thing a waiting team
  // is waiting for (start, or resume); then the remedy for a stuck team.
  const inline: RunActionId[] = outOfBounds ? ['clearTeamOutOfBounds']
    : notStarted ? ['startTeam']
      : paused ? ['resumeTeam']
        : attention?.level === 'stuck' ? ['skipTask'] : [];
  // Pausing a team that is not playing, or that is already paused, means nothing; a paused
  // team whose inline slot went to a safety release still needs "resume" somewhere.
  const overflow = TEAM_ROW_OVERFLOW.flatMap((id): RunActionId[] => {
    // Routing a team that is not playing means nothing, like pausing it.
    if (id === 'routeTeam') return notStarted ? [] : [id];
    if (id !== 'holdTeam') return [id];
    if (paused) return ['resumeTeam'];
    return notStarted ? [] : [id];
  });
  return {
    inline,
    overflow: overflow.filter((id) => !inline.includes(id)),
  };
}

// run-console-simplify D4: the team page carries the COMPLETE action set, grouped by what it does,
// so the list row can stay down to one inline action. Score is its own group because it is the most
// frequent thing an organizer does to a team; Danger holds only what takes a team out of the game.
// Bringing a team back undoes the dangerous thing, so it is Play. Unknown keys fall to Play rather
// than vanish: a new action must never be unreachable because nobody filed it here.
const TEAM_PAGE_SCORE = new Set(['adjustScore']);
const TEAM_PAGE_DANGER = new Set(['removeTeam']);

export function teamPageActionGroups(keys: readonly string[] | null | undefined): { play: string[]; score: string[]; danger: string[] } {
  const out = { play: [] as string[], score: [] as string[], danger: [] as string[] };
  if (!Array.isArray(keys)) return out;
  for (const k of keys) {
    if (typeof k !== 'string') continue;
    if (TEAM_PAGE_SCORE.has(k)) out.score.push(k);
    else if (TEAM_PAGE_DANGER.has(k)) out.danger.push(k);
    else out.play.push(k);
  }
  // Play reads in order of how often an organizer reaches for it, the heaviest last. Anything not
  // listed keeps its given order after the listed ones.
  const rank = (k: string) => { const i = TEAM_PAGE_PLAY_ORDER.indexOf(k); return i < 0 ? TEAM_PAGE_PLAY_ORDER.length : i; };
  out.play = out.play.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map((x) => x.k);
  return out;
}
const TEAM_PAGE_PLAY_ORDER = [
  'letIn', 'clearTeamOutOfBounds', 'startTeam', 'resumeTeam', 'restoreTeam',
  'routeTeam', 'skipTask', 'sendBack', 'holdTeam', 'skipStage',
];

// The console's manual adjustment parser already lives on its own (it predates
// this change and is covered by scoreAdjustment.test.ts). Re exported so an
// action's parsing and its severity are reached from one module.
export { parseScoreDelta, MAX_SCORE_DELTA } from './scoreAdjustment';
