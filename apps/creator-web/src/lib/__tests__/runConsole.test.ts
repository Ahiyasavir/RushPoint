// Run Console progressive disclosure (change: run-console-progressive-disclosure).
//
// The console's layout, grouping, badge counts, action severity, share links and
// human labels are all pure decisions, so they are proven here rather than in a
// component test runner creator-web does not have. The point of the extraction is
// that the badge on a FOLDED group and the content of the EXPANDED panel come from
// one pass over one state object, so they can never drift apart.
import { describe, it, expect } from 'vitest';
import {
  ALL_PANEL_IDS, GROUP_ORDER, PANEL_GROUP, SECTION_ORDER, DEFAULT_SECTION,
  PANEL_PRIORITY, panelPriority, panelWeight, panelSpan,
  buildRunConsolePlan, planPanels, planHasPanel,
  panelPlacement, buildRunConsoleSections, pinnedPanels, resolveSection, sectionStateKey,
  assignPanelColumns, buildPinnedLayout, consoleColumnCount, sectionColumnCount,
  gridTemplateClass, columnSpanClass,
  type RunConsoleState, type PanelId, type GroupId, type SectionId, type ColumnCount,
} from '../runConsoleLayout';
import { RUN_ACTION_IDS, classifyRunAction, runActionVariant, parseScoreDelta } from '../runConsoleActions';
import { SHARE_ARTIFACT_IDS, buildShareArtifacts, type ShareArtifactId } from '../runShareArtifacts';
import { resolveTeamLabel, resolveTaskLabel, shortId } from '../runConsoleLabels';

// A state where every optional surface has something in it, so the plan is at its
// widest for the given status.
function fullState(status: RunConsoleState['status']): RunConsoleState {
  return {
    status,
    teamCount: 6,
    alertCount: 2,
    pendingPhotoCount: 5,
    photoQueueCount: 7,
    feedItemCount: 3,
    chatThreadCount: 4,
    unreadChatThreads: 2,
    hotZoneActive: true,
    hasLeaderboard: true,
    hasStaffPin: true,
    surveyResultCount: 3,
  };
}

// A brand new run: nobody joined, nothing submitted, nothing configured.
function emptyState(status: RunConsoleState['status']): RunConsoleState {
  return {
    status,
    teamCount: 0,
    alertCount: 0,
    pendingPhotoCount: 0,
    photoQueueCount: 0,
    feedItemCount: 0,
    chatThreadCount: 0,
    unreadChatThreads: 0,
    hotZoneActive: false,
    hasLeaderboard: false,
    hasStaffPin: false,
    surveyResultCount: 0,
  };
}

const PRIMARY_PANELS: PanelId[] = ['joinShare', 'stationQr', 'startTeams', 'alerts', 'broadcast', 'liveMap'];

describe('buildRunConsolePlan — catalogue totality', () => {
  it('assigns every panel to exactly one group', () => {
    for (const id of ALL_PANEL_IDS) {
      expect(PANEL_GROUP[id], id).toBeDefined();
      expect(GROUP_ORDER).toContain(PANEL_GROUP[id]);
    }
    // No duplicate ids in the catalogue.
    expect(new Set(ALL_PANEL_IDS).size).toBe(ALL_PANEL_IDS.length);
  });

  // The catalogue is the contract: a panel added to the console without being
  // grouped fails here (and, being a closed union, also fails typecheck).
  it('catalogues exactly the documented set of panels', () => {
    expect([...ALL_PANEL_IDS].sort()).toEqual([
      'alerts', 'analytics', 'broadcast', 'chat', 'feed', 'feedback', 'finalStandings',
      'flashMission', 'heatmap', 'hotZone', 'joinShare', 'liveMap', 'liveStandings',
      'photoReview', 'runSummary', 'shareScreens', 'staffInvite', 'startTeams',
      'stationQr', 'survey', 'taskAvailability', 'teams', 'trackables', 'zones',
    ]);
    expect(ALL_PANEL_IDS.length).toBe(24);
  });

  it('renders every catalogued panel somewhere across the three run statuses', () => {
    const seen = new Map<PanelId, Set<GroupId>>();
    for (const status of ['draft', 'live', 'finished'] as const) {
      for (const group of buildRunConsolePlan(fullState(status)).groups) {
        for (const panel of group.panels) {
          const groups = seen.get(panel) ?? new Set<GroupId>();
          groups.add(group.id);
          seen.set(panel, groups);
        }
      }
    }
    for (const id of ALL_PANEL_IDS) {
      expect(seen.get(id), `${id} is never rendered`).toBeDefined();
      // A panel is never split across two groups.
      expect([...seen.get(id)!], id).toEqual([PANEL_GROUP[id]]);
    }
  });

  it('every panel count on a group matches its panel list', () => {
    for (const group of buildRunConsolePlan(fullState('live')).groups) {
      expect(group.summary.panelCount).toBe(group.panels.length);
    }
  });
});

