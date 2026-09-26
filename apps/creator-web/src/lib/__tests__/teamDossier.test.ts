// team-dossier-and-search D1: everything about one team, as a plain view-model.
import { describe, it, expect } from 'vitest';
import { buildTeamDossier } from '../teamDossier';

const NOW = Date.parse('2026-09-26T10:30:00Z');
const titles: Record<string, string> = { a: 'השער הישן', b: 'חידת השוק', c: 'צילום קבוצתי' };
const input = (teamDoc: unknown) => ({
  teamDoc,
  taskTitle: (id: string) => titles[id] ?? '',
  stageTitle: (order: number) => `שלב ${order + 1}`,
  nowMs: NOW,
  rank: 2,
});

const fullTeam = {
  id: 't1',
  displayName: 'האריות',
  score: 140,
  status: 'active',
  launched: true,
  memberNames: ['דנה', 'יוסי'],
  controllerUid: 'u2',
  devices: [{ uid: 't1', name: 'הטלפון של דנה', joinedAt: 'x' }, { uid: 'u2', name: 'יוסי', joinedAt: 'y' }],
  activeTaskId: 'b',
  stages: [
    { order: 0, status: 'completed', tasks: [
      { taskId: 'a', status: 'completed', startedAt: '2026-09-26T10:00:00Z', completedAt: '2026-09-26T10:08:00Z', earnedScore: 90,
        answerLog: [{ at: '2026-09-26T10:05:00Z', answer: 'רומא', correct: false, kind: 'text' }, { at: '2026-09-26T10:07:00Z', answer: 'ירושלים', correct: true, kind: 'text' }] },
    ] },
    { order: 1, status: 'active', tasks: [
      { taskId: 'b', status: 'assigned', startedAt: '2026-09-26T10:20:00Z' },
      { taskId: 'c', status: 'completed', earnedScore: 50, completedAt: '2026-09-26T10:15:00Z' },
    ] },
  ],
  taskSubmissions: {
    c: { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/c.jpg', submittedAt: '2026-09-26T10:14:00Z', status: 'approved', mediaKind: 'photo', submittedBy: { uid: 'u2', name: 'יוסי' } },
  },
  scoreLedger: [
    { at: '2026-09-26T10:10:00Z', delta: 20, kind: 'adjust', reason: 'עזרו לקבוצה אחרת', by: 'organizer' },
    { at: '2026-09-26T10:25:00Z', delta: -25, kind: 'hint', taskId: 'b' },
  ],
  secretStaffNote: 'never shown',
};

describe('buildTeamDossier', () => {
  const d = buildTeamDossier(input(fullTeam))!;

  it('identity, score and rank', () => {
    expect(d.id).toBe('t1');
    expect(d.name).toBe('האריות');
    expect(d.score).toBe(140);
    expect(d.rank).toBe(2);
    expect(d.status).toBe('playing');
  });

  it('members and phones, with the sending phone marked', () => {
    expect(d.members).toEqual(['דנה', 'יוסי']);
    expect(d.phones).toEqual([{ uid: 't1', name: 'הטלפון של דנה', sending: false }, { uid: 'u2', name: 'יוסי', sending: true }]);
  });

  it('the current mission and how long they have been on it, from the injected clock', () => {
    expect(d.current).toEqual({ taskId: 'b', title: 'חידת השוק', minutes: 10 });
  });

  it('the timeline, stage by stage, with the answers they gave', () => {
    expect(d.timeline.map((s) => s.title)).toEqual(['שלב 1', 'שלב 2']);
    const a = d.timeline[0].tasks[0];
    expect(a).toMatchObject({ taskId: 'a', title: 'השער הישן', status: 'completed', earnedScore: 90, minutes: 8 });
    expect(a.answers).toEqual([{ answer: 'רומא', correct: false }, { answer: 'ירושלים', correct: true }]);
  });

  it('every submitted media item, with who sent it', () => {
    expect(d.media).toEqual([{
      taskId: 'c', title: 'צילום קבוצתי', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/c.jpg',
      kind: 'photo', status: 'approved', submittedAt: '2026-09-26T10:14:00Z', senderName: 'יוסי', posterUrl: '', durationSec: null,
    }]);
  });

  it('the score ledger, newest first, with mission titles', () => {
    expect(d.ledger.map((l) => l.delta)).toEqual([-25, 20]);
    expect(d.ledger[0]).toMatchObject({ kind: 'hint', taskTitle: 'חידת השוק' });
    expect(d.ledger[1]).toMatchObject({ kind: 'adjust', reason: 'עזרו לקבוצה אחרת', by: 'organizer' });
  });

  it('copies named fields OUT: an unknown field never reaches the screen', () => {
    expect(JSON.stringify(d)).not.toContain('never shown');
  });
});

describe('buildTeamDossier: never throws', () => {
  it('null / garbage in, null out', () => {
    expect(buildTeamDossier(input(null))).toBeNull();
    expect(buildTeamDossier(input('x'))).toBeNull();
    expect(buildTeamDossier(input({ displayName: 'no id' }))).toBeNull();
  });
  it('a bare team renders with empty sections', () => {
    const d = buildTeamDossier(input({ id: 't9', displayName: 'X' }))!;
    expect(d).toMatchObject({ members: [], phones: [], current: null, timeline: [], media: [], ledger: [], status: 'waiting' });
  });
  it('malformed nested values are dropped, not rendered', () => {
    const d = buildTeamDossier(input({
      id: 't9', displayName: 'X', memberNames: 'nope', devices: [null, { uid: 5 }],
      stages: [null, { order: 'x', tasks: 'nope' }], taskSubmissions: { a: { photoUrl: 'javascript:alert(1)' } },
      scoreLedger: [{ delta: 'x' }],
    }))!;
    expect(d.members).toEqual([]);
    expect(d.phones).toEqual([]);
    expect(d.media).toEqual([]);
    expect(d.ledger).toEqual([]);
  });
  it('a finished team has no current mission', () => {
    const d = buildTeamDossier(input({ ...fullTeam, status: 'finished', activeTaskId: null }))!;
    expect(d.status).toBe('finished');
    expect(d.current).toBeNull();
  });
});

describe('buildTeamDossier: reasons are words, never codes', () => {
  it('a preset reason code is translated through the supplied labeller', () => {
    const d = buildTeamDossier({
      ...input({ id: 't1', displayName: 'X', scoreLedger: [{ at: 'x', delta: 20, kind: 'adjust', reason: 'reasonHelpfulness' }] }),
      reasonLabel: (r) => (r === 'reasonHelpfulness' ? 'עזרה לקבוצה אחרת' : r),
    })!;
    expect(d.ledger[0].reason).toBe('עזרה לקבוצה אחרת');
  });
  it('free text passes through unchanged when no labeller knows it', () => {
    const d = buildTeamDossier({
      ...input({ id: 't1', displayName: 'X', scoreLedger: [{ at: 'x', delta: 5, kind: 'adjust', reason: 'מצאו את המפתח' }] }),
      reasonLabel: (r) => r,
    })!;
    expect(d.ledger[0].reason).toBe('מצאו את המפתח');
  });
  it('a labeller that throws never breaks the page', () => {
    const d = buildTeamDossier({
      ...input({ id: 't1', displayName: 'X', scoreLedger: [{ at: 'x', delta: 5, kind: 'adjust', reason: 'r' }] }),
      reasonLabel: () => { throw new Error('boom'); },
    })!;
    expect(d.ledger[0].reason).toBe('r');
  });
});

describe('buildTeamDossier: numbers to call (quick-dial-and-actions D3)', () => {
  const phoneFields = [{ id: 'f-phone', label: 'טלפון של הקבוצה' }, { id: 'f-parent', label: 'טלפון הורה' }];
  it('one call target per phone-type registration value, with its field label', () => {
    const d = buildTeamDossier({
      ...input({ id: 't1', displayName: 'X', registrationData: { 'f-phone': '052-1234567', 'f-parent': ['054-1111111', ''], name: '052-9999999' } }),
      phoneFields,
    })!;
    expect(d.callTargets).toEqual([
      { label: 'טלפון של הקבוצה', phone: '052-1234567' },
      { label: 'טלפון הורה', phone: '054-1111111' },
    ]);
  });
  it('a value that is not a phone field is never offered, even if it looks like a number', () => {
    const d = buildTeamDossier({ ...input({ id: 't1', displayName: 'X', registrationData: { name: '052-9999999' } }), phoneFields })!;
    expect(d.callTargets).toEqual([]);
  });
  it('an undialable value is dropped, not linked', () => {
    const d = buildTeamDossier({ ...input({ id: 't1', displayName: 'X', registrationData: { 'f-phone': 'אין' } }), phoneFields })!;
    expect(d.callTargets).toEqual([]);
  });
  it('no phone fields in the game -> no targets, and the page can explain why', () => {
    const d = buildTeamDossier(input({ id: 't1', displayName: 'X', registrationData: { 'f-phone': '052-1234567' } }))!;
    expect(d.callTargets).toEqual([]);
    expect(d.gameAsksForPhone).toBe(false);
  });
});
