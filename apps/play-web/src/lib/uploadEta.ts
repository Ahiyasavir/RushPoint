// How long the upload will take, as the player reads it (change: video-upload-speed, design D5).
//
// Field ask: the player should know roughly how long a clip will take to send, from the clip's
// length with some account of the connection. Download managers answer "time remaining" as bytes
// left over a SMOOTHED throughput, because the instant rate jumps around; before any byte moves
// there is no measurement, so a prior is needed, and its source degrades by platform:
//   recent       this phone's own last upload to our server (the right direction, the right path)
//   network-hint Chromium's navigator.connection (a DOWNLOAD estimate, so scaled down)
//   default      iOS and Firefox have neither: a deliberately pessimistic 150 KB/s
//
// Pure and total: no DOM, no clock (nowMs is passed in), and every garbage input degrades to the
// next layer instead of NaN. This feeds a hint on screen, never a refusal.

import { predictedClipBytesFor, type CaptureProfile } from './videoCapture';

export type EtaBasis = 'measured' | 'recent' | 'network-hint' | 'default';

export interface ThroughputPrior {
  bytesPerSecond: number;
  basis: Exclude<EtaBasis, 'measured'>;
  spread: number;
}

export interface EtaConnectionHint { effectiveType?: unknown; downlink?: unknown; saveData?: unknown }

export interface UplinkSample { bytesPerSecond: number; atMs: number; bytes: number }

export const BITRATE_OVERSHOOT = 1.15;
export const RECENT_SAMPLE_MAX_AGE_MS = 15 * 60_000;
export const MIN_SAMPLE_BYTES = 200_000;
export const UPLINK_TO_DOWNLINK = 0.3;
export const DEFAULT_UPLINK_BPS = 150_000;
export const WARMUP_BYTES = 128 * 1024;
export const WARMUP_MS = 1000;
export const EWMA_HALF_LIFE_MS = 3000;
export const BLEND_FULL_MS = 6000;
export const MAX_MEASURED_WEIGHT = 0.9;
export const FINALIZE_SECONDS = 2;
export const ETA_CAP_SECONDS = 900;
export const STALL_SHOW_MS = 5000;
export const ALMOST_DONE_FRACTION = 0.97;
export const UPWARD_MOVE_FACTOR = 1.3;
export const ABOUT_BUCKETS = [15, 30, 45, 60, 90, 120, 180, 300] as const;
export const UPLINK_STORAGE_KEY = 'rp-uplink';

const SPREAD: Record<EtaBasis, number> = { measured: 1.3, recent: 1.6, 'network-hint': 2.0, default: 2.5 };
const HINT_BPS: Record<string, number> = { 'slow-2g': 4_000, '2g': 8_000, '3g': 50_000 };

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const pos = (n: unknown): n is number => num(n) && n > 0;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const DEFAULT_PRIOR: ThroughputPrior = { bytesPerSecond: DEFAULT_UPLINK_BPS, basis: 'default', spread: SPREAD.default };

/** Bytes a clip of this length will send, with container and encoder-overshoot margin. */
export function predictedUploadBytes(seconds: number, profile: Pick<CaptureProfile, 'videoBitsPerSecond' | 'audioBitsPerSecond'> | null | undefined): number {
  return predictedClipBytesFor(seconds, profile) * BITRATE_OVERSHOOT;
}

/** Best prior before anything is measured. First match wins. */
export function uplinkPrior(p: { recent?: UplinkSample | null; connection?: EtaConnectionHint | null; nowMs: number }): ThroughputPrior {
  const r = p?.recent;
  if (r && typeof r === 'object' && pos(r.bytesPerSecond) && num(r.bytes) && r.bytes >= MIN_SAMPLE_BYTES
    && num(r.atMs) && num(p.nowMs) && p.nowMs - r.atMs >= 0 && p.nowMs - r.atMs <= RECENT_SAMPLE_MAX_AGE_MS) {
    return { bytesPerSecond: r.bytesPerSecond, basis: 'recent', spread: SPREAD.recent };
  }
  const c = p?.connection;
  if (c && typeof c === 'object') {
    if (c.saveData === true) return { bytesPerSecond: HINT_BPS['3g'], basis: 'network-hint', spread: SPREAD['network-hint'] };
    const et = c.effectiveType;
    if (typeof et === 'string' && HINT_BPS[et]) return { bytesPerSecond: HINT_BPS[et], basis: 'network-hint', spread: SPREAD['network-hint'] };
    if (et === '4g' && pos(c.downlink)) {
      const bps = clamp(Math.min(c.downlink, 10) * 125_000 * UPLINK_TO_DOWNLINK, 60_000, 1_250_000);
      return { bytesPerSecond: bps, basis: 'network-hint', spread: SPREAD['network-hint'] };
    }
  }
  return DEFAULT_PRIOR;
}

