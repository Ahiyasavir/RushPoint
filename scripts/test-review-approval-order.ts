// A photo approval completes the mission BEFORE it records "approved" (change: review-needs-a-submission).
//
// Found by the 420-phone load test on 2026-10-10: reviewStationSubmission wrote
// `taskSubmissions[taskId].status = 'approved'` and only THEN called completeTaskForTeam. When
// completion refused (a locked task, a stage that is not active yet), the record said approved,
// the stage said assigned, and the team waited forever for a review that had already "happened".
// The e2e suite pins the refusal for a mission with no submission; this pins the ORDER, so any
// future reason completion might refuse also leaves the submission pending and the error visible.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractBody } from './lib/hotPathReads.mjs';

let passed = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { console.error(`  FAIL  ${label}\n        ${(e as Error).message}`); process.exitCode = 1; }
};

/** Where completion happens vs where the approval is recorded, in one function body. */
function order(body: string) {
  return {
    complete: body.indexOf('completeTaskForTeam('),
    record: body.search(/status:\s*approved\s*\?\s*'approved'/),
    refusal: body.search(/no-submission/),
    firstWrite: body.search(/teamRef\.set\(|tx\.update\(teamRef/),
  };
}

const body = extractBody(readFileSync('functions/src/index.ts', 'utf8'), 'reviewStationSubmission');

console.log('\n── an approval completes the mission before it is recorded ──');
t('reviewStationSubmission is found', () => { assert.ok(body, 'reviewStationSubmission not found — renamed?'); });
t('completion runs before the approved status is written', () => {
  const o = order(body ?? '');
  assert.ok(o.complete > 0 && o.record > 0, `markers missing (complete=${o.complete}, record=${o.record})`);
  assert.ok(o.complete < o.record, 'the approved status is written before completeTaskForTeam runs');
});
t('a review with nothing submitted is refused before anything is written', () => {
  const o = order(body ?? '');
  assert.ok(o.refusal > 0, 'no no-submission refusal');
  assert.ok(o.firstWrite > 0 && o.refusal < o.firstWrite, 'the refusal comes after a write');
});

// NEGATIVE CONTROL: the shape this change removed must fail both checks.
t('the guard rejects the pre-change order', () => {
  const before = "await teamRef.set({ taskSubmissions: { [taskId]: { status: approved ? 'approved' : 'rejected' } } });\n"
    + 'if (approved) { const { completed } = await completeTaskForTeam(ownerUid, gameId, runId, teamId, taskId, now); }';
  const o = order(before);
  assert.ok(o.complete > o.record, 'negative control: old order should look wrong');
  assert.ok(o.refusal < 0, 'negative control: old code had no refusal');
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) { console.error('FAILED'); process.exit(1); }
