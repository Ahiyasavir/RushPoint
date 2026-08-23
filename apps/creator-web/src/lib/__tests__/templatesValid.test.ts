// Every quick-start template must produce a LAUNCHABLE game
// (change: template overhaul, 8abd296).
//
// A template is a creator's very first structure — the new-game flow seeds it via
// updateGame, whose server-side `stagesProblems` guard (the SAME shared validators
// asserted here) rejects an unwinnable or malformed game. A template that fails
// that guard is worse than no template: the creator picks it, edits nothing, hits
// Launch and is told their game is broken. This test runs the shared validators on
// every template's freshly built stages so a bad template fails here, in the gate,
// not in a creator's hands.
//
// It is deliberately the SAME validation the server applies on save
// (functions stagesProblems → gameStructureProblems + requiredTaskCountProblem +
// validateUnlockGraph + validateAvailabilityWindow), so "passes this test" means
// "updateGame will accept it".

import { describe, test, expect } from 'vitest';
import {
  gameStructureProblems,
  requiredTaskCountProblem,
  validateUnlockGraph,
  validateAvailabilityWindow,
  maxCompletableTasks,
} from '@rushpoint/shared';
import { TEMPLATES } from '../../templates';

// `blank` is the intentional empty starter — it seeds one placeholder task the
// creator fills in, and is not expected to be launch-ready on its own.
const EMPTY_STARTERS = new Set(['blank']);

describe('quick-start templates', () => {
  test('the template set is non-empty and every key is unique', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    const keys = TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const t of TEMPLATES) {
    describe(`template "${t.key}"`, () => {
      test('build() returns fresh, non-empty stages with fresh ids each call', () => {
        const a = t.build();
        const b = t.build();
        expect(Array.isArray(a)).toBe(true);
        expect(a.length).toBeGreaterThan(0);
        // Fresh ids each call — a template reused twice must not share task ids.
        const idsA = a.flatMap((s) => s.tasks.map((tk) => tk.id));
        const idsB = b.flatMap((s) => s.tasks.map((tk) => tk.id));
        expect(idsA.some((id) => idsB.includes(id))).toBe(false);
      });

      test('every task has an id and a type', () => {
        for (const s of t.build()) {
          for (const tk of s.tasks) {
            expect(tk.id, `${t.key}: a task is missing its id`).toBeTruthy();
            expect(tk.type, `${t.key}: task ${tk.id} is missing its type`).toBeTruthy();
          }
        }
      });

      if (!EMPTY_STARTERS.has(t.key)) {
        test('passes the server save-guard validators (updateGame would accept it)', () => {
          const stages = t.build();

          // Whole-game structural winnability (empty-task stage, uncompletable
          // task, negative pointValue/difficulty/estimatedMinutes, …).
          expect(gameStructureProblems(stages), `${t.key}: structure problems`).toEqual([]);

          for (const s of stages) {
            // requiredTaskCount must be attainable given exclusive groups.
            expect(
              requiredTaskCountProblem(s as never),
              `${t.key}: stage "${s.title}" requiredTaskCount unwinnable`,
            ).toBeNull();
            // requiredTaskCount never exceeds what the stage can yield.
            expect(
              s.requiredTaskCount == null || s.requiredTaskCount <= maxCompletableTasks(s as never),
              `${t.key}: stage "${s.title}" requiredTaskCount > maxCompletableTasks`,
            ).toBe(true);
            // Unlock prerequisite graph is sound (no self/cross/unknown refs, no cycles).
            expect(
              validateUnlockGraph(s).errors,
              `${t.key}: stage "${s.title}" unlock graph`,
            ).toEqual([]);
            // Availability windows are playable (no expiry at/ before release).
            for (const tk of s.tasks) {
              expect(
                validateAvailabilityWindow(tk),
                `${t.key}: task "${tk.title || tk.id}" availability window`,
              ).toBeNull();
            }
            // Every non-starter stage actually has a task to do.
            expect(s.tasks.length, `${t.key}: stage "${s.title}" has no tasks`).toBeGreaterThan(0);
          }

          // Exactly one final stage triggers the Final screen.
          expect(
            stages.filter((s) => s.isFinal).length,
            `${t.key}: must have exactly one isFinal stage`,
          ).toBe(1);
        });
      }
    });
  }
});