describe('buildRunConsolePlan — the primary zone', () => {
  it('holds exactly the first five minutes controls on a live run', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    const primary = plan.groups.find((g) => g.id === 'primary');
    expect(primary).toBeDefined();
    expect([...primary!.panels].sort()).toEqual([...PRIMARY_PANELS].sort());
  });

  it('never promotes a power user panel into the primary zone', () => {
    const promoted: PanelId[] = [
      'hotZone', 'flashMission', 'trackables', 'zones', 'photoReview', 'feed', 'chat',
      'liveStandings', 'finalStandings', 'teams', 'shareScreens', 'staffInvite',
      'runSummary', 'analytics', 'heatmap', 'feedback', 'survey',
    ];
    for (const status of ['draft', 'live', 'finished'] as const) {
      const primary = buildRunConsolePlan(fullState(status)).groups.find((g) => g.id === 'primary');
      for (const id of promoted) {
        expect(primary?.panels ?? [], `${id} in primary at ${status}`).not.toContain(id);
      }
    }
  });

  it('is always the first group and is never collapsible', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    expect(plan.groups[0].id).toBe('primary');
    expect(plan.groups[0].collapsible).toBe(false);
    for (const g of plan.groups.slice(1)) expect(g.collapsible).toBe(true);
  });
});

describe('buildRunConsolePlan — status gating', () => {
  it('hides the post run tools while the run is live', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    for (const id of ['runSummary', 'analytics', 'heatmap', 'feedback'] as PanelId[]) {
      expect(planHasPanel(plan, id), id).toBe(false);
    }
    expect(planHasPanel(plan, 'liveStandings')).toBe(true);
    expect(planHasPanel(plan, 'finalStandings')).toBe(false);
  });

  it('hides the live only tools once the run is finished', () => {
    const plan = buildRunConsolePlan(fullState('finished'));
    for (const id of ['hotZone', 'flashMission', 'trackables', 'zones', 'chat'] as PanelId[]) {
      expect(planHasPanel(plan, id), id).toBe(false);
    }
    expect(planHasPanel(plan, 'finalStandings')).toBe(true);
    expect(planHasPanel(plan, 'runSummary')).toBe(true);
  });

  it('drops the whole game mechanics group on a finished run', () => {
    const ids = buildRunConsolePlan(fullState('finished')).groups.map((g) => g.id);
    expect(ids).not.toContain('gameMechanics');
    expect(ids).toContain('afterTheRun');
  });
});

describe('buildRunConsolePlan — empty group suppression', () => {
  it('omits a group whose panels are all empty at the current state', () => {
    const plan = buildRunConsolePlan(emptyState('live'));
    const ids = plan.groups.map((g) => g.id);
    // Nothing submitted, no feed, no chat threads: moderation has nothing to show.
    expect(ids).not.toContain('moderation');
    // Nothing to report yet either.
    expect(ids).not.toContain('afterTheRun');
    // The share surface always has the access code, and the teams list always
    // renders (its own empty state is the invitation to share the code).
    expect(ids).toContain('shareAndScreens');
    expect(ids).toContain('teamsAndScores');
  });

  it('keeps the alert panel out of the primary zone when there is no alert', () => {
    const plan = buildRunConsolePlan(emptyState('live'));
    expect(planHasPanel(plan, 'alerts')).toBe(false);
    expect(planHasPanel(plan, 'liveMap')).toBe(false); // no team has reported yet
    expect(planHasPanel(plan, 'joinShare')).toBe(true);
  });

  it('shows the staff invite panel only once a PIN exists', () => {
    expect(planHasPanel(buildRunConsolePlan(emptyState('live')), 'staffInvite')).toBe(false);
    expect(planHasPanel(buildRunConsolePlan(fullState('live')), 'staffInvite')).toBe(true);
  });
});

