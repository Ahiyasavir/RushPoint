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
  | 'hotZone' | 'flashMission' | 'trackables' | 'zones' | 'taskAvailability'
  | 'photoReview' | 'feed' | 'chat' | 'staffChannel'
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
  /** Teams the attention classifier flags. Rendered ONLY inside the teams panel
   *  before this change, so the rail said "6 teams" while three were stuck. */
  attentionTeamCount: number;
  /** Stops taken out of play for THIS run (`Run.taskStatusOverrides`). */
  pausedTaskCount: number;
  /** How many shareable artifacts the share surface is offering. */
  shareLinkCount: number;
};

/** The at rest summary a folded group shows on its header. */
export type GroupSummary = {
  panelCount: number;
  pendingPhotos?: number;
  unreadChats?: number;
  hotZoneActive?: boolean;
  teamCount?: number;
  attentionTeams?: number;
  pausedTasks?: number;
  shareLinks?: number;
  reportCount?: number;
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
  // Live task availability (change: live-task-pause): pause / close / restore one
  // task for THIS run when a stop dies mid event.
  taskAvailability: 'gameMechanics',

  photoReview: 'moderation',
  feed: 'moderation',
  chat: 'moderation',
  // The organizer's half of the staff↔admin channel (staff-console-field-ops).
  // Grouped with the other live conversations, NOT with staffInvite: inviting a
  // marshal is a setup task done once, while this is read repeatedly during a run.
  // Its URGENCY is expressed in PANEL_PRIORITY (it outranks the team chat), which
  // is what actually drives ordering — the group only decides which rail it lives
  // under, and "primary" is a closed set meaning the always-on incident surface.
  staffChannel: 'moderation',

  shareScreens: 'shareAndScreens',
  staffInvite: 'shareAndScreens',
  // The printable station QR sheet IS a share artifact (change:
  // run-console-clarity). It used to be pinned unconditionally, so a sheet the
  // host prints once, before the event, held the widest pixels on the page for
  // the whole run and pushed the teams table and the photo queue below the fold.
  stationQr: 'shareAndScreens',

  runSummary: 'afterTheRun',
  analytics: 'afterTheRun',
  heatmap: 'afterTheRun',
  feedback: 'afterTheRun',
  survey: 'afterTheRun',
};

export const ALL_PANEL_IDS = Object.keys(PANEL_GROUP) as PanelId[];

/**
 * A section is a destination in the console's rail: exactly one is shown at a
 * time. Derived from GROUP_ORDER minus the pinned group, so the two orders can
 * never drift.
 */
export type SectionId = Exclude<GroupId, 'primary'>;
export const SECTION_ORDER: SectionId[] =
  GROUP_ORDER.filter((g): g is SectionId => g !== 'primary');

/** Kept as the page's spelling for a section id. */
export type CollapsibleGroupId = SectionId;

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
    // Nothing to take out of play once the run has ended.
    case 'taskAvailability': return live;

    // Human in the loop queues. These used to hide themselves when empty, which
    // made the RAIL change shape mid run: approving the last photo deleted the
    // destination the organizer was standing on and the console teleported them
    // somewhere else with no explanation (change: run-console-clarity). Both are
    // present for the whole live run and say "nothing waiting" out loud instead.
    case 'photoReview': return live || s.photoQueueCount > 0;
    case 'chat': return live;
    // Same reasoning as `chat`: present for the whole live run so the rail cannot
    // change shape under the organizer, and a quiet channel says so out loud.
    case 'staffChannel': return live;
    // The feed stays count gated on purpose: it is a wall of photographs, not a
    // work queue, and an empty one is not a state anybody has to act on.
    case 'feed': return s.feedItemCount > 0;

    // Share surface. The access code always exists; the staff card only after
    // a PIN has been minted.
    case 'shareScreens': return true;
    case 'staffInvite': return s.hasStaffPin;

    // Reports. Survey results are also useful mid run (a live poll), and the
    // panel has to mount to load them, so `null` (not loaded) keeps it visible.
    // These three read POST RUN artifacts (the emailed summary, the whole GPS
    // track, the finish screen survey) and are empty or misleading mid run.
    case 'runSummary':
    case 'heatmap':
    case 'feedback': return !live;
    // Per task analytics are NOT post run: `getRunAnalytics` is not finished
    // gated server side, and the decision they inform (take a failing stop out
    // of play) can only be made while the run is still going
    // (change: run-console-clarity).
    case 'analytics': return true;
    case 'survey': return s.surveyResultCount === null || s.surveyResultCount > 0;
  }
}

