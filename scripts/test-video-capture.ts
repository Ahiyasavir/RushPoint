// Pure-logic test for the play-web video recorder's own decisions
// (change: video-submission-task). The RANGE arithmetic lives in
// packages/shared/src/videoDuration.ts and is covered by test-video-duration.ts;
// this covers only what the widget adds on top.
//
// The load-bearing rule here is FAIL OPEN. Two of these guards run against data the
// client cannot trust — a <video> element's reported duration (absent or Infinity
// for some containers) and a picker File's declared type (empty on some Android
// pickers). A guard that treats "I could not tell" as "refuse" strands a
// participant who did nothing wrong, on a mission they cannot otherwise complete.
//   npx tsx scripts/test-video-capture.ts
import {
  VIDEO_BITS_PER_SECOND,
  AUDIO_BITS_PER_SECOND,
  videoTypeFromName,
  pickedClipVerdict,
  recordedClipVerdict,
  CAPTURE_VIDEO_CONSTRAINTS,
  MAX_PARTICIPANT_VIDEO_BYTES,
  predictedClipBytes,
  CLIP_SHORT_FRACTION,
  CAMERA_OPEN_DEADLINE_MS,
  withCameraDeadline,
  captureProfileFor,
  predictedClipBytesFor,
  WEAK_UPLINK_BPS,
  VERY_WEAK_UPLINK_BPS,
} from '../apps/play-web/src/lib/videoCapture';
import { VIDEO_DURATION_LIMITS } from '../packages/shared/src/videoDuration';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ─── The bitrate is what makes the server's byte cap derivable ────────────────
// MediaRecorder's DEFAULT bitrate is browser-chosen and can be several times this,
// which would put a ceiling-length clip well past MAX_PARTICIPANT_VIDEO_BYTES — the
// player would record for a full minute and only then be refused. Pinning it is
// what turns the cap from a hope into arithmetic.
const MAX_PARTICIPANT_VIDEO_BYTES = 20 * 1024 * 1024;
const worstCaseBytes =
  ((VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND) * VIDEO_DURATION_LIMITS.ceilingSeconds) / 8;
check(
  'a ceiling-length clip at the pinned bitrate fits under the server cap',
  worstCaseBytes < MAX_PARTICIPANT_VIDEO_BYTES,
  `${Math.round(worstCaseBytes / 1024 / 1024)}MB vs ${MAX_PARTICIPANT_VIDEO_BYTES / 1024 / 1024}MB`,
);
check(
  'and it does so with headroom for container overhead, not by a hair',
  worstCaseBytes < MAX_PARTICIPANT_VIDEO_BYTES * 0.85,
  `${Math.round((worstCaseBytes / MAX_PARTICIPANT_VIDEO_BYTES) * 100)}% of the cap`,
);

// ─── videoTypeFromName: only ever produces a type the server accepts ──────────
check('webm → video/webm', videoTypeFromName('clip.webm') === 'video/webm');
check('mp4 → video/mp4', videoTypeFromName('VID_0001.MP4') === 'video/mp4');
check('mov → video/quicktime', videoTypeFromName('IMG_1234.mov') === 'video/quicktime');
check('m4v → video/mp4', videoTypeFromName('movie.m4v') === 'video/mp4');
check('an unknown extension falls back to video/mp4', videoTypeFromName('recording.xyz') === 'video/mp4');
check('no extension at all falls back to video/mp4', videoTypeFromName('recording') === 'video/mp4');
// The fallback must never produce something the server would refuse — that would
// be a dead end WITH EXTRA STEPS: upload succeeds, submission is then rejected.
const ACCEPTED = ['video/webm', 'video/mp4', 'video/quicktime'];
for (const name of ['a.webm', 'a.mp4', 'a.mov', 'a.m4v', 'a.3gp', 'a', 'a.', '.mov', 'A.MOV']) {
  check(`videoTypeFromName(${name}) is server-accepted`, ACCEPTED.includes(videoTypeFromName(name)), videoTypeFromName(name));
}