describe('buildRunConsolePlan — folded group summaries', () => {
  it('reports pending photos and unread chat threads on the moderation group', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    const moderation = plan.groups.find((g) => g.id === 'moderation');
    expect(moderation?.summary.pendingPhotos).toBe(5);
    expect(moderation?.summary.unreadChats).toBe(2);
  });

  it('reports an active hot zone on the game mechanics group', () => {
    const active = buildRunConsolePlan(fullState('live')).groups.find((g) => g.id === 'gameMechanics');
    expect(active?.summary.hotZoneActive).toBe(true);
    const idle = buildRunConsolePlan({ ...fullState('live'), hotZoneActive: false })
      .groups.find((g) => g.id === 'gameMechanics');
    expect(idle?.summary.hotZoneActive).toBe(false);
  });

  it('reports the team count on the teams group from the same value the panel renders', () => {
    const state = { ...fullState('live'), teamCount: 11 };
    const teams = buildRunConsolePlan(state).groups.find((g) => g.id === 'teamsAndScores');
    expect(teams?.summary.teamCount).toBe(state.teamCount);
  });

  it('reports zero rather than a stale count when a queue empties', () => {
    const state = { ...fullState('live'), pendingPhotoCount: 0, unreadChatThreads: 0 };
    const moderation = buildRunConsolePlan(state).groups.find((g) => g.id === 'moderation');
    expect(moderation?.summary.pendingPhotos).toBe(0);
    expect(moderation?.summary.unreadChats).toBe(0);
  });
});

describe('planPanels', () => {
  it('lists the panels of one group and nothing else', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    expect(planPanels(plan, 'primary').sort()).toEqual([...PRIMARY_PANELS].sort());
    expect(planPanels(plan, 'gameMechanics')).toContain('hotZone');
    expect(planPanels(plan, 'gameMechanics')).not.toContain('teams');
  });
});

// ── Section navigation (change: run-console-density) ────────────────────────
// The accordions are gone: the console is a Builder style rail plus ONE visible
// section. The property that replaces "is it expanded?" is REACHABILITY — a
// panel that lands in no section is not merely collapsed, it is invisible and
// unreachable, which is strictly worse than the scrolling it replaced.
describe('panelPlacement — every panel is reachable in exactly one place', () => {
  it('places every catalogued panel either pinned or in exactly one section', () => {
    const seen = new Map<PanelId, string>();
    for (const id of ALL_PANEL_IDS) {
      const where = panelPlacement(id);
      expect(where, id).toBeDefined();
      expect(where === 'pinned' || SECTION_ORDER.includes(where as SectionId), id).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.set(id, where);
    }
    expect(seen.size).toBe(ALL_PANEL_IDS.length);
  });

  it('pins exactly the primary group and sections everything else', () => {
    for (const id of ALL_PANEL_IDS) {
      const expected = PANEL_GROUP[id] === 'primary' ? 'pinned' : PANEL_GROUP[id];
      expect(panelPlacement(id), id).toBe(expected);
    }
  });

  it('derives the section order from the group order with the pinned group removed', () => {
    expect(SECTION_ORDER).toEqual(GROUP_ORDER.filter((g) => g !== 'primary'));
    expect(SECTION_ORDER).not.toContain('primary' as GroupId);
    expect(new Set(SECTION_ORDER).size).toBe(SECTION_ORDER.length);
  });
});

describe('buildRunConsoleSections / pinnedPanels', () => {
  it('covers every visible panel exactly once across the pinned zone and the sections', () => {
    for (const status of ['draft', 'live', 'finished'] as const) {
      const plan = buildRunConsolePlan(fullState(status));
      const visible = plan.groups.flatMap((g) => g.panels);
      const rendered = [
        ...pinnedPanels(plan),
        ...buildRunConsoleSections(plan).flatMap((s) => s.panels),
      ];
      expect([...rendered].sort(), status).toEqual([...visible].sort());
      expect(new Set(rendered).size, status).toBe(rendered.length);
    }
  });

  it('lists the sections in the section order and never an empty one', () => {
    const sections = buildRunConsoleSections(buildRunConsolePlan(emptyState('live')));
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual(SECTION_ORDER.filter((id) => ids.includes(id)));
    for (const s of sections) expect(s.panels.length, s.id).toBeGreaterThan(0);
    // Nothing submitted and nothing to report: those sections do not exist yet.
    expect(ids).not.toContain('moderation');
    expect(ids).not.toContain('afterTheRun');
  });

  it('carries the same summary the plan computed, so a rail badge cannot drift', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    const moderation = buildRunConsoleSections(plan).find((s) => s.id === 'moderation');
    expect(moderation?.summary.pendingPhotos).toBe(5);
    expect(moderation?.summary.unreadChats).toBe(2);
    expect(moderation?.summary.panelCount).toBe(moderation?.panels.length);
  });

  it('never puts a pinned panel in a section', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    const sectioned = buildRunConsoleSections(plan).flatMap((s) => s.panels);
    for (const id of PRIMARY_PANELS) expect(sectioned, id).not.toContain(id);
  });
});

