// The setup walk's sounds (change: setup-flow-full-screen). Ahiya, 23.10: "take care of the sound too".
//
// Synthesized with zzfx (MIT, under 1 KB), so there is no audio file to ship or to fail loading. Rules
// from UI sound practice: every sound answers something the creator just DID (never ambient), the
// frequent ones are the quietest and shortest, the rare ones (a stage done, the game done) are the
// rich ones, and one press in the header silences all of it, remembered per browser.
//
// zzfx creates its AudioContext when it is imported, so it is imported on the first sound, which is
// always inside a press: the browser allows audio then, and the page does not pay for it up front.

export type SetupSound = 'tap' | 'check' | 'step' | 'stage' | 'finish' | 'swap';

const KEY = 'rp-setup-sound';

/** zzfx parameter lists: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime. */
type Params = (number | undefined)[];
const NOTE = (hz: number, len = 0.12, vol = 0.4): Params => [vol, 0, hz, 0.004, len * 0.3, len, 0, 1.6];

/** Each sound is a short sequence of [delayMs, params]. */
export const SOUND_BANK: Record<SetupSound, readonly (readonly [number, Params])[]> = {
  // A press: barely there.
  tap: [[0, [0.18, 0, 1046, 0.002, 0.005, 0.035, 0, 2]]],
  // A field just became filled: one bright drop.
  check: [[0, [0.32, 0, 1568, 0.002, 0.02, 0.09, 0, 2.2]]],
  // Moving on from something done: two rising notes.
  step: [[0, NOTE(784, 0.1, 0.32)], [70, NOTE(1175, 0.14, 0.32)]],
  // A whole stage done: a major arpeggio.
  stage: [[0, NOTE(523, 0.12)], [90, NOTE(659, 0.12)], [180, NOTE(784, 0.14)], [270, NOTE(1047, 0.3, 0.45)]],
  // The game done: the arpeggio, then a held chord.
  finish: [
    [0, NOTE(523, 0.12)], [100, NOTE(659, 0.12)], [200, NOTE(784, 0.12)], [300, NOTE(1047, 0.16)],
    [430, NOTE(1319, 0.5, 0.35)], [430, NOTE(1047, 0.5, 0.3)], [430, NOTE(784, 0.5, 0.25)],
  ],
  // Another mission from the bank: a little dice rattle that rises.
  swap: [[0, [0.22, 0.2, 260, 0, 0.03, 0.08, 1, 1, 6]], [80, [0.22, 0.2, 380, 0, 0.03, 0.1, 1, 1, 8]]],
};

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: the toggle still works for this visit */ }
}

let engine: Promise<{ zzfx: (...p: Params) => unknown; ZZFX: { volume: number; audioContext: AudioContext } } | null> | null = null;

function load() {
  if (!engine) {
    engine = import('zzfx')
      .then((m) => { m.ZZFX.volume = 0.5; return m as never; })
      .catch(() => null);
  }
  return engine;
}

/** Play a sound if sound is on. Never throws and never waits: a sound is decoration, not a step. */
export function playSetupSound(kind: SetupSound, on: boolean): void {
  if (!on || typeof window === 'undefined') return;
  void load().then((z) => {
    if (!z) return;
    try {
      if (z.ZZFX.audioContext.state === 'suspended') void z.ZZFX.audioContext.resume();
      for (const [delay, params] of SOUND_BANK[kind]) {
        if (delay === 0) z.zzfx(...params);
        else setTimeout(() => { try { z.zzfx(...params); } catch { /* ignore */ } }, delay);
      }
    } catch { /* no audio on this device */ }
  });
}
