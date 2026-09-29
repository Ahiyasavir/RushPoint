// Orientation while playing and filming (change: capture-rotation).
//
// The manifests no longer lock the app to portrait (a TWA bakes the manifest's orientation into
// AndroidManifest.xml, and `screen.orientation.unlock()` only returns to that default, so a locked
// manifest made filming in landscape impossible). Instead the game ASKS for portrait where the
// platform allows it (an installed app on Android), and lets go while the camera is open. Where
// locking is not supported (iPhone, a browser tab) the request is a harmless no-op and the game
// screen simply works in landscape. Never throws, never blocks capture.
import { useEffect } from 'react';

export type OrientationIntent = 'portrait' | 'free';

export function orientationIntent(input: { screen: 'game' | 'other'; cameraOpen: boolean } | null | undefined): OrientationIntent {
  if (!input || input.screen !== 'game') return 'free';
  return input.cameraOpen ? 'free' : 'portrait';
}

type LockableOrientation = { lock?: (o: string) => Promise<void>; unlock?: () => void };

export function applyOrientationIntent(intent: OrientationIntent): void {
  try {
    const o = (typeof screen !== 'undefined' ? (screen as unknown as { orientation?: LockableOrientation }).orientation : undefined);
    if (!o) return;
    if (intent === 'portrait') {
      // Rejected outside an installed app / fullscreen: that is fine, nothing to do.
      void o.lock?.('portrait')?.catch?.(() => undefined);
    } else {
      o.unlock?.();
    }
  } catch { /* unsupported — the screen works in either orientation */ }
}

/** Ask for `intent` while mounted; release on unmount. */
export function useOrientationIntent(intent: OrientationIntent): void {
  useEffect(() => {
    applyOrientationIntent(intent);
    return () => { if (intent === 'portrait') applyOrientationIntent('free'); };
  }, [intent]);
}