describe('resolveSection', () => {
  const live = buildRunConsoleSections(buildRunConsolePlan(fullState('live')));

  it('defaults to the section an organizer needs during an incident', () => {
    expect(DEFAULT_SECTION).toBe('teamsAndScores');
    expect(resolveSection(live, null)).toBe('teamsAndScores');
    expect(resolveSection(live, undefined)).toBe('teamsAndScores');
  });

  it('honours a valid stored selection', () => {
    expect(resolveSection(live, 'moderation')).toBe('moderation');
  });

  it('falls back to the default rather than showing nothing for a stale or junk id', () => {
    for (const bad of ['', 'primary', 'somethingRemoved', '{']) {
      expect(resolveSection(live, bad), bad).toBe('teamsAndScores');
    }
  });

  it('falls back to the first available section when the default is not rendered', () => {
    const finished = buildRunConsoleSections(buildRunConsolePlan({
      ...fullState('finished'), hasLeaderboard: false, teamCount: 0,
    }));
    const resolved = resolveSection(finished, 'gameMechanics');
    expect(finished.map((s) => s.id)).toContain(resolved);
  });

  it('returns null only when there is no section at all', () => {
    expect(resolveSection([], 'moderation')).toBeNull();
  });

  it('namespaces the stored selection per run', () => {
    expect(sectionStateKey('run1')).not.toBe(sectionStateKey('run2'));
    expect(sectionStateKey('run1')).toContain('run1');
  });
});

// ── Column placement (change: run-console-density) ───────────────────────────
describe('panel priority / weight / span catalogue', () => {
  it('ranks exactly the catalogued panels, once each', () => {
    expect([...PANEL_PRIORITY].sort()).toEqual([...ALL_PANEL_IDS].sort());
    expect(new Set(PANEL_PRIORITY).size).toBe(PANEL_PRIORITY.length);
  });

  it('gives every catalogued panel a positive weight and a legal span', () => {
    for (const id of ALL_PANEL_IDS) {
      expect(panelWeight(id), id).toBeGreaterThan(0);
      expect([1, 2], id).toContain(panelSpan(id));
    }
  });

  it('ranks an incident control ahead of anything consulted after the run', () => {
    for (const late of ['runSummary', 'analytics', 'heatmap', 'feedback', 'survey'] as PanelId[]) {
      expect(panelPriority('alerts'), late).toBeLessThan(panelPriority(late));
      expect(panelPriority('teams'), late).toBeLessThan(panelPriority(late));
    }
  });

  it('is total over an unknown id instead of throwing or dropping it', () => {
    const unknown = 'panelAddedByALaterLane' as PanelId;
    expect(panelPriority(unknown)).toBe(PANEL_PRIORITY.length);
    expect(panelWeight(unknown)).toBeGreaterThan(0);
    expect(panelSpan(unknown)).toBe(1);
  });
});

