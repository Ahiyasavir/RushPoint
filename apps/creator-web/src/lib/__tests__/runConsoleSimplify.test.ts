import { describe, expect, it } from 'vitest';
import { PANEL_GROUP, SECTION_ORDER, defaultSection, ALL_PANEL_IDS, PRIMARY_SECTIONS, SECONDARY_SECTIONS } from '../runConsoleLayout';
import { buildInbox, consoleClockMs, inboxRowAction } from '../runConsoleInbox';
import { teamPageActionGroups } from '../runConsoleActions';

// run-console-simplify (field report 2026-09-27: "so complicated it is exhausting"). The console
// is organised by what the organizer is DOING: Now (everything waiting for you), Teams, Game. Setup
// and reports step back. Internal ids are kept (moderation = Now, teamsAndScores = Teams,
// gameMechanics = Game) so no panel had to be rewritten.
describe('three task-based screens', () => {
  it('orders the live screens Now, Teams, Game, then the secondary ones', () => {
    expect(SECTION_ORDER).toEqual(['moderation', 'teamsAndScores', 'gameMechanics', 'shareAndScreens', 'afterTheRun']);
    expect(PRIMARY_SECTIONS).toEqual(['moderation', 'teamsAndScores', 'gameMechanics']);
    expect(SECONDARY_SECTIONS).toEqual(['shareAndScreens', 'afterTheRun']);
  });
  it('opens a live run with teams on Now', () => {
    expect(defaultSection('live', 3)).toBe('moderation');
    expect(defaultSection('live', 0)).toBe('shareAndScreens'); // nobody joined: show how to join
    expect(defaultSection('finished', 3)).toBe('afterTheRun');
  });
  it('puts the inbox and the work queues on Now, the whole-game tools on Game', () => {
    expect(PANEL_GROUP.inbox).toBe('moderation');
    expect(PANEL_GROUP.photoReview).toBe('moderation');
    expect(PANEL_GROUP.feed).toBe('gameMechanics');
    expect(PANEL_GROUP.mediaGallery).toBe('gameMechanics');
    expect(PANEL_GROUP.flashMission).toBe('gameMechanics');
  });
  it('gives every panel exactly one home', () => {
    for (const id of ALL_PANEL_IDS) expect(PANEL_GROUP[id], id).toBeTruthy();
  });
});

describe('buildInbox: everything waiting for the organizer, in one list', () => {
  const NOW = Date.parse('2026-09-28T10:00:00.000Z');
  const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
  const inbox = buildInbox({
    nowMs: NOW,
    alerts: [{ id: 'a1', teamId: 't1', teamName: 'Lions', createdAt: ago(10), kind: 'sos' }],
    pending: [{ teamId: 't2', displayName: 'Eagles', taskId: 'm1', submittedAt: ago(40) }],
    unreadChats: [{ teamId: 't3', teamName: 'Bears', lastAt: ago(200) }],
    stuck: [{ teamId: 't4', teamName: 'Owls', since: ago(600) }],
    waiting: [{ teamId: 't5', teamName: 'Foxes', joinedAt: ago(90) }],
    staffUnread: { count: 1, lastAt: ago(5) },
  });
  it('urgent first (SOS, a review waiting 20 s+), then the oldest', () => {
    expect(inbox.map((i) => i.kind)).toEqual(['sos', 'review', 'stuckTeam', 'teamMessage', 'waitingToStart', 'staffMessage']);
  });
  it('each item carries its age and its team', () => {
    const r = inbox.find((i) => i.kind === 'review')!;
    expect(r.ageMs).toBe(40_000);
    expect(r.teamId).toBe('t2');
    expect(r.severity).toBe('urgent');
  });
  it('a review under 20 s is normal, not urgent', () => {
    const fresh = buildInbox({ nowMs: NOW, pending: [{ teamId: 't2', displayName: 'Eagles', taskId: 'm1', submittedAt: ago(5) }] });
    expect(fresh[0].severity).toBe('normal');
  });
  it('a flash mission waiting for approval is in the list, urgent once it has waited', () => {
    // Overnight 2026-09-29: a photo/video flash mission that needs approval lived only in the flash
    // panel, so the default screen never showed that a team was waiting for its points.
    const items = buildInbox({ nowMs: NOW, flashPending: [
      { flashId: 'f1', teamId: 't4', teamName: 'Bears', title: 'Farm', submittedAt: ago(45) },
      { flashId: 'f2', teamId: 't5', teamName: 'Owls', title: 'Gate', submittedAt: ago(3) },
    ] });
    expect(items.map((i) => i.kind)).toEqual(['flashReview', 'flashReview']);
    expect(items[0]).toMatchObject({ key: 'flash:f1:t4', teamId: 't4', flashId: 'f1', flashTitle: 'Farm', severity: 'urgent' });
    expect(items[1].severity).toBe('normal');
  });
  it('an empty world is an empty list, and junk never throws', () => {
    expect(buildInbox({ nowMs: NOW })).toEqual([]);
    expect(() => buildInbox(null as never)).not.toThrow();
    expect(buildInbox({ nowMs: NOW, pending: [{ teamId: 'x', displayName: 'X', taskId: 'y', submittedAt: 'soon' }] })[0].ageMs).toBe(0);
  });
});