// ─── The live meter: an EWMA over XHR upload progress ────────────────────────
//
// The first burst reports bytes handed to the OS, not delivered, so samples before BOTH
// WARMUP_BYTES and WARMUP_MS are ignored. After that the EWMA is TIME-based
// (α = 1 − 0.5^(Δt / half-life)), so irregular progress events do not bias it. A `loaded` that
// goes backwards is a new attempt: the meter restarts.
export interface MeterState {
  startAtMs: number;
  firstWarmAtMs: number | null;
  firstWarmLoaded: number;
  lastAtMs: number;
  lastLoaded: number;
  ewmaBps: number | null;
  warmedUp: boolean;
  lastProgressAtMs: number;
}

export function meterStart(nowMs: number): MeterState {
  const t = num(nowMs) ? nowMs : 0;
  return { startAtMs: t, firstWarmAtMs: null, firstWarmLoaded: 0, lastAtMs: t, lastLoaded: 0, ewmaBps: null, warmedUp: false, lastProgressAtMs: t };
}

export function meterUpdate(s: MeterState, loaded: number, nowMs: number): MeterState {
  if (!s || !num(loaded) || loaded < 0 || !num(nowMs)) return s;
  if (loaded < s.lastLoaded) return meterUpdate(meterStart(nowMs), loaded, nowMs);
  const progressed = loaded > s.lastLoaded;
  const lastProgressAtMs = progressed ? nowMs : s.lastProgressAtMs;
  if (!s.warmedUp) {
    const warm = loaded >= WARMUP_BYTES && nowMs - s.startAtMs >= WARMUP_MS;
    return {
      ...s, lastLoaded: loaded, lastAtMs: nowMs, lastProgressAtMs,
      ...(warm ? { warmedUp: true, firstWarmAtMs: nowMs, firstWarmLoaded: loaded } : {}),
    };
  }
  const dt = nowMs - s.lastAtMs;
  if (dt <= 0) return { ...s, lastProgressAtMs };
  const rate = (loaded - s.lastLoaded) * 1000 / dt;
  const alpha = 1 - Math.pow(0.5, dt / EWMA_HALF_LIFE_MS);
  const ewmaBps = s.ewmaBps === null ? rate : s.ewmaBps + alpha * (rate - s.ewmaBps);
  return { ...s, lastLoaded: loaded, lastAtMs: nowMs, lastProgressAtMs, ewmaBps };
}

// ─── The estimate ────────────────────────────────────────────────────────────
export interface EtaInput {
  /** blob.size when known, else predictedUploadBytes(seconds, profile). */
  totalBytes: number;
  sentBytes: number;
  meter?: MeterState | null;
  prior: ThroughputPrior;
  nowMs: number;
}

export interface UploadEta {
  state: 'estimating' | 'stalled' | 'almost-done';
  lowSeconds: number;
  midSeconds: number;
  highSeconds: number;
  basis: EtaBasis;
}

export function estimateUploadEta(i: EtaInput): UploadEta {
  const total = pos(i?.totalBytes) ? i.totalBytes : 0;
  const sent = num(i?.sentBytes) ? clamp(i.sentBytes, 0, total) : 0;
  const prior = i?.prior && pos(i.prior.bytesPerSecond) && pos(i.prior.spread) && SPREAD[i.prior.basis] ? i.prior : DEFAULT_PRIOR;
  const now = i?.nowMs;
  const m = i?.meter ?? null;
  if (total <= 0) return { state: 'estimating', lowSeconds: 0, midSeconds: 0, highSeconds: 0, basis: prior.basis };

  const fraction = sent / total;
  const remaining = total - sent;

  let bps = prior.bytesPerSecond;
  let basis: EtaBasis = prior.basis;
  if (m && m.warmedUp && pos(m.ewmaBps) && num(m.firstWarmAtMs) && num(now)) {
    const w = clamp((now - m.firstWarmAtMs) / BLEND_FULL_MS, 0, MAX_MEASURED_WEIGHT);
    if (w > 0) {
      // Harmonic: averages SECONDS per byte, so one fast burst cannot make it optimistic.
      bps = 1 / (w / m.ewmaBps + (1 - w) / prior.bytesPerSecond);
      basis = 'measured';
    }
  }
  const mid = clamp(remaining / bps + FINALIZE_SECONDS, 0, ETA_CAP_SECONDS);
  const f = 1 + (SPREAD[basis] - 1) * (1 - fraction);
  const low = clamp(mid / f, 0, mid);
  const high = clamp(mid * f, mid, ETA_CAP_SECONDS);

  let state: UploadEta['state'] = 'estimating';
  if (fraction >= ALMOST_DONE_FRACTION) state = 'almost-done';
  else if (m && num(now) && num(m.lastProgressAtMs) && now - m.lastProgressAtMs >= STALL_SHOW_MS) state = 'stalled';
  return { state, lowSeconds: low, midSeconds: mid, highSeconds: high, basis };
}

// ─── What the player reads: stable buckets, never a per-second countdown ─────
export type EtaLabel =
  | { kind: 'seconds' }
  | { kind: 'about'; seconds: (typeof ABOUT_BUCKETS)[number] }
  | { kind: 'range'; lowMinutes: number; highMinutes: number }
  | { kind: 'stalled' }
  | { kind: 'almost-done' };