/**
 * What a rail entry says about a section nobody is looking at.
 *
 * An EXHAUSTIVE switch with no `default:` on purpose: the old version fell
 * through to a bare `panelCount` for `shareAndScreens` and `afterTheRun`, and
 * the page rendered nothing for a bare panel count, so two rail buttons were
 * permanently mute — including the one holding every post run report. A new
 * GroupId now fails typecheck instead of shipping silent.
 */
function summaryFor(group: GroupId, panels: PanelId[], s: RunConsoleState): GroupSummary {
  const base: GroupSummary = { panelCount: panels.length };
  switch (group) {
    // The pinned zone has no rail entry, so it has nothing to report.
    case 'primary': return base;
    case 'teamsAndScores':
      return { ...base, teamCount: s.teamCount, attentionTeams: s.attentionTeamCount };
    case 'moderation':
      return { ...base, pendingPhotos: s.pendingPhotoCount, unreadChats: s.unreadChatThreads };
    case 'gameMechanics':
      return { ...base, hotZoneActive: s.hotZoneActive, pausedTasks: s.pausedTaskCount };
    case 'shareAndScreens':
      return { ...base, shareLinks: s.shareLinkCount };
    case 'afterTheRun':
      return { ...base, reportCount: panels.length };
  }
}

// ── Rail chips (change: run-console-clarity) ─────────────────────────────────
//
// The page must not decide what a rail entry says either, or "the badge and the
// panel cannot disagree" stops being true one refactor later. This turns a
// summary into an ordered list of chip descriptors; the page maps a key to
// translated copy and a colour, and nothing else.

export type SummaryChipKey =
  | 'attention' | 'pendingPhotos' | 'unreadChats' | 'hotZone'
  | 'pausedTasks' | 'teams' | 'shareLinks' | 'reports' | 'panels';

export type SummaryChip = {
  key: SummaryChipKey;
  value: number;
  tone: 'neutral' | 'warn' | 'alert';
};

/**
 * Never empty. A section with nothing else to say reports how many panels it
 * holds, which is the fallback that makes "a permanently blank rail button"
 * unreachable rather than merely unlikely.
 */
