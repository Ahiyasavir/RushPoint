// The upload ETA the player sees (change: video-upload-speed, design D5).
//
// Field ask: "the player should know roughly how long the clip will take to upload, from the
// clip's length with some account of the connection." Pure, total, clock injected.
//   npx tsx scripts/test-upload-eta.ts
import {
  uplinkPrior, meterStart, meterUpdate, estimateUploadEta, etaLabel, predictedUploadBytes,
  sampleFromMeter, readUplinkSample, writeUplinkSample, UPLINK_STORAGE_KEY,
  DEFAULT_UPLINK_BPS, RECENT_SAMPLE_MAX_AGE_MS, MIN_SAMPLE_BYTES, WARMUP_BYTES, WARMUP_MS,
  STALL_SHOW_MS, ETA_CAP_SECONDS, FINALIZE_SECONDS, BITRATE_OVERSHOOT,
  shouldPublishEta, ETA_PUBLISH_EVERY_MS,
  type EtaLabel, type MeterState, type UploadEta,
} from '../apps/play-web/src/lib/uploadEta';
import { captureProfileFor } from '../apps/play-web/src/lib/videoCapture';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const finite = (e: UploadEta) => [e.lowSeconds, e.highSeconds, e.midSeconds].every((n) => Number.isFinite(n) && n >= 0);

// ── Prior: our own recent upload > the browser's hint > a pessimistic default ──
{
  const now = 10_000_000;
  const d = uplinkPrior({ nowMs: now });
  check('no information at all -> default (every iPhone starts here)', d.basis === 'default' && d.bytesPerSecond === DEFAULT_UPLINK_BPS);
  const recent = { bytesPerSecond: 400_000, atMs: now - 60_000, bytes: 2_000_000 };
  const r = uplinkPrior({ nowMs: now, recent, connection: { effectiveType: '2g' } });
  check('a fresh sample of our own uplink wins over the hint', r.basis === 'recent' && r.bytesPerSecond === 400_000);
  check('a stale sample is ignored', uplinkPrior({ nowMs: now, recent: { ...recent, atMs: now - RECENT_SAMPLE_MAX_AGE_MS - 1 } }).basis === 'default');
  check('a sample from a tiny upload is ignored', uplinkPrior({ nowMs: now, recent: { ...recent, bytes: MIN_SAMPLE_BYTES - 1 } }).basis === 'default');
  check('a sample from the future is ignored', uplinkPrior({ nowMs: now, recent: { ...recent, atMs: now + 60_000 } }).basis === 'default');
  const h3 = uplinkPrior({ nowMs: now, connection: { effectiveType: '3g' } });
  check('3g hint -> 50 KB/s', h3.basis === 'network-hint' && h3.bytesPerSecond === 50_000);
  check('2g hint -> 8 KB/s', uplinkPrior({ nowMs: now, connection: { effectiveType: '2g' } }).bytesPerSecond === 8_000);
  check('saveData -> the 3g row', uplinkPrior({ nowMs: now, connection: { saveData: true, effectiveType: '4g', downlink: 10 } }).bytesPerSecond === 50_000);
  const h4 = uplinkPrior({ nowMs: now, connection: { effectiveType: '4g', downlink: 10 } });
  check('4g uses 30% of downlink (10 Mbps -> 375 KB/s)', h4.bytesPerSecond === 375_000, String(h4.bytesPerSecond));
  check('4g downlink is capped at Chrome\'s 10 Mbps', uplinkPrior({ nowMs: now, connection: { effectiveType: '4g', downlink: 50 } }).bytesPerSecond === 375_000);
  check('4g with a tiny downlink is floored', uplinkPrior({ nowMs: now, connection: { effectiveType: '4g', downlink: 0.1 } }).bytesPerSecond === 60_000);
  check('4g with no downlink -> default', uplinkPrior({ nowMs: now, connection: { effectiveType: '4g' } }).basis === 'default');
  for (const bad of [null, 42, { effectiveType: 7 }, { downlink: 'x' }]) {
    const p = uplinkPrior({ nowMs: now, connection: bad as never, recent: { bytesPerSecond: NaN, atMs: now, bytes: 1e6 } as never });
    check(`garbage prior input degrades to default :: ${JSON.stringify(bad)}`, p.basis === 'default' && Number.isFinite(p.bytesPerSecond));
  }
  check('spreads narrow with better evidence', r.spread < h3.spread && h3.spread < d.spread);
}

