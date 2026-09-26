// Pure tests for the capture-time upload (change: media-upload-reliability, D1/D4).
//
// WHAT WAS WRONG. A photo, clip or recording started uploading only when the player pressed send,
// so the whole transfer was spent staring at a bar, on the one screen where a player has nothing
// else to do. And audio/video threw the finished upload away when the SUBMIT after it failed, so
// the retry sent every byte again: one 6.7 MB clip reached the VPS five times in 50 s on
// 2026-09-25. Now the upload starts the moment the capture exists, a retake cancels it, and send
// only awaits it.
//
// The second half is a source guard: no submit handler in TaskRunner may call an upload function
// directly, or the old per-kind copies grow back one at a time.
//   npx tsx scripts/test-pending-upload.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPendingUploads } from '../apps/play-web/src/lib/pendingUpload';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

type Call = { blob: Blob; contentType: string; signal: AbortSignal; resolve: (v: string) => void; reject: (e: unknown) => void };

function harness() {
  const calls: Call[] = [];
  let changes = 0;
  const pending = createPendingUploads<string>(
    (blob, contentType, signal) => new Promise<string>((resolve, reject) => {
      calls.push({ blob, contentType, signal, resolve, reject });
    }),
    () => { changes++; },
  );
  return { calls, pending, changes: () => changes };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function main(): Promise<void> {
  // 1. Capture starts the upload; send reuses it.
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    pending.begin('t1', a, 'video/webm');
    check('capture starts exactly one upload', calls.length === 1, String(calls.length));
    check('it is in flight', pending.inFlight('t1'));
    const sent = pending.take('t1', a, 'video/webm');
    check('send does NOT start a second upload for the same capture', calls.length === 1, String(calls.length));
    calls[0].resolve('url-a');
    check('send gets the capture-time upload', (await sent) === 'url-a');
    await tick();
    check('no longer in flight once landed', !pending.inFlight('t1'));
    check('ready once landed', pending.ready('t1', a));
  }

  // 2. A begin for the SAME capture twice is one upload (re-render, remount).
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    pending.begin('t1', a, 'image/jpeg');
    pending.begin('t1', a, 'image/jpeg');
    check('the same capture never uploads twice', calls.length === 1, String(calls.length));
  }

  // 3. Retake aborts the old upload and starts the new one.
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    const b = new Blob(['b']);
    pending.begin('t1', a, 'video/webm');
    pending.begin('t1', b, 'video/webm');
    check('a retake aborts the superseded upload', calls[0].signal.aborted);
    check('a retake starts the new one', calls.length === 2 && calls[1].blob === b);
    check('the new one is not aborted', !calls[1].signal.aborted);
  }

  // 4. Discarding the capture aborts it.
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    pending.begin('t1', a, 'audio/webm');
    pending.forget('t1');
    check('discarding the capture aborts its upload', calls[0].signal.aborted);
    check('nothing in flight after forget', !pending.inFlight('t1'));
  }

  // 5. A failed background upload is not reused: send starts a fresh one.
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    pending.begin('t1', a, 'video/webm');
    calls[0].reject(Object.assign(new Error('x'), { code: 'storage/deadline-exceeded' }));
    await tick();
    const sent = pending.take('t1', a, 'video/webm');
    check('send after a failed background upload tries again', calls.length === 2, String(calls.length));
    calls[1].resolve('url-2');
    check('and gets the fresh url', (await sent) === 'url-2');
  }

  // 6. Send for a DIFFERENT blob than the one uploading (a picked file after a recording).
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    const b = new Blob(['b']);
    pending.begin('t1', a, 'video/webm');
    const sent = pending.take('t1', b, 'video/mp4');
    check('send with another capture aborts the stale upload', calls[0].signal.aborted);
    check('and uploads what is being sent', calls.length === 2 && calls[1].blob === b && calls[1].contentType === 'video/mp4');
    calls[1].resolve('url-b');
    check('send resolves with the right file', (await sent) === 'url-b');
  }

  // 7. Tasks are independent: mission B never gets mission A's upload.
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    pending.begin('A', a, 'image/jpeg');
    const sent = pending.take('B', a, 'image/jpeg');
    check('a second task never shares the first task\'s upload', calls.length === 2);
    check('and does not abort it', !calls[0].signal.aborted);
    calls[1].resolve('b');
    await sent;
  }

  // 8. Changes are announced (the component re-renders its "uploading" line off this).
  {
    const { calls, pending, changes } = harness();
    const a = new Blob(['a']);
    const before = changes();
    pending.begin('t1', a, 'image/jpeg');
    calls[0].resolve('u');
    await tick();
    check('begin and landing both announce a change', changes() - before >= 2, String(changes() - before));
  }

  // 9. A landed upload of a forgotten capture never comes back.
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    pending.begin('t1', a, 'image/jpeg');
    pending.forget('t1');
    calls[0].resolve('late');
    await tick();
    check('a forgotten capture is not "ready" even if its upload lands', !pending.ready('t1', a));
  }

  // background-media-upload D3: handOff gives the in-flight upload away WITHOUT aborting it.
  {
    const { calls, pending } = harness();
    const a = new Blob(['a']);
    pending.begin('t1', a, 'image/jpeg');
    const handed = pending.handOff('t1', a, 'image/jpeg');
    check('handOff returns the upload already in flight (no second transfer)', calls.length === 1);
    check('handOff does not abort the transfer', !calls[0].signal.aborted);
    check('after handOff the task holds nothing', !pending.inFlight('t1'));
    pending.forget('t1');
    check('a later forget cannot abort the handed-off transfer', !calls[0].signal.aborted);
    calls[0].resolve('url-a');
    check('the new owner receives the result', (await handed) === 'url-a');
    const b = new Blob(['b']);
    const fresh = pending.handOff('t2', b, 'image/jpeg');
    check('handOff with nothing in flight starts one', calls.length === 2);
    calls[1].resolve('url-b');
    check('and hands that one over too', (await fresh) === 'url-b' && !pending.inFlight('t2'));
  }

  // ── Source guard (task 1.4) ─────────────────────────────────────────────────
  const src = readFileSync(join(__dirname, '..', 'apps', 'play-web', 'src', 'components', 'TaskRunner.tsx'), 'utf8');
  const direct = src.match(/uploadTask(Photo|Audio|Video)\b/g) ?? [];
  check('TaskRunner calls no per-kind upload function directly', direct.length === 0, direct.join(', '));
  check('TaskRunner uploads through createPendingUploads', /createPendingUploads\s*[<(]/.test(src));
}

void main().then(() => {
  console.log(`\n${failures === 0 ? 'ALL PENDING-UPLOAD TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
});