describe('assignPanelColumns', () => {
  it('places every catalogued panel exactly once at every column count', () => {
    for (const columns of [1, 2, 3] as ColumnCount[]) {
      const flat = assignPanelColumns(ALL_PANEL_IDS, columns).columns.flat();
      expect([...flat].sort(), String(columns)).toEqual([...ALL_PANEL_IDS].sort());
      expect(new Set(flat).size, String(columns)).toBe(ALL_PANEL_IDS.length);
    }
  });

  it('leaves the phone layout exactly as the plan produced it', () => {
    const panels = planPanels(buildRunConsolePlan(fullState('live')), 'primary');
    const layout = assignPanelColumns(panels, 1);
    expect(layout.columns).toEqual([panels]);
    expect(layout.gridColumns).toBe(1);
    expect(assignPanelColumns(ALL_PANEL_IDS, 1).columns).toEqual([ALL_PANEL_IDS]);
  });

  it('is deterministic and stable', () => {
    const a = assignPanelColumns(ALL_PANEL_IDS, 3);
    const b = assignPanelColumns(ALL_PANEL_IDS, 3);
    expect(a).toEqual(b);
  });

  it('never makes more lanes than panels or than the requested column count', () => {
    expect(assignPanelColumns(['teams'], 3).columns.length).toBe(1);
    expect(assignPanelColumns(['teams', 'alerts'], 3).columns.length).toBe(2);
    expect(assignPanelColumns(ALL_PANEL_IDS, 2).columns.length).toBe(2);
    for (const layout of [assignPanelColumns(ALL_PANEL_IDS, 3)]) {
      for (const lane of layout.columns) expect(lane.length).toBeGreaterThan(0);
    }
  });

  it('produces no lane at all for an empty panel list', () => {
    const layout = assignPanelColumns([], 3);
    expect(layout.columns).toEqual([]);
    expect(layout.spans).toEqual([]);
    expect(layout.gridColumns).toBe(1);
  });

  it('puts the highest priority panel at the top of the first lane', () => {
    const layout = assignPanelColumns(['survey', 'alerts', 'analytics'], 3);
    expect(layout.columns[0][0]).toBe('alerts');
  });

  it('gives a lane holding the wide live map a span of two and sums the spans', () => {
    const layout = assignPanelColumns(['liveMap', 'broadcast', 'stationQr'], 3);
    const mapLane = layout.columns.findIndex((lane) => lane.includes('liveMap'));
    expect(layout.spans[mapLane]).toBe(2);
    for (let i = 0; i < layout.spans.length; i++) {
      if (i !== mapLane) expect(layout.spans[i]).toBe(1);
    }
    expect(layout.gridColumns).toBe(layout.spans.reduce((a, b) => a + b, 0));
  });

  it('places an id it has never heard of exactly once, at the tail', () => {
    const unknown = 'panelAddedByALaterLane' as PanelId;
    const layout = assignPanelColumns(['alerts', unknown, 'teams'], 2);
    const flat = layout.columns.flat();
    expect(flat.filter((p) => p === unknown).length).toBe(1);
    expect([...flat].sort()).toEqual(['alerts', 'teams', unknown].sort());
  });
});

describe('buildPinnedLayout', () => {
  it('leads with the join card while nobody has joined and demotes it once teams are in', () => {
    const plan = buildRunConsolePlan(emptyState('live'));
    const before = buildPinnedLayout(plan, 3, { teamCount: 0 });
    expect(before.columns[0][0]).toBe('joinShare');

    const busy = buildRunConsolePlan(fullState('live'));
    const during = buildPinnedLayout(busy, 3, { teamCount: 6 });
    expect(during.columns[0][0]).toBe('alerts');
    // Demoted, never removed: a late joiner can arrive at any moment.
    expect(during.columns.flat()).toContain('joinShare');
  });

  it('lays out only the pinned panels', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    const flat = buildPinnedLayout(plan, 3, { teamCount: 6 }).columns.flat();
    expect([...flat].sort()).toEqual([...pinnedPanels(plan)].sort());
  });

  it('collapses to one lane on a phone, in the plan order', () => {
    const plan = buildRunConsolePlan(fullState('live'));
    const layout = buildPinnedLayout(plan, 1, { teamCount: 6 });
    expect(layout.columns).toEqual([pinnedPanels(plan)]);
  });
});

describe('consoleColumnCount / sectionColumnCount', () => {
  it('is one column on a phone, whatever else is true', () => {
    expect(consoleColumnCount({ medium: false, wide: false })).toBe(1);
    // A hook that has not resolved yet reports false for both: still a phone.
    expect(consoleColumnCount({ medium: false, wide: true })).toBe(1);
  });

  it('widens with the viewport', () => {
    expect(consoleColumnCount({ medium: true, wide: false })).toBe(2);
    expect(consoleColumnCount({ medium: true, wide: true })).toBe(3);
  });

  it('gives the section pane one lane less than the full width zone, never zero', () => {
    expect(sectionColumnCount(1)).toBe(1);
    expect(sectionColumnCount(2)).toBe(1);
    expect(sectionColumnCount(3)).toBe(2);
  });
});

