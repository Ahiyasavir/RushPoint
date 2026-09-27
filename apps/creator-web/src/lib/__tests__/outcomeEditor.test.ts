// answer-scored-question D5: the Builder's "several codes" / "points by answer" edits.
import { describe, it, expect } from 'vitest';
import { enableOutcomes, disableOutcomes, setOutcome, addOutcome, removeOutcome, setRevealPoints } from '../outcomeEditor';
import type { Task } from '@rushpoint/shared';

const station = { id: 's', title: 'Spice', type: 'smart_station', pointValue: 30,
  smart: { enabled: true, verificationType: 'code_verification', secretCode: 'זעתר' } } as unknown as Task;
const quiz = { id: 'q', title: 'Capital', type: 'quiz', pointValue: 40, answers: ['ירושלים'] } as unknown as Task;

describe('enableOutcomes', () => {
  it('a station keeps its code as the first row, worth the mission points, plus an empty row', () => {
    const t = enableOutcomes(station);
    expect(t.answerOutcomes).toEqual([
      { id: 'o1', label: 'זעתר', accepts: ['זעתר'], points: 30 },
      { id: 'o2', label: '', accepts: [''], points: 0 },
    ]);
    expect(t.smart?.secretCode).toBeUndefined(); // ABSENT, not '' or null
    expect('secretCode' in (t.smart ?? {})).toBe(false);
  });
  it('a quiz turns its accepted answers into the first row and drops `answers`', () => {
    const t = enableOutcomes(quiz);
    expect(t.answerOutcomes?.[0]).toEqual({ id: 'o1', label: 'ירושלים', accepts: ['ירושלים'], points: 40 });
    expect('answers' in t).toBe(false);
  });
  it('is idempotent on a task already in the mode', () => {
    const once = enableOutcomes(station);
    expect(enableOutcomes(once)).toEqual(once);
  });
});

describe('disableOutcomes', () => {
  it('a station goes back to ONE code: the first non-empty row', () => {
    const t = disableOutcomes(enableOutcomes(station));
    expect(t.smart?.secretCode).toBe('זעתר');
    expect('answerOutcomes' in t).toBe(false);
    expect('unmatchedPoints' in t).toBe(false);
  });
  it('a quiz gets every row\'s text back as accepted answers', () => {
    const on = setOutcome(addOutcome(enableOutcomes(quiz)), 1, { text: 'תל אביב', points: 20 });
    const t = disableOutcomes(on);
    expect(t.answers).toEqual(['ירושלים', 'תל אביב']);
  });
});

describe('row edits', () => {
  it('setting the text sets both the label and what it accepts', () => {
    const t = setOutcome(enableOutcomes(station), 1, { text: 'מרווה', points: 100 });
    expect(t.answerOutcomes?.[1]).toEqual({ id: 'o2', label: 'מרווה', accepts: ['מרווה'], points: 100 });
  });
  it('points are clamped to a whole number >= 0; garbage becomes 0', () => {
    const t = setOutcome(enableOutcomes(station), 0, { points: -5 });
    expect(t.answerOutcomes?.[0].points).toBe(0);
    expect(setOutcome(enableOutcomes(station), 0, { points: 12.7 }).answerOutcomes?.[0].points).toBe(12);
    expect(setOutcome(enableOutcomes(station), 0, { points: NaN }).answerOutcomes?.[0].points).toBe(0);
  });
  it('new rows get a fresh id even after a removal (ids are never reused)', () => {
    let t = addOutcome(enableOutcomes(station)); // o1 o2 o3
    t = removeOutcome(t, 1);                     // o1 o3
    t = addOutcome(t);
    expect(t.answerOutcomes?.map((o) => o.id)).toEqual(['o1', 'o3', 'o4']);
  });
  it('never drops below two rows (a single outcome is just a normal question)', () => {
    const t = removeOutcome(enableOutcomes(station), 0);
    expect(t.answerOutcomes?.length).toBe(2);
  });
  it('never exceeds ten rows', () => {
    let t = enableOutcomes(station);
    for (let i = 0; i < 20; i++) t = addOutcome(t);
    expect(t.answerOutcomes?.length).toBe(10);
  });
});

describe('setRevealPoints (D4: show players what each answer is worth)', () => {
  it('on sets true; off REMOVES the key (never false/null on the wire)', () => {
    const on = setRevealPoints(enableOutcomes(quiz), true);
    expect(on.revealOutcomePoints).toBe(true);
    const off = setRevealPoints(on, false);
    expect('revealOutcomePoints' in off).toBe(false);
  });
  it('turning outcomes off also drops the reveal flag', () => {
    const t = disableOutcomes(setRevealPoints(enableOutcomes(quiz), true));
    expect('revealOutcomePoints' in t).toBe(false);
  });
});
