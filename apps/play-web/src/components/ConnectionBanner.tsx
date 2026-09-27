import { useEffect, useState } from 'react';
import { useT } from '../i18nContext';
import { haptic } from '../lib/haptics';
import { TopOverlay } from './TopOverlays';

// Thin top banner shown when the device is offline. Reads/live-state keep
// working from the Firestore cache, but actions (verify, submit, SOS) need a
// connection — so participants get a clear, non-blocking heads-up.
export default function ConnectionBanner() {
  const { t } = useT();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => { setOnline(false); haptic('error'); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;
  // Rendered into the shared top stack (change: play-top-overlay-stack) rather
  // than as its own `fixed` layer at a hardcoded offset, so it can never land on
  // top of the reconnect pill or the power-up toast. It is the one overlay in the
  // BANNER slot: it persists for as long as the radio is down, so it reserves its
  // own height instead of covering the header it used to sit on.
  return (
    <TopOverlay kind="offline">
      <div data-testid="offline-banner" role="status" aria-live="polite"
        className="w-full bg-amber-500 text-black text-center text-xs font-medium py-1.5 shadow">
        {t.common.offline}
      </div>
    </TopOverlay>
  );
}