describe('grid class lookup', () => {
  it('returns a static, interpolation free class for every reachable width', () => {
    for (const n of [1, 2, 3, 4, 5, 99]) {
      const cls = gridTemplateClass(n);
      expect(cls, String(n)).toBeTruthy();
      expect(cls, String(n)).not.toContain('${');
      expect(cls).toContain('grid-cols-1');
    }
    for (const span of [1, 2, 3]) {
      expect(columnSpanClass(span), String(span)).not.toContain('${');
    }
    expect(columnSpanClass(1)).toBe('');
    expect(columnSpanClass(2)).toContain('col-span-2');
  });
});

describe('classifyRunAction', () => {
  it('classifies every catalogued action exactly once', () => {
    expect(new Set(RUN_ACTION_IDS).size).toBe(RUN_ACTION_IDS.length);
    for (const id of RUN_ACTION_IDS) {
      expect(['routine', 'cautionary', 'destructive'], id).toContain(classifyRunAction(id));
    }
  });

  it('treats ending the run and rewriting a score as destructive', () => {
    expect(classifyRunAction('finalizeRun')).toBe('destructive');
    expect(classifyRunAction('adjustTeamScore')).toBe('destructive');
  });

  // Taking a task out of play (change: live-task-pause) is reversible, but it
  // removes a scoring opportunity from every team not yet at the stop; putting it
  // back only ever adds one.
  it('treats taking a task out of play as cautionary and restoring it as routine', () => {
    expect(classifyRunAction('pauseTask')).toBe('cautionary');
    expect(classifyRunAction('closeTask')).toBe('cautionary');
    expect(classifyRunAction('resumeTask')).toBe('routine');
  });

  it('treats skipping, hiding and deactivating as cautionary', () => {
    expect(classifyRunAction('skipStage')).toBe('cautionary');
    expect(classifyRunAction('deactivateAnnouncement')).toBe('cautionary');
    expect(classifyRunAction('hideFeedPhoto')).toBe('cautionary');
  });

  it('leaves the everyday controls routine', () => {
    for (const id of ['startTeams', 'refreshStandings', 'inviteStaff', 'acknowledgeAlert',
      'broadcastAnnouncement', 'pushFlashMission', 'printStationQr', 'copyShareLink'] as const) {
      expect(classifyRunAction(id), id).toBe('routine');
    }
  });

  // Releasing a team the safe-zone latch is holding is the ONLY way a human can
  // unstick a player whose phone cannot produce the fix the latch demands
  // (change: out-of-bounds-recovery). A red destructive confirm would make staff
  // hesitate over a safety action.
  it('keeps releasing a stuck out-of-bounds team a routine, unscary action', () => {
    expect(classifyRunAction('clearTeamOutOfBounds')).toBe('routine');
    expect(runActionVariant('clearTeamOutOfBounds')).not.toBe('danger');
  });

  it('drives the button variant from the classification', () => {
    expect(runActionVariant('finalizeRun')).toBe('danger');
    expect(runActionVariant('adjustTeamScore')).toBe('danger');
    expect(runActionVariant('startTeams')).toBe('primary');
    expect(runActionVariant('skipStage')).toBe('subtle');
  });
});

describe('parseScoreDelta (re exported for the console)', () => {
  it('accepts a deliberate signed whole number', () => {
    expect(parseScoreDelta('5')).toBe(5);
    expect(parseScoreDelta('-3')).toBe(-3);
  });

  it('rejects anything that would submit a no op adjustment', () => {
    for (const bad of ['', '  ', 'abc', '0']) expect(parseScoreDelta(bad), bad).toBeNull();
  });
});

// The URLs are pinned as literals: consolidating the two old cards must not
// change a link a host has already shared with players or a screen.
const SHARE_INPUT = {
  playUrl: 'https://play.example',
  accessCode: 'ABC123',
  ownerUid: 'owner1',
  gameId: 'game1',
  runId: 'run1',
  hasStaffPin: false,
  status: 'live' as const,
};
function byId(list: ReturnType<typeof buildShareArtifacts>, id: ShareArtifactId) {
  return list.find((a) => a.id === id)!;
}