export function summaryChips(summary: GroupSummary): SummaryChip[] {
  const s = summary ?? { panelCount: 0 };
  const chips: SummaryChip[] = [];
  const positive = (n: number | undefined): boolean => typeof n === 'number' && Number.isFinite(n) && n > 0;

  if (positive(s.attentionTeams)) chips.push({ key: 'attention', value: s.attentionTeams!, tone: 'warn' });
  if (positive(s.pendingPhotos)) chips.push({ key: 'pendingPhotos', value: s.pendingPhotos!, tone: 'warn' });
  if (positive(s.unreadChats)) chips.push({ key: 'unreadChats', value: s.unreadChats!, tone: 'warn' });
  if (s.hotZoneActive) chips.push({ key: 'hotZone', value: 1, tone: 'alert' });
  if (positive(s.pausedTasks)) chips.push({ key: 'pausedTasks', value: s.pausedTasks!, tone: 'warn' });
  if (positive(s.teamCount)) chips.push({ key: 'teams', value: s.teamCount!, tone: 'neutral' });
  if (positive(s.shareLinks)) chips.push({ key: 'shareLinks', value: s.shareLinks!, tone: 'neutral' });
  if (positive(s.reportCount)) chips.push({ key: 'reports', value: s.reportCount!, tone: 'neutral' });

  if (chips.length === 0) {
    return [{ key: 'panels', value: Number.isFinite(s.panelCount) ? s.panelCount : 0, tone: 'neutral' }];
  }
  return chips;
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

// ── Section navigation (change: run-console-density) ─────────────────────────
//
// The console used to stack every group as an accordion, so reaching a control
// meant scrolling to find a header and then scrolling again through whatever it
// unfolded. It is now a Builder style rail: a persistent list of sections, ONE
// of which is rendered. The pinned zone (alerts, the control bar, the join card,
// the broadcast, the live map) is outside the rail and always on screen, because
// an SOS must never be one navigation away.
//
// The property that replaces "is it expanded?" is REACHABILITY: every catalogued
// panel is either pinned or belongs to exactly one section. A panel in neither is
// not collapsed, it is gone.

export type PanelPlacement = 'pinned' | SectionId;

/** Where a panel is reachable. Total over the catalogue by construction. */
export function panelPlacement(id: PanelId): PanelPlacement {
  const group = PANEL_GROUP[id];
  return group === 'primary' ? 'pinned' : group;
}

export type RunConsoleSection = {
  id: SectionId;
  panels: PanelId[];
  /** The same summary the plan computed, so a rail badge cannot drift. */
  summary: GroupSummary;
};

/** The always on screen panels for this plan, in plan order. */
export function pinnedPanels(plan: RunConsolePlan): PanelId[] {
  return planPanels(plan, 'primary');
}

/** The rail's destinations: every non empty section, in section order. */
export function buildRunConsoleSections(plan: RunConsolePlan): RunConsoleSection[] {
  const sections: RunConsoleSection[] = [];
  for (const id of SECTION_ORDER) {
    const group = plan.groups.find((g) => g.id === id);
    if (!group || group.panels.length === 0) continue;
    sections.push({ id, panels: group.panels, summary: group.summary });
  }
  return sections;
}

/**
 * What an organizer needs while something is going wrong: who is stuck, who is
 * out of bounds, who is held for consent, and where everyone stands. Kept as an
 * alias for the LIVE default so no existing caller changes meaning.
 */
export const DEFAULT_SECTION: SectionId = 'teamsAndScores';

/**
 * Where the console opens. This used to be a constant, so a FINISHED run opened
 * on a live teams table while every report the host came for sat one navigation
 * away (change: run-console-clarity).
 */
export function defaultSection(status: RunStatus): SectionId {
  return status === 'finished' ? 'afterTheRun' : DEFAULT_SECTION;
}

/** Why the console is showing the section it is showing. */
export type SectionReason = 'requested' | 'sectionEmptied' | 'default' | 'firstAvailable' | 'none';

export type SectionResolution = { id: SectionId | null; reason: SectionReason };

/**
 * Which section to show, AND why. The console used to teleport: a section that
 * emptied under the organizer's feet was replaced silently, which reads as the
 * app losing their place. `sectionEmptied` is reported only for a value that is
 * a REAL section id and simply is not present right now, so a junk or absent
 * stored value never earns a sentence.
 */
export function resolveSectionWithReason(
  sections: RunConsoleSection[],
  requested: string | null | undefined,
  status: RunStatus = 'live',
): SectionResolution {
  if (!Array.isArray(sections) || sections.length === 0) return { id: null, reason: 'none' };
  if (typeof requested === 'string' && sections.some((s) => s.id === requested)) {
    return { id: requested as SectionId, reason: 'requested' };
  }
  const wasReal = typeof requested === 'string'
    && (SECTION_ORDER as string[]).includes(requested);
  const fallback = defaultSection(status);
  const id = sections.some((s) => s.id === fallback) ? fallback : sections[0].id;
  if (wasReal) return { id, reason: 'sectionEmptied' };
  return { id, reason: id === fallback ? 'default' : 'firstAvailable' };
}

/**
 * Which section to show. A stale, unknown or malformed stored value degrades to
 * the default rather than leaving the console showing nothing; if even the
 * default is not rendered (a run with no teams section yet) the first available
 * section wins. `null` only when there is genuinely nothing to show.
 */
export function resolveSection(
  sections: RunConsoleSection[],
  requested: string | null | undefined,
  status: RunStatus = 'live',
): SectionId | null {
  return resolveSectionWithReason(sections, requested, status).id;
}

/** localStorage key for one run's selected section. */
export function sectionStateKey(runId: string): string {
  return `rp.runConsole.section.${runId}`;
}

// ── Column placement (change: run-console-density) ───────────────────────────
//
// `buildRunConsolePlan` decides what EXISTS; this decides where it SITS. The
// console used to hardcode a two thirds / one third split whose wide lane held
// three conditional panels, so a run that had just launched showed one row of
// buttons and then two thirds of empty page (in RTL: the whole right side).

export type ColumnCount = 1 | 2 | 3;

/**
 * Total ordering, ranked by what an organizer reaches for while something is
 * going wrong, which is the only moment this layout matters. See the change's
 * design.md for the justification of each band.
 */
export const PANEL_PRIORITY: PanelId[] = [
  // Incident response.
  'alerts', 'startTeams', 'teams', 'liveStandings', 'broadcast', 'liveMap',
  // Work queues with a human in the loop. The staff channel ranks ABOVE the team
  // chat: a marshal writing here is a staff member reporting a problem or asking
  // for a decision, which is a higher-urgency signal than a participant question.
  'photoReview', 'staffChannel', 'chat',
  // Operator overrides and optional game systems.
  'taskAvailability', 'hotZone', 'flashMission', 'zones', 'trackables', 'feed',
  // Setup artifacts: needed intensely for five minutes, then reference material.
  'joinShare', 'stationQr', 'shareScreens', 'staffInvite',
  // Post run reading. By definition nothing is going wrong any more.
  'finalStandings', 'runSummary', 'analytics', 'heatmap', 'feedback', 'survey',
];

/** Rough vertical size, used only to balance the lanes. Default below. */
const PANEL_WEIGHT: Partial<Record<PanelId, number>> = {
  startTeams: 1,
  liveMap: 4, teams: 4,
  liveStandings: 3, finalStandings: 3, joinShare: 3, photoReview: 3, chat: 3, staffChannel: 3,
  feed: 3, analytics: 3, heatmap: 3,
};
const DEFAULT_PANEL_WEIGHT = 2;

/** The panels that read badly in a narrow lane and are given a double span. */
const WIDE_PANELS: PanelId[] = ['liveMap'];

/**
 * Rank of a panel. An id the ordering has never heard of sorts to the TAIL
 * instead of throwing or vanishing: a future lane that adds a panel without
 * ranking it still gets a rendered, reachable panel.
 */
export function panelPriority(id: string): number {
  const at = (PANEL_PRIORITY as string[]).indexOf(id);
  return at === -1 ? PANEL_PRIORITY.length : at;
}

export function panelWeight(id: string): number {
  return PANEL_WEIGHT[id as PanelId] ?? DEFAULT_PANEL_WEIGHT;
}

export function panelSpan(id: string): 1 | 2 {
  return (WIDE_PANELS as string[]).includes(id) ? 2 : 1;
}

export type ColumnLayout = {
  columns: PanelId[][];
  /** Grid span of each lane; a lane spans as wide as its widest panel. */
  spans: number[];
  /** Sum of the spans: the grid template width to render. */
  gridColumns: number;
};

/**
 * Distribute panels over lanes. One column returns the input UNTOUCHED, so the
 * phone layout is by construction whatever the plan produced. More than one
 * column walks the panels in priority order and drops each into the least loaded
 * lane (ties go to the lowest lane index), which is deterministic, stable and
 * puts the most urgent panel at the top of the inline start lane.
 */
export function assignPanelColumns(panels: PanelId[], columns: ColumnCount): ColumnLayout {
  return assignWithPriority(panels, columns, panelPriority);
}

function assignWithPriority(
  panels: PanelId[],
  columns: ColumnCount,
  priority: (id: string) => number,
): ColumnLayout {
  if (panels.length === 0) return { columns: [], spans: [], gridColumns: 1 };
  if (columns === 1) return { columns: [[...panels]], spans: [1], gridColumns: 1 };

  const laneCount = Math.min(columns, panels.length);
  const lanes: PanelId[][] = Array.from({ length: laneCount }, () => []);
  const load = new Array<number>(laneCount).fill(0);

  const ordered = panels
    .map((id, index) => ({ id, index }))
    .sort((a, b) => priority(a.id) - priority(b.id) || a.index - b.index);

  for (const { id } of ordered) {
    let best = 0;
    for (let i = 1; i < laneCount; i++) if (load[i] < load[best]) best = i;
    lanes[best].push(id);
    load[best] += panelWeight(id);
  }

  const spans = lanes.map((lane) => lane.reduce((w, id) => Math.max(w, panelSpan(id)), 1));
  return { columns: lanes, spans, gridColumns: spans.reduce((a, b) => a + b, 0) };
}

/**
 * The panels the always on screen zone actually keeps, in the order it wants
 * them. The join card is the one state dependent rank: while nobody has joined
 * it is the ONLY thing the organizer is doing, and once teams are in it becomes
 * reference material. It is re-ranked, never hidden, so a late joiner is always
 * servable. (The printable station QR sheet used to be pinned beside it for the
 * whole event; it now lives on the share surface, see PANEL_GROUP.)
 */
export function pinnedPanelIds(plan: RunConsolePlan, opts: { teamCount: number }): PanelId[] {
  const panels = pinnedPanels(plan);
  const rank = opts && opts.teamCount === 0
    ? (id: string) => (id === 'joinShare' ? -1 : panelPriority(id))
    : panelPriority;
  return [...panels]
    .map((id, index) => ({ id, index }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index)
    .map((e) => e.id);
}

/** The always on screen zone, laid out over the viewport's lanes. */
export function buildPinnedLayout(
  plan: RunConsolePlan,
  columns: ColumnCount,
  opts: { teamCount: number },
): ColumnLayout {
  const panels = pinnedPanelIds(plan, opts);
  if (columns === 1) return { columns: [panels], spans: [1], gridColumns: 1 };
  return assignWithPriority(panels, columns, (id) => panels.indexOf(id as PanelId));
}

/** How many lanes the viewport can carry. No window ⇒ both false ⇒ a phone. */
// Deliberately the SAME boundaries the emitted classes use (`lg:` = 1024px), so
// the JS answer and the CSS answer can never disagree at a viewport width.
export const CONSOLE_MEDIUM_QUERY = '(min-width: 1024px)';
export const CONSOLE_WIDE_QUERY = '(min-width: 1536px)';

export function consoleColumnCount(o: { medium: boolean; wide: boolean }): ColumnCount {
  if (!o.medium) return 1;
  return o.wide ? 3 : 2;
}

/** The section pane sits beside the rail, so it carries one lane less. */
export function sectionColumnCount(columns: ColumnCount): ColumnCount {
  return Math.max(1, columns - 1) as ColumnCount;
}

// Static class strings only: Tailwind cannot see `grid-cols-${n}`. Every lookup
// keeps `grid-cols-1` as the base so a phone stays single column even if the
// media query hook has not resolved yet.
const GRID_TEMPLATE_CLASS: Record<number, string> = {
  1: 'grid grid-cols-1 gap-4 items-start',
  2: 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start',
  3: 'grid grid-cols-1 lg:grid-cols-3 gap-4 items-start',
  4: 'grid grid-cols-1 lg:grid-cols-4 gap-4 items-start',
};

export function gridTemplateClass(gridColumns: number): string {
  return GRID_TEMPLATE_CLASS[gridColumns] ?? GRID_TEMPLATE_CLASS[1];
}

export function columnSpanClass(span: number): string {
  return span >= 2 ? 'lg:col-span-2' : '';
}