// ── Meter: warm-up discard, time-based EWMA, restart on a new attempt ──────────
{
  let m: MeterState = meterStart(0);
  m = meterUpdate(m, 60_000, 50); // the socket-buffer burst
  check('the first burst is not a measurement', !m.warmedUp && m.ewmaBps === null);
  m = meterUpdate(m, WARMUP_BYTES + 1, 500);
  check('bytes alone do not end warm-up', !m.warmedUp, JSON.stringify(m));
  m = meterUpdate(m, 300_000, WARMUP_MS);
  check('bytes AND time end warm-up', m.warmedUp && m.firstWarmAtMs === WARMUP_MS);
  m = meterUpdate(m, 400_000, WARMUP_MS + 1000); // 100 KB/s
  check('the first real sample seeds the EWMA', m.ewmaBps !== null && near(m.ewmaBps, 100_000, 1));
  m = meterUpdate(m, 1_000_000, WARMUP_MS + 1000 + 3000); // 200 KB/s over exactly one half-life
  check('one half-life moves the EWMA halfway', m.ewmaBps !== null && near(m.ewmaBps, 150_000, 1), String(m.ewmaBps));
  const lastProgress = m.lastProgressAtMs;
  const same = meterUpdate(m, 1_000_000, WARMUP_MS + 9000);
  check('no new bytes does not count as progress', same.lastProgressAtMs === lastProgress);
  const back = meterUpdate(m, 10_000, 20_000);
  check('loaded going backwards (a retry) restarts the meter', !back.warmedUp && back.ewmaBps === null && back.lastLoaded === 10_000);
  const junk = meterUpdate(m, NaN, 30_000);
  check('a garbage loaded value leaves the meter alone', junk.ewmaBps === m.ewmaBps);
}

