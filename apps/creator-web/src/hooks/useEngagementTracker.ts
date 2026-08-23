// Time on site measurement (change: admin-engagement-and-outreach).
//
// Measures ENGAGED time, not wall clock: the timer only advances while the tab is
// actually visible. A console left open on a second monitor overnight would otherwise
// report sixteen hours of "usage" and make the whole metric a lie.
//
// Flushing is deliberately sparse. Each flush is a Firestore write, so a per second or
// per minute write would cost real money for a number nobody reads in real time.
// Instead time accumulates in memory and is sent:
//   • every FLUSH_INTERVAL_MS while the tab stays visible, and
//   • immediately when the tab is hidden or the page is being unloaded, which is the
//     moment most sessions actually end.
//
// Every failure mode is silent by design. This is analytics: a creator must never see an
// error, lose work, or have the console degrade because a metric write failed.
import { useEffect, useRef } from 'react';
import { recordEngagement } from '../services/calls';
import { MAX_ENGAGEMENT_FLUSH_MS } from '@rushpoint/shared';

const FLUSH_INTERVAL_MS = 2 * 60 * 1000;
/** Below this, a flush is not worth a write. Also stops a rapid visible/hidden flicker
 *  (alt tabbing) from emitting a burst of near empty calls. */
const MIN_FLUSH_MS = 5_000;

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Accumulates engaged milliseconds for the signed in creator and flushes them to
 * `recordEngagement`. Pass `enabled: false` while signed out so nothing is measured and
 * no call is ever made for an anonymous visitor.
 */
export function useEngagementTracker(enabled: boolean): void {
  // Refs, not state: none of this should ever trigger a re-render of the console.
  const pendingMs = useRef(0);
  const segmentStart = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Only count from now. A tab that was already open and hidden contributes nothing.
    segmentStart.current = isVisible() ? Date.now() : null;

    /** Close the open visible segment and add it to the pending total. */
    const closeSegment = () => {
      if (segmentStart.current === null) return;
      const elapsed = Date.now() - segmentStart.current;
      segmentStart.current = null;
      // A negative or absurd elapsed means the system clock moved (sleep, NTP correction).
      // Drop it rather than reporting it; the server clamps too, but not reporting a
      // known bad value is better than relying on the clamp to absorb it.
      if (elapsed > 0 && elapsed <= MAX_ENGAGEMENT_FLUSH_MS) pendingMs.current += elapsed;
    };

    const flush = () => {
      closeSegment();
      if (isVisible()) segmentStart.current = Date.now(); // reopen if still on screen
      const deltaMs = Math.round(pendingMs.current);
      if (deltaMs < MIN_FLUSH_MS) return;
      pendingMs.current = 0;
      // Fire and forget, and swallow everything: a failed metric write must be invisible.
      void recordEngagement({ deltaMs }).catch(() => { /* analytics is never load bearing */ });
    };

    const onVisibility = () => {
      if (isVisible()) {
        segmentStart.current = Date.now();
      } else {
        flush(); // the tab going away is the most reliable "session ended" signal there is
      }
    };

    const timer = window.setInterval(flush, FLUSH_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    // `pagehide` rather than `beforeunload`: it fires on mobile Safari's bfcache path,
    // where beforeunload frequently does not, and this console is used from phones.
    window.addEventListener('pagehide', flush);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush(); // sign out or unmount: bank whatever was measured
    };
  }, [enabled]);
}