// D4: the team page carries the complete action set, grouped by what it does, so the list row
// can stay down to one inline action.
describe('teamPageActionGroups: Play / Score / Danger', () => {
  it('sorts every team action into exactly one group, keeping the given order inside a group', () => {
    const g = teamPageActionGroups(['letIn', 'startTeam', 'adjustScore', 'routeTeam', 'skipTask', 'sendBack', 'removeTeam', 'holdTeam']);
    expect(g.play).toEqual(['letIn', 'startTeam', 'routeTeam', 'skipTask', 'sendBack', 'holdTeam']);
    expect(g.score).toEqual(['adjustScore']);
    expect(g.danger).toEqual(['removeTeam']);
  });
  it('Play has a fixed order, most frequent first; skipping a whole stage is last', () => {
    expect(teamPageActionGroups(['skipStage', 'holdTeam', 'routeTeam', 'skipTask', 'sendBack']).play)
      .toEqual(['routeTeam', 'skipTask', 'sendBack', 'holdTeam', 'skipStage']);
  });
  it('bringing a team back is Play, not Danger (it undoes the dangerous thing)', () => {
    expect(teamPageActionGroups(['restoreTeam']).play).toEqual(['restoreTeam']);
    expect(teamPageActionGroups(['restoreTeam']).danger).toEqual([]);
  });
  it('an unknown key is kept in Play rather than dropped, and junk never throws', () => {
    expect(teamPageActionGroups(['somethingNew']).play).toEqual(['somethingNew']);
    expect(teamPageActionGroups(null as never)).toEqual({ play: [], score: [], danger: [] });
  });
});

describe('consoleClockMs: how often the inbox clock ticks (overnight 2026-09-29)', () => {
  // Played: the console clock only ticked while a MISSION photo waited, so a flash mission waiting for
  // approval never turned urgent at 20 s and every age in the "now" list froze.
  it('ticks every second while anything can cross the 20 s line', () => {
    expect(consoleClockMs({ pendingReviews: 1, pendingFlash: 0, inboxItems: 1 })).toBe(1000);
    expect(consoleClockMs({ pendingReviews: 0, pendingFlash: 2, inboxItems: 2 })).toBe(1000);
  });
  it('ticks slowly while the list only shows ages', () => {
    expect(consoleClockMs({ pendingReviews: 0, pendingFlash: 0, inboxItems: 3 })).toBe(15_000);
  });
  it('does not tick for an empty list, and junk reads as empty', () => {
    expect(consoleClockMs({ pendingReviews: 0, pendingFlash: 0, inboxItems: 0 })).toBeNull();
    expect(consoleClockMs(null as never)).toBeNull();
  });
});

describe('inboxRowAction: where each row takes the organizer (overnight 2026-09-29)', () => {
  // Played: "פתיחה" on an SOS row opened the TEAM page, which says nothing about the SOS and cannot
  // acknowledge it. The safety row now goes to the alerts panel, where the location and the
  // acknowledge button are.
  it('an SOS goes to the alerts panel', () => {
    expect(inboxRowAction('sos')).toEqual({ panel: 'alerts' });
  });
  it('a flash mission waiting goes to the flash panel', () => {
    expect(inboxRowAction('flashReview')).toEqual({ panel: 'flashMission' });
  });
  it('a team waiting to start is started; the rest open the team page', () => {
    expect(inboxRowAction('waitingToStart')).toEqual({ startTeam: true });
    for (const k of ['outOfBounds', 'review', 'teamMessage', 'stuckTeam'] as const) expect(inboxRowAction(k)).toEqual({ teamPage: true });
  });
  it('the staff channel goes to its panel', () => {
    expect(inboxRowAction('staffMessage')).toEqual({ panel: 'staffChannel' });
  });
});