describe('buildShareArtifacts', () => {
  it('lists exactly one entry per shareable artifact', () => {
    const list = buildShareArtifacts(SHARE_INPUT);
    expect(list.map((a) => a.id).sort()).toEqual([...SHARE_ARTIFACT_IDS].sort());
    expect(new Set(list.map((a) => a.id)).size).toBe(SHARE_ARTIFACT_IDS.length);
  });

  it('marks the recap unavailable while the run is live rather than dropping it', () => {
    const list = buildShareArtifacts(SHARE_INPUT);
    expect(byId(list, 'recap').available).toBe(false);
    expect(byId(list, 'recap').unavailableUntilFinished).toBe(true);
    expect(byId(list, 'joinLink').available).toBe(true);
  });

  it('makes the recap available and the join link stale once the run is finished', () => {
    const list = buildShareArtifacts({ ...SHARE_INPUT, status: 'finished' });
    expect(byId(list, 'recap').available).toBe(true);
    expect(byId(list, 'joinLink').available).toBe(false);
    expect(byId(list, 'accessCode').available).toBe(true);
  });

  it('offers the staff link only once a staff PIN exists', () => {
    expect(byId(buildShareArtifacts(SHARE_INPUT), 'staffLink').available).toBe(false);
    expect(byId(buildShareArtifacts({ ...SHARE_INPUT, hasStaffPin: true }), 'staffLink').available).toBe(true);
  });

  it('produces exactly the URLs the two old cards produced', () => {
    const list = buildShareArtifacts({ ...SHARE_INPUT, hasStaffPin: true, status: 'finished' });
    expect(byId(list, 'accessCode').url).toBeNull();
    expect(byId(list, 'accessCode').copyValue).toBe('ABC123');
    expect(byId(list, 'joinLink').url).toBe('https://play.example/?code=ABC123');
    expect(byId(list, 'boardLink').url).toBe('https://play.example/?board=ABC123');
    expect(byId(list, 'ceremonyLink').url).toBe('https://play.example/?board=ABC123&ceremony');
    expect(byId(list, 'tvScreen').url).toBe('https://play.example/?tv=ABC123');
    expect(byId(list, 'recap').url).toBe('https://play.example/?recap=ABC123');
    expect(byId(list, 'staffLink').url).toBe('https://play.example/?staff=owner1.game1.run1');
    for (const a of list) expect(a.copyValue, a.id).not.toBe('');
  });

  it('escapes the staff context the same way the old staff card did', () => {
    const list = buildShareArtifacts({ ...SHARE_INPUT, hasStaffPin: true, gameId: 'g a/me' });
    expect(byId(list, 'staffLink').url).toBe('https://play.example/?staff=owner1.g%20a%2Fme.run1');
  });

  it('flags the audience links that must publish the board before they are shared', () => {
    const list = buildShareArtifacts(SHARE_INPUT);
    expect(byId(list, 'boardLink').requiresPublish).toBe(true);
    expect(byId(list, 'ceremonyLink').requiresPublish).toBe(true);
    expect(byId(list, 'tvScreen').requiresPublish).toBe(true);
    expect(byId(list, 'joinLink').requiresPublish).toBe(false);
    expect(byId(list, 'staffLink').requiresPublish).toBe(false);
  });
});

describe('resolveTeamLabel / resolveTaskLabel', () => {
  const teams = [{ id: 'team-aaaaaaaaaa', displayName: 'The Foxes' }, { id: 'team-b', displayName: '' }];
  const fallback = (id: string) => `unknown (${id})`;

  it('shows the display name of a known team', () => {
    expect(resolveTeamLabel('team-aaaaaaaaaa', teams, fallback)).toBe('The Foxes');
  });

  it('falls back to a marked short id for an unknown team', () => {
    expect(resolveTeamLabel('zzzzzzzzzzzzzzzz', teams, fallback)).toBe('unknown (zzzzzzzz)');
  });

  it('falls back when the known team has no display name', () => {
    expect(resolveTeamLabel('team-b', teams, fallback)).toBe('unknown (team-b)');
  });

  it('does not throw on an empty collection or an empty id', () => {
    expect(resolveTeamLabel('anything', [], fallback)).toBe('unknown (anything)');
    expect(resolveTeamLabel('', [], fallback)).toBe('unknown ()');
  });

  it('shows the title of a known task and a marked short id otherwise', () => {
    const titles = new Map([['task-1', 'Find the fountain']]);
    expect(resolveTaskLabel('task-1', titles, fallback)).toBe('Find the fountain');
    expect(resolveTaskLabel('task-9999999999', titles, fallback)).toBe('unknown (task-999)');
    expect(resolveTaskLabel('task-1', new Map(), fallback)).toBe('unknown (task-1)');
  });

  it('shortens an id to eight characters, as the console always has', () => {
    expect(shortId('abcdefghijkl')).toBe('abcdefgh');
    expect(shortId('abc')).toBe('abc');
    expect(shortId('')).toBe('');
  });
});
