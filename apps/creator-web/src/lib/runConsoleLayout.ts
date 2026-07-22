// Run Console layout plan (change: run-console-progressive-disclosure).
//
// The console used to express its layout as ~20 inline `{!finished && …}` JSX
// conditions, so nothing could answer "what is on screen right now?" — which is
// exactly the question a grouped, badge bearing disclosure UI has to answer.
// The layout is therefore DATA: one pass over one state object decides group
// membership, panel visibility AND the at rest summary shown on a folded header,
// so the badge and the expanded panel can never disagree.
//
// Pure: no React, no Firebase, no i18n. Copy lives in i18n.ts and is applied by
// the page; this module only decides what exists and how much of it there is.

export type PanelId =
  | 'joinShare' | 'stationQr' | 'startTeams' | 'alerts' | 'broadcast' | 'liveMap'
  | 'teams' | 'liveStandings' | 'finalStandings'
  | 'hotZone' | 'flashMission' | 'trackables' | 'zones'
  | 'photoReview' | 'feed' | 'chat'
  | 'shareScreens' | 'staffInvite'
  | 'runSummary' | 'analytics' | 'heatmap' | 'feedback' | 'survey';

export type GroupId =
  | 'primary' | 'teamsAndScores' | 'gameMechanics' | 'moderation'
  | 'shareAndScreens' | 'afterTheRun';

export type RunStatus = 'draft' | 'live' | 'finished';

/** Everything the plan needs to know about the run, gathered once by the page. */
export type RunConsoleState = {
  status: RunStatus;
  teamCount: number;
  alertCount: number;
  /** Submissions waiting for a human right now (the badge number). */
  pendingPhotoCount: number;
  /** Any row the review queue would render (pending + recently reviewed + a load error). */
  photoQueueCount: number;
  feedItemCount: number;
  chatThreadCount: number;
  unreadChatThreads: number;
  hotZoneActive: boolean;
  hasLeaderboard: boolean;
  hasStaffPin: boolean;
  /** null = not loaded yet (the panel must mount so it can load). */
  surveyResultCount: number | null;
};

/** The at rest summary a folded group shows on its header. */
export type GroupSummary = {
  panelCount: number;
  pendingPhotos?: number;
  unreadChats?: number;
  hotZoneActive?: boolean;
  teamCount?: number;
};

export type RunConsoleGroup = {
  id: GroupId;
  panels: PanelId[];
  summary: GroupSummary;
  /** The primary zone is the always open top of the page, never an `Advanced`. */
  collapsible: boolean;
};

export type RunConsolePlan = { groups: RunConsoleGroup[] };

/** Rendering order of the groups, top to bottom. */
export const GROUP_ORDER: GroupId[] = [
  'primary', 'teamsAndScores', 'moderation', 'gameMechanics', 'shareAndScreens', 'afterTheRun',
];

/**
 * The panel catalogue. Keyed by a closed union, so a new panel cannot be added
 * without being given a group (it fails typecheck instead of quietly floating).
 */
export const PANEL_GROUP: Record<PanelId, GroupId> = {
  joinShare: 'primary',
  stationQr: 'primary',
  startTeams: 'primary',
  alerts: 'primary',
  broadcast: 'primary',
  liveMap: 'primary',

  teams: 'teamsAndScores',
  liveStandings: 'teamsAndScores',
  finalStandings: 'teamsAndScores',

  hotZone: 'gameMechanics',
  flashMission: 'gameMechanics',
  trackables: 'gameMechanics',
  zones: 'gameMechanics',

  photoReview: 'moderation',
  feed: 'moderation',
  chat: 'moderation',

  shareScreens: 'shareAndScreens',
  staffInvite: 'shareAndScreens',

  runSummary: 'afterTheRun',
  analytics: 'afterTheRun',
  heatmap: 'afterTheRun',
  feedback: 'afterTheRun',
  survey: 'afterTheRun',
};

export const ALL_PANEL_IDS = Object.keys(PANEL_GROUP) as PanelId[];

export type CollapsibleGroupId = Exclude<GroupId, 'primary'>;
export type GroupOpenState = Record<CollapsibleGroupId, boolean>;

/**
 * Collapsed by default, except the teams and standings a host scans constantly.
 * Folding never hides state: a folded header still reports its contents.
 */
export const DEFAULT_GROUP_OPEN: GroupOpenState = {
  teamsAndScores: true,
  gameMechanics: false,
  moderation: false,
  shareAndScreens: false,
  afterTheRun: false,
};