// ── Estimate: the worked example, bounds, narrowing, states, cap ───────────────
{
  const profile = captureProfileFor(undefined);
  const total = predictedUploadBytes(40, profile);
  check('predicted upload bytes include the overshoot margin', near(total, (1_500_000 + 64_000) * 40 / 8 * BITRATE_OVERSHOOT, 1));
  const prior = uplinkPrior({ nowMs: 0 });
  const e0 = estimateUploadEta({ totalBytes: total, sentBytes: 0, meter: null, prior, nowMs: 0 });
  const mid = total / DEFAULT_UPLINK_BPS + FINALIZE_SECONDS;
  check('worked example: iPhone, 40 s 720p clip, no evidence', near(e0.midSeconds, mid, 1), `${e0.midSeconds} vs ${mid}`);
  check('default spread 2.5 at the start', near(e0.lowSeconds, mid / 2.5, 1) && near(e0.highSeconds, mid * 2.5, 1));
  check('state is estimating, basis default', e0.state === 'estimating' && e0.basis === 'default');
  const L0 = etaLabel(e0);
  check('a wide band is shown as a minutes range, rounded outward', L0.kind === 'range' && L0.lowMinutes === 1 && L0.highMinutes === 3, JSON.stringify(L0));

  // Measured: 4 s after warm-up at 600 KB/s.
  let m = meterStart(0);
  m = meterUpdate(m, 200_000, 1000);
  m = meterUpdate(m, 2_600_000, 5000);
  const e1 = estimateUploadEta({ totalBytes: total, sentBytes: 2_600_000, meter: m, prior, nowMs: 5000 });
  check('measured throughput takes over', e1.basis === 'measured');
  const w = 4000 / 6000;
  const bps = 1 / (w / 600_000 + (1 - w) / DEFAULT_UPLINK_BPS);
  check('harmonic blend (one fast burst cannot make it optimistic)', near(e1.midSeconds, (total - 2_600_000) / bps + 2, 1), `${e1.midSeconds}`);
  check('the band narrowed with progress and evidence', e1.highSeconds / e1.lowSeconds < e0.highSeconds / e0.lowSeconds);
  check('low <= high always', e1.lowSeconds <= e1.highSeconds);

  const stalled = estimateUploadEta({ totalBytes: total, sentBytes: 2_600_000, meter: m, prior, nowMs: 5000 + STALL_SHOW_MS });
  check('no progress for 5 s -> stalled (no number dressed as a measurement)', stalled.state === 'stalled' && etaLabel(stalled).kind === 'stalled');
  const almost = estimateUploadEta({ totalBytes: 1_000_000, sentBytes: 975_000, meter: null, prior, nowMs: 0 });
  check('97% -> almost done', almost.state === 'almost-done' && etaLabel(almost).kind === 'almost-done');
  const huge = estimateUploadEta({ totalBytes: 1e12, sentBytes: 0, meter: null, prior, nowMs: 0 });
  check('capped at 15 minutes', huge.highSeconds <= ETA_CAP_SECONDS && huge.midSeconds <= ETA_CAP_SECONDS);
  const none = estimateUploadEta({ totalBytes: 0, sentBytes: 0, meter: null, prior, nowMs: 0 });
  check('nothing to send -> a few seconds', etaLabel(none).kind === 'seconds');

  // Seeded fuzz: never NaN, never Infinity, low <= high.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    let fm: MeterState | null = rnd() < 0.3 ? null : meterStart(pick([0, NaN, -5, 1000]));
    let t = 0;
    for (let k = 0; fm && k < 6; k++) { t += pick([0, 10, 700, 3000, NaN]); fm = meterUpdate(fm, pick([0, 1e5, 5e5, 2e6, -1, NaN, Infinity]), t); }
    const e = estimateUploadEta({
      totalBytes: pick([0, -1, NaN, Infinity, 1e6, 8e6, 2e7]),
      sentBytes: pick([0, -1, NaN, 5e5, 9e6, Infinity]),
      meter: fm,
      prior: pick([prior, { bytesPerSecond: NaN, basis: 'recent', spread: 1.6 }, { bytesPerSecond: 0, basis: 'default', spread: NaN }, null as never]),
      nowMs: pick([0, t, t + 10_000, NaN]),
    });
    if (!finite(e) || e.lowSeconds > e.highSeconds) bad++;
    const lab = etaLabel(e, pick([null, { kind: 'about', seconds: 30 } as EtaLabel]));
    if (!lab || typeof lab.kind !== 'string') bad++;
  }
  check('fuzz: 2000 random inputs, never NaN/Infinity, low <= high', bad === 0, `${bad} bad`);
}

