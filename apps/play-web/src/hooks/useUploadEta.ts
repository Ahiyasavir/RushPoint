import { useEffect, useRef, useState } from 'react';
import { getUploadBytes, subscribeUploadBytes, type UploadBytes } from '../lib/uploadResiliency';
import {
  estimateUploadEta, etaLabel, meterStart, meterUpdate, readUplinkSample, shouldPublishEta, uplinkPrior,
  type EtaConnectionHint, type EtaLabel, type MeterState, type ThroughputPrior, type UploadEta,
} from '../lib/uploadEta';

// The live ETA for the upload in flight (change: video-upload-speed, D5). Reads the byte channel
// services/firebase.ts publishes, keeps its own meter (restarted when `loaded` goes backwards, i.e.
// a retry), and re-evaluates once a second so a stall shows even when no event arrives. All the
// judgement is in lib/uploadEta.ts; this only feeds it the clock.

export function connectionHint(): EtaConnectionHint | null {
  try {
    return (navigator as Navigator & { connection?: EtaConnectionHint }).connection ?? null;
  } catch {
    return null;
  }
}

export function localStorageOrNull(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** The prior for an upload starting now: this phone's own recent sample, the hint, or the default. */
export function currentPrior(nowMs: number): ThroughputPrior {
  return uplinkPrior({ recent: readUplinkSample(localStorageOrNull()), connection: connectionHint(), nowMs });
}

export function useUploadEta(): EtaLabel | null {
  const [label, setLabel] = useState<EtaLabel | null>(null);
  const meter = useRef<MeterState | null>(null);
  const prior = useRef<ThroughputPrior | null>(null);
  const last = useRef<UploadBytes | null>(null);
  const shown = useRef<{ label: EtaLabel | null; atMs: number | null }>({ label: null, atMs: null });

  useEffect(() => {
    const evaluate = () => {
      const b = last.current;
      if (!b || !meter.current || !prior.current) return;
      const now = Date.now();
      const eta: UploadEta = estimateUploadEta({ totalBytes: b.total, sentBytes: b.loaded, meter: meter.current, prior: prior.current, nowMs: now });
      const next = etaLabel(eta, shown.current.label);
      if (shouldPublishEta(shown.current.atMs, now, shown.current.label, next)) {
        shown.current = { label: next, atMs: now };
        setLabel(next);
      }
    };
    const onBytes = (b: UploadBytes | null) => {
      if (!b) {
        last.current = null;
        meter.current = null;
        prior.current = null;
        shown.current = { label: null, atMs: null };
        setLabel(null);
        return;
      }
      if (!meter.current) {
        meter.current = meterStart(b.atMs);
        prior.current = currentPrior(b.atMs);
      }
      meter.current = meterUpdate(meter.current, b.loaded, b.atMs);
      last.current = b;
      evaluate();
    };
    onBytes(getUploadBytes());
    const un = subscribeUploadBytes(onBytes);
    const tick = setInterval(evaluate, 1000);
    return () => { un(); clearInterval(tick); };
  }, []);

  return label;
}