const COLLAPSIBLE_GROUPS = Object.keys(DEFAULT_GROUP_OPEN) as (keyof GroupOpenState)[];

/** Is this panel worth rendering at all, given the run's current state? */
function isPanelVisible(id: PanelId, s: RunConsoleState): boolean {
  const live = s.status !== 'finished';
  switch (id) {
    // Primary zone.
    case 'joinShare': return true;
    case 'stationQr': return true;
    case 'startTeams': return live;
    case 'alerts': return s.alertCount > 0;
    case 'broadcast': return live;
    case 'liveMap': return live && s.teamCount > 0;

    // Teams and scores. The teams list always renders: its own empty state is
    // what tells a host nobody has joined yet.
    case 'teams': return true;
    case 'liveStandings': return live && s.hasLeaderboard;
    case 'finalStandings': return !live && s.hasLeaderboard;

    // Optional game systems, all meaningless once the run has ended.
    case 'hotZone':
    case 'flashMission':
    case 'trackables':
    case 'zones': return live;

    // Human in the loop queues, which already hide themselves when empty.
    case 'photoReview': return s.photoQueueCount > 0;
    case 'feed': return s.feedItemCount > 0;
    case 'chat': return live && s.chatThreadCount > 0;

    // Share surface. The access code always exists; the staff card only after
    // a PIN has been minted.
    case 'shareScreens': return true;
    case 'staffInvite': return s.hasStaffPin;

    // Reports. Survey results are also useful mid run (a live poll), and the
    // panel has to mount to load them, so `null` (not loaded) keeps it visible.
    case 'runSummary':
    case 'analytics':
    case 'heatmap':
    case 'feedback': return !live;
    case 'survey': return s.surveyResultCount === null || s.surveyResultCount > 0;
  }
}

function summaryFor(group: GroupId, panels: PanelId[], s: RunConsoleState): GroupSummary {
  const base: GroupSummary = { panelCount: panels.length };
  switch (group) {
    case 'teamsAndScores': return { ...base, teamCount: s.teamCount };
    case 'moderation': return { ...base, pendingPhotos: s.pendingPhotoCount, unreadChats: s.unreadChatThreads };
    case 'gameMechanics': return { ...base, hotZoneActive: s.hotZoneActive };
    default: return base;
  }
}

/**
 * The whole console layout for one run state: which groups render, which panels
 * they hold, and what a folded group reports while closed.
 */
export function buildRunConsolePlan(state: RunConsoleState): RunConsolePlan {
  const groups: RunConsoleGroup[] = [];
  for (const id of GROUP_ORDER) {
    const panels = ALL_PANEL_IDS.filter((p) => PANEL_GROUP[p] === id && isPanelVisible(p, state));
    if (panels.length === 0) continue; // an empty group does not render at all
    groups.push({ id, panels, summary: summaryFor(id, panels, state), collapsible: id !== 'primary' });
  }
  return { groups };
}

export function planPanels(plan: RunConsolePlan, group: GroupId): PanelId[] {
  return plan.groups.find((g) => g.id === group)?.panels ?? [];
}

export function planHasPanel(plan: RunConsolePlan, panel: PanelId): boolean {
  return plan.groups.some((g) => g.panels.includes(panel));
}

/** localStorage key for one run's group open/closed preference. */
export function groupStateKey(runId: string): string {
  return `rp.runConsole.groups.${runId}`;
}

/**
 * Merge stored open state over the defaults. Stale ids, non booleans, malformed
 * JSON and a missing value all degrade to the defaults instead of throwing: this
 * is a display preference, never a reason to white screen a live console.
 */
export function readGroupState(raw: string | null | undefined, defaults: GroupOpenState): GroupOpenState {
  const merged: GroupOpenState = { ...defaults };
  if (typeof raw !== 'string' || raw.trim() === '') return merged;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return merged; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return merged;
  const record = parsed as Record<string, unknown>;
  for (const id of COLLAPSIBLE_GROUPS) {
    if (typeof record[id] === 'boolean') merged[id] = record[id] as boolean;
  }
  return merged;
}

export function writeGroupState(state: GroupOpenState): string {
  const clean: Partial<GroupOpenState> = {};
  for (const id of COLLAPSIBLE_GROUPS) clean[id] = !!state[id];
  return JSON.stringify(clean);
}