// ── Label: stable buckets and hysteresis ───────────────────────────────────────
{
  const at = (low: number, high: number): UploadEta => ({ state: 'estimating', lowSeconds: low, highSeconds: high, midSeconds: Math.sqrt(low * high), basis: 'measured' });
  check('under 10 s -> a few seconds', etaLabel(at(2, 8)).kind === 'seconds');
  const a = etaLabel(at(25, 40));
  check('a narrow band -> about N, snapped to a bucket', a.kind === 'about' && a.seconds === 30, JSON.stringify(a));
  const b = etaLabel(at(70, 110));
  check('about 90 seconds', b.kind === 'about' && b.seconds === 90, JSON.stringify(b));
  const c = etaLabel(at(60, 200));
  check('a wide band -> range', c.kind === 'range' && c.lowMinutes === 1 && c.highMinutes === 4, JSON.stringify(c));
  // Found in the browser: a 2.6 MB clip on the default prior is 7 to 48 s, and "1 to 2 minutes"
  // overstated it by 2x. A wide band that ends within 2 minutes reads "about N", leaning to the
  // slow side (between the middle and the top of the band), never a minutes range.
  const shortWide = etaLabel({ state: 'estimating', lowSeconds: 7.6, midSeconds: 19, highSeconds: 48, basis: 'default' });
  check('a short but wide band is "about 30 seconds", not "1 to 2 minutes"', shortWide.kind === 'about' && shortWide.seconds === 30, JSON.stringify(shortWide));
  const medWide = etaLabel({ state: 'estimating', lowSeconds: 20, midSeconds: 50, highSeconds: 110, basis: 'default' });
  check('a band ending under 2 minutes is still "about"', medWide.kind === 'about' && medWide.seconds === 90, JSON.stringify(medWide));
  const prev: EtaLabel = { kind: 'about', seconds: 30 };
  const up = etaLabel(at(33, 45), prev);
  check('a small upward drift keeps the old bucket (the number does not creep)', up.kind === 'about' && up.seconds === 30, JSON.stringify(up));
  const upBig = etaLabel(at(40, 60), prev);
  check('an upward move past +30% is shown', upBig.kind === 'about' && upBig.seconds === 45, JSON.stringify(upBig));
  const down = etaLabel(at(10, 18), prev);
  check('a downward move is shown at once', down.kind === 'about' && down.seconds === 15, JSON.stringify(down));
  const st = etaLabel({ ...at(10, 20), state: 'stalled' }, prev);
  check('stalled replaces any number immediately', st.kind === 'stalled');
}

// ── Publish throttle: a label changes at most every 2 s; a state change goes at once ──
{
  const a: EtaLabel = { kind: 'about', seconds: 30 };
  const b: EtaLabel = { kind: 'about', seconds: 15 };
  check('first label always publishes', shouldPublishEta(null, 0, null, a));
  check('an unchanged label does not republish', !shouldPublishEta(0, 10_000, a, a));
  check('a changed number waits 2 s', !shouldPublishEta(0, ETA_PUBLISH_EVERY_MS - 1, a, b) && shouldPublishEta(0, ETA_PUBLISH_EVERY_MS, a, b));
  check('stalled goes out at once', shouldPublishEta(0, 1, a, { kind: 'stalled' }));
  check('recovering from stalled goes out at once', shouldPublishEta(0, 1, { kind: 'stalled' }, a));
}

// ── The per-device sample (localStorage, try/catch, per-viewer convenience) ────
{
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  let m = meterStart(0);
  m = meterUpdate(m, 200_000, 1000);
  m = meterUpdate(m, 1_200_000, 6000);
  const s = sampleFromMeter(m, 1_200_000, 6000);
  check('a sample is bytes over the warm span', s !== null && near(s.bytesPerSecond, 200_000, 1), JSON.stringify(s));
  check('a small upload leaves no sample', sampleFromMeter(m, MIN_SAMPLE_BYTES - 1, 6000) === null);
  check('an unwarmed meter leaves no sample', sampleFromMeter(meterStart(0), 1e6, 10) === null);
  writeUplinkSample(storage, s);
  check('written under rp-uplink', UPLINK_STORAGE_KEY === 'rp-uplink' && mem.has('rp-uplink'));
  const back = readUplinkSample(storage);
  check('read back intact', back !== null && back.bytesPerSecond === s!.bytesPerSecond);
  mem.set('rp-uplink', '{not json');
  check('garbage storage reads as no sample', readUplinkSample(storage) === null);
  const throwing = { getItem: () => { throw new Error('private mode'); }, setItem: () => { throw new Error('quota'); } };
  check('a throwing storage never throws out of read', readUplinkSample(throwing) === null);
  let threw = false;
  try { writeUplinkSample(throwing, s); } catch { threw = true; }
  check('a throwing storage never throws out of write', !threw);
  check('no storage at all is fine', readUplinkSample(null) === null);
}

console.log(failures === 0 ? '\nupload eta: all passed' : `\nupload eta: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
