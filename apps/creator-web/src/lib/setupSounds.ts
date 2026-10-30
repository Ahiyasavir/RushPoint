// The setup walk's sounds (change: setup-flow-full-screen). Ahiya, 23.10: "take care of the sound too".
//
// Rules from UI sound practice: every sound answers something the creator just DID (never ambient), the
// frequent ones are the quietest and shortest, the rare ones (a stage done, the game done) are the
// rich ones, and one press in the header silences all of it, remembered per browser. The sounds
// themselves live in rewardSound.ts, shared with the player's phone.
import { playReward } from './rewardSound';
import { audioContext, unlockAudio } from './sound';

export type SetupSound = 'tap' | 'check' | 'step' | 'stage' | 'finish' | 'swap';

const KEY = 'rp-setup-sound';

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: the toggle still works for this visit */ }
}

// Past this, the sound no longer belongs to the press that caused it. Dropped, never played late.
const LATE_MS = 120;

/**
 * Play a sound if sound is on. Never throws and never waits: a sound is decoration, not a step. On a
 * context that is not running, notes would pile up on a stopped clock and all land at once when it starts.
 */
export function playSetupSound(kind: SetupSound, on: boolean): void {
  if (!on || typeof window === 'undefined') return;
  try {
    unlockAudio();
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === 'running') { playReward(ctx, kind); return; }
    const asked = performance.now();
    void ctx.resume().then(() => {
      if (performance.now() - asked < LATE_MS) playReward(ctx, kind);
    }).catch(() => { /* no audio on this device */ });
  } catch { /* no audio on this device */ }
}