function snap(seconds: number): (typeof ABOUT_BUCKETS)[number] {
  let best: (typeof ABOUT_BUCKETS)[number] = ABOUT_BUCKETS[0];
  for (const b of ABOUT_BUCKETS) {
    if (Math.abs(Math.log(seconds / b)) < Math.abs(Math.log(seconds / best))) best = b;
  }
  return best;
}

/** Seconds a label stands for, for ordering (upper edge of its bucket). */
function labelUpper(l: EtaLabel): number | null {
  if (l.kind === 'seconds') return 10;
  if (l.kind === 'about') return l.seconds;
  if (l.kind === 'range') return l.highMinutes * 60;
  return null;
}
function labelRank(l: EtaLabel): number | null {
  if (l.kind === 'seconds') return 5;
  if (l.kind === 'about') return l.seconds;
  if (l.kind === 'range') return (l.lowMinutes + l.highMinutes) * 30;
  return null;
}

function sameLabel(a: EtaLabel, b: EtaLabel): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The label for an estimate. With `previous`, a DOWNWARD move shows at once, an upward one only
 * when the estimate clears the old bucket's upper edge by 30%, so the number does not creep. The
 * caller also publishes at most every 2 s (see shouldPublishEta).
 */
export function etaLabel(eta: UploadEta, previous?: EtaLabel | null): EtaLabel {
  if (!eta || eta.state === 'stalled') return { kind: 'stalled' };
  if (eta.state === 'almost-done') return { kind: 'almost-done' };
  const low = num(eta.lowSeconds) ? Math.max(0, eta.lowSeconds) : 0;
  const high = num(eta.highSeconds) ? Math.max(low, eta.highSeconds) : low;
  let next: EtaLabel;
  const mean = low > 0 ? Math.sqrt(low * high) : high;
  if (high < 10) next = { kind: 'seconds' };
  else if (low > 0 && high / low <= 2 && mean <= ABOUT_BUCKETS[ABOUT_BUCKETS.length - 1] * 1.2) next = { kind: 'about', seconds: snap(mean) };
  else {
    const lowMinutes = Math.max(1, Math.floor(low / 60));
    next = { kind: 'range', lowMinutes, highMinutes: Math.max(lowMinutes + 1, Math.ceil(high / 60)) };
  }
  if (!previous || sameLabel(previous, next)) return next;
  const pr = labelRank(previous);
  const nr = labelRank(next);
  const pu = labelUpper(previous);
  if (pr === null || nr === null || pu === null) return next;
  if (nr > pr && mean <= pu * UPWARD_MOVE_FACTOR) return previous;
  return next;
}

export const ETA_PUBLISH_EVERY_MS = 2000;

/** At most one label change every 2 s. A state change (stalled / almost done) goes out at once. */
export function shouldPublishEta(lastPublishedAtMs: number | null, nowMs: number, prev: EtaLabel | null, next: EtaLabel): boolean {
  if (!prev || lastPublishedAtMs === null || !num(nowMs)) return true;
  if (sameLabel(prev, next)) return false;
  const numeric = (l: EtaLabel) => l.kind === 'seconds' || l.kind === 'about' || l.kind === 'range';
  if (numeric(prev) !== numeric(next)) return true;
  return nowMs - lastPublishedAtMs >= ETA_PUBLISH_EVERY_MS;
}

// ─── The per-device uplink sample ────────────────────────────────────────────
//
// Per-viewer convenience only (browser storage may be empty, blocked or throw). Losing it means the
// next estimate starts from the hint or the default, nothing more.
export function sampleFromMeter(m: MeterState | null | undefined, bytes: number, nowMs: number): UplinkSample | null {
  if (!m || !m.warmedUp || !num(m.firstWarmAtMs) || !num(bytes) || bytes < MIN_SAMPLE_BYTES || !num(nowMs)) return null;
  const spanMs = m.lastProgressAtMs - m.firstWarmAtMs;
  const moved = m.lastLoaded - m.firstWarmLoaded;
  if (!(spanMs >= 500) || !(moved > 0)) return null;
  return { bytesPerSecond: moved * 1000 / spanMs, atMs: nowMs, bytes };
}

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function readUplinkSample(storage: KV | null | undefined): UplinkSample | null {
  try {
    const raw = storage?.getItem(UPLINK_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<UplinkSample>;
    if (!v || !pos(v.bytesPerSecond) || !num(v.atMs) || !num(v.bytes)) return null;
    return { bytesPerSecond: v.bytesPerSecond, atMs: v.atMs, bytes: v.bytes };
  } catch {
    return null;
  }
}

export function writeUplinkSample(storage: KV | null | undefined, sample: UplinkSample | null): void {
  if (!sample) return;
  try { storage?.setItem(UPLINK_STORAGE_KEY, JSON.stringify(sample)); } catch { /* per-device convenience */ }
}
