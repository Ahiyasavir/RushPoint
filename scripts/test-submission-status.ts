// One truthful status per media mission (change: submission-status-truth)
//
// Reproduced 2026-09-25 in the running app: after a successful send the screen showed "waiting
// for approval" AND a progress bar "מתחיל להעלות…" AND a button stuck on "עובד…"; after an
// organizer rejection "retake" stayed disabled under a card that said "try again"; after a reload
// the pending submission vanished and players re-sent it (production: one 6.7 MB clip uploaded 5
// times in 50 s).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { submissionPhase, pickSubmissionRecord, type SubmissionLocal } from '../apps/play-web/src/lib/submissionStatus';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function kind(label: string, actual: { kind: string }, want: string): void {
  ok(`${label} → ${want}`, actual.kind === want, JSON.stringify(actual));
}

const idle: SubmissionLocal = { preparing: false, uploading: false, uploadPct: null, retrying: false, saving: false, failed: null };
const at = (o: Partial<SubmissionLocal>): SubmissionLocal => ({ ...idle, ...o });

console.log('\n— local in-flight phases win: they describe something happening now —');
kind('preparing', submissionPhase({ local: at({ preparing: true }), server: null }), 'preparing');
kind('uploading 40%', submissionPhase({ local: at({ uploading: true, uploadPct: 40 }), server: null }), 'uploading');
const up = submissionPhase({ local: at({ uploading: true, uploadPct: 40 }), server: null });
ok('uploading carries the real percentage', up.kind === 'uploading' && up.pct === 40, JSON.stringify(up));
kind('retrying', submissionPhase({ local: at({ uploading: true, retrying: true }), server: null }), 'retrying');
kind('saving', submissionPhase({ local: at({ saving: true }), server: null }), 'saving');
kind('saving beats a stale rejection (re-send in flight)',
  submissionPhase({ local: at({ saving: true }), server: { status: 'rejected', reviewNote: 'no' } }), 'saving');
kind('uploading beats a pending record (replacing it)',
  submissionPhase({ local: at({ uploading: true }), server: { status: 'pending' } }), 'uploading');

console.log('\n— then the SERVER record, which survives a reload —');
const w = submissionPhase({ local: idle, server: { status: 'pending', submittedAt: '2026-09-25T10:02:00.000Z', photoUrl: 'https://x/y.jpg' } });
kind('pending', w, 'waitingForApproval');
ok('waiting carries sent time and media url',
  w.kind === 'waitingForApproval' && w.sentAtMs === Date.parse('2026-09-25T10:02:00.000Z') && w.mediaUrl === 'https://x/y.jpg', JSON.stringify(w));
kind('approved', submissionPhase({ local: idle, server: { status: 'approved' } }), 'approved');
const r = submissionPhase({ local: idle, server: { status: 'rejected', reviewNote: '  לא רואים את כל הקבוצה ' } });
kind('rejected', r, 'rejected');
ok('rejected carries the trimmed note', r.kind === 'rejected' && r.note === 'לא רואים את כל הקבוצה', JSON.stringify(r));

console.log('\n— a local failure, then idle —');
kind('failed with no server record', submissionPhase({ local: at({ failed: 'network' }), server: null }), 'failed');
kind('a failed re-send does not hide a pending record', submissionPhase({ local: at({ failed: 'network' }), server: { status: 'pending' } }), 'waitingForApproval');
kind('nothing at all', submissionPhase({ local: idle, server: null }), 'idle');

console.log('\n— total on garbage —');
for (const [label, server] of [
  ['status is a number', { status: 7 }],
  ['status is unknown', { status: 'weird' }],
  ['server is an array', []],
  ['server is a string', 'pending'],
] as [string, unknown][]) {
  let res: { kind: string } | null = null;
  try { res = submissionPhase({ local: idle, server: server as never }); } catch (e) { res = null; }
  ok(`${label}: no throw, calm reading`, !!res && res.kind === 'idle', JSON.stringify(res));
}
const bad = submissionPhase({ local: idle, server: { status: 'pending', submittedAt: 'not a date', photoUrl: 5 as never } });
ok('unparsable submittedAt ⇒ sentAtMs null, non-string url ⇒ null',
  bad.kind === 'waitingForApproval' && bad.sentAtMs === null && bad.mediaUrl === null, JSON.stringify(bad));
const badNote = submissionPhase({ local: idle, server: { status: 'rejected', reviewNote: { x: 1 } as never } });
ok('non-string note ⇒ empty note', badNote.kind === 'rejected' && badNote.note === '', JSON.stringify(badNote));

console.log('\n— the optimistic record bridges the gap until the team snapshot arrives —');
const optimistic = { status: 'pending', submittedAt: '2026-09-25T10:05:00.000Z', photoUrl: 'https://x/new.jpg' };
ok('no server record yet ⇒ the optimistic one (no double-send window)',
  pickSubmissionRecord(undefined, optimistic) === optimistic);
ok('a STALE server record for an older file ⇒ still the optimistic one',
  pickSubmissionRecord({ status: 'rejected', photoUrl: 'https://x/old.jpg' }, optimistic) === optimistic);
const sameFileRejected = { status: 'rejected', photoUrl: 'https://x/new.jpg', reviewNote: 'no' };
ok('the server record for the SAME file wins, so a rejection of it shows at once',
  pickSubmissionRecord(sameFileRejected, optimistic) === sameFileRejected);
const serverOnly = { status: 'pending', photoUrl: 'https://x/a.jpg' };
ok('no optimistic record ⇒ the server one', pickSubmissionRecord(serverOnly, null) === serverOnly);
ok('neither ⇒ null', pickSubmissionRecord(undefined, null) === null);

console.log('\n— source guards: the fake bar and the latch are gone —');
const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'apps/play-web/src/components/TaskRunner.tsx'), 'utf8').replace(/\r/g, '');
ok('UploadProgress no longer takes a busy prop', !/function UploadProgress\(\{\s*busy/.test(runner));
ok('no <UploadProgress busy=…> call site remains', !/<UploadProgress[^>]*busy=/.test(runner));
ok('frozen no longer folds in the sentFor latch', !/const frozen = [^;]*sentFor/.test(runner));
ok('TaskRunner derives the phase from the server record', /submissionPhase\(/.test(runner));

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);
