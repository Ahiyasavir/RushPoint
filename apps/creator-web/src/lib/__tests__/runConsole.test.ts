// Run Console progressive disclosure (change: run-console-progressive-disclosure).
//
// The console's layout, grouping, badge counts, action severity, share links and
// human labels are all pure decisions, so they are proven here rather than in a
// component test runner creator-web does not have. The point of the extraction is
// that the badge on a FOLDED group and the content of the EXPANDED panel come from
// one pass over one state object, so they can never drift apart.
import { describe, it, expect } from 'vitest';
import {
  ALL_PANEL_IDS, GROUP_ORDER, PANEL_GROUP, DEFAULT_GROUP_OPEN,
  buildRunConsolePlan, planPanels, planHasPanel, readGroupState, writeGroupState,
  type RunConsoleState, type PanelId, type GroupId,
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
      'stationQr', 'survey', 'teams', 'trackables', 'zones',
    ]);
    expect(ALL_PANEL_IDS.length).toBe(23);
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

describe('readGroupState / writeGroupState', () => {
  it('round trips the open groups', () => {
    const state = { ...DEFAULT_GROUP_OPEN, moderation: true, gameMechanics: true };
    expect(readGroupState(writeGroupState(state), DEFAULT_GROUP_OPEN)).toEqual(state);
  });

  it('ignores an unknown group id in stored data', () => {
    const raw = JSON.stringify({ moderation: true, somethingRemoved: true });
    const parsed = readGroupState(raw, DEFAULT_GROUP_OPEN) as Record<string, boolean>;
    expect(parsed.moderation).toBe(true);
    expect(parsed.somethingRemoved).toBeUndefined();
  });

  it('falls back to the defaults on malformed or missing data without throwing', () => {
    for (const raw of ['', '{', 'null', '[]', '"nope"', null, undefined]) {
      expect(readGroupState(raw, DEFAULT_GROUP_OPEN), String(raw)).toEqual(DEFAULT_GROUP_OPEN);
    }
  });

  it('keeps a non boolean stored value from corrupting a group', () => {
    const parsed = readGroupState(JSON.stringify({ moderation: 'yes' }), DEFAULT_GROUP_OPEN);
    expect(parsed.moderation).toBe(DEFAULT_GROUP_OPEN.moderation);
  });

  it('opens the teams group by default and collapses the rest', () => {
    expect(DEFAULT_GROUP_OPEN.teamsAndScores).toBe(true);
    expect(DEFAULT_GROUP_OPEN.gameMechanics).toBe(false);
    expect(DEFAULT_GROUP_OPEN.moderation).toBe(false);
    expect(DEFAULT_GROUP_OPEN.shareAndScreens).toBe(false);
    expect(DEFAULT_GROUP_OPEN.afterTheRun).toBe(false);
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