// ─── pickedClipVerdict: the native-picker minimum check, FAIL OPEN ────────────
// The recorder path enforces the minimum on SUBMIT (recordedClipVerdict below).
// The picker path cannot — the clip already exists — so its duration is read after
// selection instead.
check('a clip comfortably over the minimum is ok', pickedClipVerdict(20, 10) === 'ok');
check('a clip exactly at the minimum is ok', pickedClipVerdict(10, 10) === 'ok');
check('a clip under the minimum is too-short', pickedClipVerdict(4, 10) === 'too-short');
check('no minimum configured accepts anything', pickedClipVerdict(1, 0) === 'ok');

// Unreadable duration ⇒ ALLOW. metadata is genuinely absent for some containers,
// and refusing here punishes the participant for their phone's file format.
for (const d of [undefined, NaN, Infinity, -Infinity, 0, -5, 'twenty' as unknown as number, null as unknown as number]) {
  check(`unreadable duration (${String(d)}) fails OPEN`, pickedClipVerdict(d, 10) === 'ok');
}

let threw = false;
try {
  pickedClipVerdict(undefined, NaN);
  pickedClipVerdict(NaN, Infinity);
  pickedClipVerdict(10, undefined as unknown as number);
} catch { threw = true; }
check('pickedClipVerdict never throws', threw === false);

// ─── recordedClipVerdict: the recorder's own minimum check ───────────────
// This one may be strict — the widget counted the seconds itself — but it exists
// ONLY to gate the SUBMIT button. The stop button must never consult it: gating
// stop is what trapped a player inside a recording they were not allowed to end
// (the grey, unpressable "stop" bug).
check('a take over the minimum is ok', recordedClipVerdict(12, 10) === 'ok');
check('a take exactly at the minimum is ok', recordedClipVerdict(10, 10) === 'ok');
check('a take a tick under the minimum is ok (tick/container slack)', recordedClipVerdict(9.6, 10) === 'ok');
check('a take clearly under the minimum is too-short', recordedClipVerdict(3, 10) === 'too-short');
check('no minimum configured accepts a 1-second take', recordedClipVerdict(1, 0) === 'ok');
for (const e of [undefined, NaN, Infinity, -1, 'ten' as unknown as number, null as unknown as number]) {
  check(`unmeasurable elapsed (${String(e)}) fails OPEN`, recordedClipVerdict(e, 10) === 'ok');
}
for (const m of [undefined as unknown as number, NaN, -5, 0]) {
  check(`a garbage minimum (${String(m)}) gates nothing`, recordedClipVerdict(1, m) === 'ok');
}
let recThrew = false;
try {
  recordedClipVerdict(undefined, NaN);
  recordedClipVerdict(NaN, Infinity);
  recordedClipVerdict(10, undefined as unknown as number);
} catch { recThrew = true; }
check('recordedClipVerdict never throws', recThrew === false);

// ── The capture PROFILE (change: video-capture-profile) ──────────────────────
//
// The recorder used to pin the bitrate and say NOTHING about resolution, so the
// browser captured at the camera's own default - 1080p on essentially every modern
// phone - and then encoded that at a fixed 2 Mbps. The worst of both worlds: the bit
// budget was spread across four times the pixels of 720p, so the clip looked blocky at
// exactly the bitrate that would have looked clean on a smaller frame; software
// encoding 1080p cooked the phone and dropped frames; and the file was large anyway,
// because size is bitrate times duration however the bits were spent.
{
  const c = CAPTURE_VIDEO_CONSTRAINTS;
  check('the recorder asks for a bounded width', typeof c.width === 'object' && c.width !== null);
  check('the recorder asks for a bounded height', typeof c.height === 'object' && c.height !== null);
  check('the recorder asks for a frame rate', typeof c.frameRate === 'object' && c.frameRate !== null);

  // `ideal`, NEVER `exact`. An exact constraint the camera cannot meet throws
  // OverconstrainedError and the player gets no camera at all - a harder failure than
  // the one being fixed. The whole profile must be a preference.
  const ALL = JSON.stringify(c);
  check('no constraint is expressed as `exact` (that would refuse a camera)',
    !ALL.includes('"exact"'), ALL);
  check('every constraint is expressed as `ideal`', ALL.includes('"ideal"'), ALL);
  check('the rear camera preference survived', JSON.stringify(c.facingMode).includes('environment'));

  // 720p class: big enough to read a sign in a field clip, small enough that a phone
  // can encode it in real time and that the pinned bitrate looks clean on it.
  const w = (c.width as { ideal?: number }).ideal ?? 0;
  const h = (c.height as { ideal?: number }).ideal ?? 0;
  check(`the preferred frame is 720p class :: ${w}x${h}`, w === 1280 && h === 720);
  const fps = (c.frameRate as { ideal?: number }).ideal ?? 0;
  check(`the preferred frame rate is normal, not cinematic :: ${fps}`, fps === 30);
}

