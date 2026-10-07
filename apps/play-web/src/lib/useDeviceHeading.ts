// The phone's compass, as a React value (issue 54). Decisions are pure in ./heading.ts; this file is
// only the browser plumbing:
// - Android Chrome fires `deviceorientationabsolute` (a real compass) with no permission prompt.
// - iOS Safari fires `deviceorientation` with `webkitCompassHeading`, but only after
//   `DeviceOrientationEvent.requestPermission()` was called FROM A TAP. `requestCompass` is that
//   call; the map's "focus on me" button makes it. Until then (or if refused) the beam still works
//   from the GPS walking course, so nothing is ever blocked on this permission.
// Updates are coalesced to one per animation frame and skipped under 2 degrees of change, so a
// trembling hand does not re-render the play screen sixty times a second.
import { useCallback, useEffect, useRef, useState } from 'react';
import { compassHeadingFromEvent, smoothHeading } from './heading';

type OrientationCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

function screenAngle(): number {
  try {
    const a = (screen.orientation && screen.orientation.angle) ?? (window as unknown as { orientation?: number }).orientation;
    return typeof a === 'number' ? a : 0;
  } catch { return 0; }
}

export function useDeviceHeading(): { compass: number | null; compassAtMs: number; requestCompass: () => void } {
  const [reading, setReading] = useState<{ deg: number | null; at: number }>({ deg: null, at: 0 });
  const smoothed = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const [listening, setListening] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const absolute = 'ondeviceorientationabsolute' in window;
    const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    const onEvent = (e: Event) => {
      const deg = compassHeadingFromEvent(e as unknown as { webkitCompassHeading?: number; alpha?: number; absolute?: boolean }, screenAngle());
      if (deg == null) return;
      pending.current = deg;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const next = smoothHeading(smoothed.current, pending.current, 0.35);
        const prev = smoothed.current;
        smoothed.current = next;
        const moved = prev == null || next == null || Math.abs(((next - prev + 540) % 360) - 180) >= 2;
        // Refresh the timestamp at least once a second even when still, so the reading stays "fresh".
        setReading((r) => (moved || Date.now() - r.at > 1000 ? { deg: next, at: Date.now() } : r));
      });
    };
    try { window.addEventListener(type, onEvent); } catch { return; }
    return () => {
      window.removeEventListener(type, onEvent);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [listening]);

  // iOS: must run inside a user gesture. Anywhere else it is a no-op. Never throws.
  const requestCompass = useCallback(() => {
    try {
      const Ctor = (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
      if (Ctor && typeof Ctor.requestPermission === 'function') {
        Ctor.requestPermission().then((r) => { if (r === 'granted') setListening((n) => n + 1); }).catch(() => undefined);
      }
    } catch { /* no compass: the beam falls back to the walking course */ }
  }, []);

  return { compass: reading.deg, compassAtMs: reading.at, requestCompass };
}
