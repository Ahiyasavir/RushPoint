// Reconstructing a gallery task as a fresh Task for the Builder.
//
// Extracted from components/TaskLibrary.tsx so it can be tested. It is the THIRD
// place in this app that seeds a task's field defaults — after `blankTask()`
// (lib/wizardLogic.ts) and `TASK_FIELD_DEFAULTS` (lib/taskOptInGroups.ts) — and
// the only one that was never checked against the other two.
//
// That matters because taskOptInGroups.ts's own header records what happens when
// these seeders disagree: a template seeder writing a different capacity from
// blankTask made EVERY template-derived task read as "authored", so the editor
// greeted creators with three or four unfolded sections of settings they had
// never chosen. The two named seeders have been asserted equal ever since. This
// one sat outside that guarantee purely because it lived in a component file.
//
// Pure: no React, no network. scripts/test-task-opt-in-groups.ts asserts it
// agrees with the other two.
import type { PublicTask, Task } from '@rushpoint/shared';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/**
 * Copying a library task brings its APPROXIMATE area, never the author's exact
 * pin (change: task-library-map-view). The copy path was the second door onto the
 * same secret: `coordinates` used to be the exact authored point, so "copy a task"
 * was a way to read it — including for a hidden-location task whose location is
 * the puzzle. A copied mission is being re-sited anyway, and an unplaced one flows
 * through the Builder's normal "needs placement" path.
 */
export function libraryTaskToTask(pt: PublicTask): Task {
  return {
    id: uuid(),
    title: pt.title,
    description: pt.description,
    type: pt.type,
    // `Task.coordinates` is required, so an absent area falls back to the SAME
    // (0,0) placeholder `blankTask()` uses — the Builder's established "not placed
    // yet" value, which its placement validation already rejects.
    coordinates: pt.approxLocation ?? { lat: 0, lng: 0 },
    difficulty: pt.difficulty,
    estimatedMinutes: pt.estimatedMinutes,
    pointValue: pt.pointValue,
    // 1, not 3: a copied task's real capacity is a property of the ORIGINAL
    // creator's venue, which does not travel with the copy. 1 is the safe
    // assumption until the new creator says otherwise — matches
    // TASK_FIELD_DEFAULTS / blankTask() (lib/taskOptInGroups.ts, lib/wizardLogic.ts).
    maxConcurrentTeams: 1,
    tags: pt.tags ?? [],
  };
}
