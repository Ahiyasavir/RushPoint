// UI text standard guard (change: builder-clarity-mission-hierarchy). A field
// mission — the `Task` object a creator builds and a participant completes — is
// user-facing vocabulary ONLY as "mission" (or its Hebrew equivalent), never
// "task". The Builder said "task" (Add task, Task Name) while Gallery/Run
// Console/the Builder's own stage-delete dialog said "mission" for the identical
// object, so the vocabulary silently flipped mid-flow and creators lost the
// stage/mission mental model.
//
// This is a COPY-only rule. `Task`, `addTask`, `taskId`, `TaskType`, Firestore
// field/collection names, and any other source-level identifier are exempt —
// only rendered user-facing strings are policed.
//
// PART A — translation dictionaries (both apps, both languages). Scans plain
//   string leaves AND function-valued entries (rendered with sample args), same
//   technique as scripts/test-no-dashes.ts.
// PART B — a sanity check that the scan actually reached a meaningful number of
//   leaves, so a future i18n.ts reshuffle that breaks the leaf walk fails loud
//   instead of silently checking nothing.
//
// Suppress a deliberate, non-vocabulary "task" occurrence (there should be none)
// by wrapping the leaf key in TASK_COPY_ALLOWLIST below, mirroring the
// `// i18n-ignore` convention used elsewhere — do NOT loosen the regex instead.
//
//   npx tsx scripts/test-no-task-copy.ts
import { translations as creatorT } from '../apps/creator-web/src/i18n';
import { translations as playT } from '../apps/play-web/src/i18n';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Explicit, reviewable exceptions: `app.lang.dotted.key` -> reason. Empty by
// design — every current "task" usage in either dictionary refers to the field
// mission concept and must be renamed, not allowlisted.
const TASK_COPY_ALLOWLIST = new Set<string>([]);

// Matches "task"/"tasks" as a whole word, case-insensitive (so "Task Name",
// "tasks", "TASKS" all match, but a hypothetical unrelated word containing
// "task" as a substring would not — none exist in these dictionaries today).
const TASK_WORD = /\btasks?\b/i;

const SAMPLE_OBJ = {
  n: 2, count: 2, rank: 3, score: 100, points: 25, minutes: 10,
  dist: 40, radius: 50, r: 50, time: '12:00',
  email: 'a@b.com', name: 'Sample', title: 'Sample', team: 'Sample',
  game: 'Sample', url: 'example.com', rankPart: '', targetLang: 'en',
};
function render(fn: (...a: unknown[]) => unknown): string | null {
  for (const args of [[2, 'Sample', 'Sample', 'Sample'], [SAMPLE_OBJ]] as unknown[][]) {
    try {
      const r = fn(...args);
      if (typeof r === 'string') return r;
    } catch { /* try the next arg shape */ }
  }
  return null;
}

function leafStrings(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (typeof obj === 'function') {
    const r = render(obj as (...a: unknown[]) => unknown);
    if (r === null) {
      console.log(`WARN  could not render function entry "${prefix}" — not task-copy-checked`);
      return [];
    }
    return [[prefix, r]];
  }
  if (obj === null || typeof obj !== 'object') return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...leafStrings(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

let totalLeaves = 0;
for (const [app, t] of [['creator-web', creatorT], ['play-web', playT]] as const) {
  for (const [lang, map] of [['he', t.he], ['en', t.en]] as const) {
    const leaves = leafStrings(map);
    totalLeaves += leaves.length;
    const offenders = leaves.filter(([k, v]) => TASK_WORD.test(v) && !TASK_COPY_ALLOWLIST.has(`${app}.${lang}.${k}`));
    check(`A · ${app}.${lang}: no "task" wording for the mission concept`,
      offenders.length === 0,
      offenders.slice(0, 12).map(([k, v]) => `${k}="${v}"`).join(' | '));
  }
}

check('B · the scan actually reached a meaningful number of dictionary leaves',
  totalLeaves > 200, `${totalLeaves} leaf/leaves`);

console.log(`\n${failures === 0 ? 'ALL NO-TASK-COPY TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