// ── The size ceiling stays DERIVABLE, and is asserted rather than commented ──
//
// The old module carried the arithmetic in a comment: "(2_000_000 + 96_000) x 60 / 8
// = 15.7MB against a 20MB cap". A comment cannot fail. This can.
{
  const ceiling = VIDEO_DURATION_LIMITS.ceilingSeconds;
  const worst = predictedClipBytes(ceiling);
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)}MB`;
  check(`a ceiling-length clip fits under the upload cap :: ${mb(worst)} of ${mb(MAX_PARTICIPANT_VIDEO_BYTES)}`,
    worst < MAX_PARTICIPANT_VIDEO_BYTES);
  // Headroom must not shrink. The previous budget produced ~15.7MB at the ceiling;
  // this change must be no worse, or it has traded one refusal for another.
  const PREVIOUS_CEILING_BYTES = (2_000_000 + 96_000) * 60 / 8;
  check(`headroom is not reduced :: ${mb(worst)} vs the previous ${mb(PREVIOUS_CEILING_BYTES)}`,
    worst <= PREVIOUS_CEILING_BYTES);
  check('and it is genuinely smaller, which is the point', worst < PREVIOUS_CEILING_BYTES);

  check('the default max length is comfortably under the cap',
    predictedClipBytes(VIDEO_DURATION_LIMITS.defaultMaxSeconds) < MAX_PARTICIPANT_VIDEO_BYTES);
  check('the client cap mirrors the server cap', MAX_PARTICIPANT_VIDEO_BYTES === 20 * 1024 * 1024);

  // Total: this feeds a size estimate, never a hard refusal.
  for (const bad of [undefined, NaN, Infinity, -5, 'x']) {
    const v = predictedClipBytes(bad as unknown as number);
    check(`predictedClipBytes(${String(bad)}) is a finite non-negative number :: ${v}`,
      Number.isFinite(v) && v >= 0);
  }
  check('a zero-length clip predicts zero bytes', predictedClipBytes(0) === 0);
  check('prediction grows with duration', predictedClipBytes(60) > predictedClipBytes(30));
}


// ── A near-miss must not be a wall (change: clip-length-is-guidance) ──────────
//
// The minimum used to BLOCK, so a clip a second under it could not be sent and the
// only way forward was to re-record the whole thing from zero. Reported from the
// field in exactly those words. Nothing downstream reads seconds - the server bounds
// bytes - so the minimum is guidance, and it now warns down to half and blocks only
// below that.
{
  console.log('');
  console.log('- a clip under the minimum warns, and only a FAR miss blocks -');
  const MIN = 20;
  const cases: [number, string][] = [
    [25, 'ok'],          // over
    [20, 'ok'],          // exactly at
    [19.6, 'ok'],        // inside the half-second slack
    [19, 'short'],       // a hair under - used to be BLOCKED
    [15, 'short'],
    [10, 'short'],       // exactly half
    [9.5, 'short'],      // the true boundary: the half-second slack reaches 10.0
    [9.4, 'too-short'],  // and just below it, the slack no longer reaches
    [8, 'too-short'],    // genuinely not the thing that was asked for
    [1, 'too-short'],
  ];
  for (const [sec, want] of cases) {
    check(`${sec}s against a ${MIN}s minimum`, recordedClipVerdict(sec, MIN) === want, String(recordedClipVerdict(sec, MIN)));
    check(`${sec}s picked against a ${MIN}s minimum`, pickedClipVerdict(sec, MIN) === want, String(pickedClipVerdict(sec, MIN)));
  }
  check('the documented fraction is a half', CLIP_SHORT_FRACTION === 0.5, String(CLIP_SHORT_FRACTION));

  // The fail-open contract is unchanged: garbage is never evidence of a short clip.
  for (const junk of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    check(`a ${String(junk)} duration still reads ok`, pickedClipVerdict(junk as number, MIN) === 'ok', String(pickedClipVerdict(junk as number, MIN)));
  }
  // No minimum at all ⇒ every clip is fine.
  check('no minimum accepts a one second clip', recordedClipVerdict(1, 0) === 'ok');
}

// ── Camera deadline + weak-link profile (change: media-upload-reliability, D5/D9) ──
// A getUserMedia that never answers left the player on "opening the camera" forever, with the
// fallback (the native camera input) unreachable because the widget was still "opening".
check('CAMERA_OPEN_DEADLINE_MS exists and is under 15 s',
  typeof CAMERA_OPEN_DEADLINE_MS === 'number' && CAMERA_OPEN_DEADLINE_MS > 0 && CAMERA_OPEN_DEADLINE_MS < 15_000,
  String(CAMERA_OPEN_DEADLINE_MS));

// A default profile on an unknown connection (iOS has no navigator.connection at all).
{
  const d = captureProfileFor(undefined);
  check('no connection API means the default profile', !d.light && d.videoBitsPerSecond === VIDEO_BITS_PER_SECOND, JSON.stringify(d));
  check('the default profile keeps the 720p constraints', d.video.width.ideal === 1280 && d.video.height.ideal === 720);
  check('4g means default', !captureProfileFor({ effectiveType: '4g' }).light);
  check('garbage connection means default', !captureProfileFor({ effectiveType: 42 as unknown as string }).light);
  // Owner decision (video-upload-speed task 0.2): quality drops ONLY on a weak network, in two
  // tiers. 3g is still usable at 540p; 2g needs 360p or the upload is the whole wait.
  for (const effectiveType of ['3g']) {
    const p = captureProfileFor({ effectiveType });
    check(`${effectiveType} means the 540p light profile`, p.light && p.tier === 'light' && p.videoBitsPerSecond === 1_000_000
      && p.video.width.ideal === 960 && p.video.height.ideal === 540 && p.audioBitsPerSecond === 48_000, JSON.stringify(p));
  }
  for (const effectiveType of ['slow-2g', '2g']) {
    const p = captureProfileFor({ effectiveType });
    check(`${effectiveType} means the 360p lighter profile`, p.light && p.tier === 'lighter' && p.videoBitsPerSecond === 600_000
      && p.video.width.ideal === 640 && p.video.height.ideal === 360 && p.audioBitsPerSecond === 48_000, JSON.stringify(p));
  }
  check('saveData means the light profile', captureProfileFor({ saveData: true, effectiveType: '4g' }).light);
  const light = captureProfileFor({ effectiveType: '3g' });
  check('the light profile never uses exact constraints', !JSON.stringify(light.video).includes('exact'));
  check('the light profile keeps the rear camera', light.video.facingMode.ideal === 'environment');
  const bytes = (light.videoBitsPerSecond + light.audioBitsPerSecond) * VIDEO_DURATION_LIMITS.ceilingSeconds / 8;
  check('a ceiling-length light clip fits under the upload cap', bytes < MAX_PARTICIPANT_VIDEO_BYTES, String(bytes));
}

// ── video-upload-speed D1 + task 0.2: "only on a weak network" ───────────────
{
  const d = captureProfileFor(undefined);
  check('good connection keeps the 720p picture at 1.5 Mbps', d.tier === 'default' && d.videoBitsPerSecond === 1_500_000
    && d.video.width.ideal === 1280, JSON.stringify(d));
  check('default audio is 64 kbps (speech needs no more; design D1)', d.audioBitsPerSecond === 64_000 && AUDIO_BITS_PER_SECOND === 64_000);

  // iPhones have no navigator.connection, so this phone's OWN measured uplink is their only signal.
  check('thresholds are ordered', VERY_WEAK_UPLINK_BPS > 0 && VERY_WEAK_UPLINK_BPS < WEAK_UPLINK_BPS);
  check('a measured slow uplink drops to 540p', captureProfileFor(undefined, WEAK_UPLINK_BPS - 1).tier === 'light');
  check('a measured very slow uplink drops to 360p', captureProfileFor(undefined, VERY_WEAK_UPLINK_BPS - 1).tier === 'lighter');
  check('a measured fast uplink keeps 720p', captureProfileFor(undefined, WEAK_UPLINK_BPS * 4).tier === 'default');
  check('a fresh measured sample beats a download-side 3g hint (it measures the right direction)',
    captureProfileFor({ effectiveType: '3g' }, WEAK_UPLINK_BPS * 4).tier === 'default');
  check('saveData always means light, whatever was measured (the player asked)',
    captureProfileFor({ saveData: true }, WEAK_UPLINK_BPS * 4).light);
  for (const bad of [NaN, -1, 0, Infinity, 'x', null]) {
    check(`garbage measured uplink (${String(bad)}) falls back to the hints`,
      captureProfileFor(undefined, bad as unknown as number).tier === 'default');
  }

  // Byte prediction follows the profile actually recording.
  const lighter = captureProfileFor({ effectiveType: '2g' });
  check('predictedClipBytesFor uses the given profile', predictedClipBytesFor(40, lighter) === (600_000 + 48_000) * 40 / 8);
  check('predictedClipBytes stays the default-profile wrapper', predictedClipBytes(40) === predictedClipBytesFor(40, d));
  check('predictedClipBytesFor is total', predictedClipBytesFor(NaN, d) === 0 && predictedClipBytesFor(10, null as never) === predictedClipBytes(10));
  for (const p of [d, captureProfileFor({ effectiveType: '3g' }), lighter]) {
    check(`a ceiling ${p.tier} clip fits under the cap`, predictedClipBytesFor(VIDEO_DURATION_LIMITS.ceilingSeconds, p) < MAX_PARTICIPANT_VIDEO_BYTES);
    check(`${p.tier} profile has no exact constraint`, !JSON.stringify(p.video).includes('exact'));
  }
}

async function deadlineCases(): Promise<void> {
  type FakeStream = { stopped: boolean };
  // Answers in time: the stream comes back, nothing is stopped.
  {
    const s: FakeStream = { stopped: false };
    const got = await withCameraDeadline(Promise.resolve(s), 50, (x) => { x.stopped = true; });
    check('an answer in time returns the stream', got === s && !s.stopped);
  }
  // Never answers in time: rejects with camera/timeout; the LATE stream is stopped when it lands.
  {
    const s: FakeStream = { stopped: false };
    let code = '';
    const late = new Promise<FakeStream>((r) => setTimeout(() => r(s), 60));
    try { await withCameraDeadline(late, 10, (x) => { x.stopped = true; }); }
    catch (e) { code = String((e as { code?: string }).code); }
    check('a camera that never answers rejects with camera/timeout', code === 'camera/timeout', code);
    await new Promise((r) => setTimeout(r, 80));
    check('a stream arriving after the deadline is stopped (the light goes off)', s.stopped);
  }
  // A real refusal before the deadline keeps its own error.
  {
    let name = '';
    const refused = Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    try { await withCameraDeadline(refused, 50, () => {}); } catch (e) { name = (e as Error).name; }
    check('a refusal before the deadline keeps its own error', name === 'NotAllowedError', name);
  }
}
void deadlineCases().then(() => {
  console.log(`\n${failures === 0 ? 'ALL VIDEO-CAPTURE TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
});
