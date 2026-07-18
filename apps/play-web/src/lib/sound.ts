// Audio + haptic feedback for the field game (change: audio-haptic-feedback).
//
// Sounds are SYNTHESIZED in-code via the Web Audio API — short oscillator/gain
// envelopes, no audio asset files, nothing fetched. Each cue also fires a device
// vibration via the existing haptics helper. Both are governed by ONE persistent
// mute toggle (store.loadSound()). Everything degrades silently: no Web Audio, no
// Vibration API, or audio not yet unlocked (iOS autoplay policy) → no-op, never a
// throw, never a queued-then-replayed cue.
import { haptic } from './haptics';
import { loadSound } from '../store';

// ── Pure, DOM-free core (unit-tested in scripts/test-sound.ts) ───────────────

export type Cue = 'task' | 'stage' | 'alert' | 'rankUp';

export const CUES: Cue[] = ['task', 'stage', 'alert', 'rankUp'];

/** A short synthesizable envelope: notes played in sequence over durationMs. */
export interface Envelope {
  /** Frequencies (Hz) played as a quick sequence — one entry = a single blip. */
  freqs: number[];
  /** Total envelope length in milliseconds. */
  durationMs: number;
  type: OscillatorType;
  /** Peak gain in (0,1]. Kept modest so cues are a confirmation, not a jolt. */
  gain: number;
}

export const ENVELOPES: Record<Cue, Envelope> = {
  // Single soft blip — frequent, so it stays gentle.
  task:   { freqs: [660],            durationMs: 120, type: 'sine',     gain: 0.18 },
  // Two-note rising — a small "level up".
  stage:  { freqs: [523, 784],       durationMs: 220, type: 'triangle', gain: 0.22 },
  // Three-note arpeggio — a celebratory rank climb.
  rankUp: { freqs: [523, 659, 988],  durationMs: 300, type: 'triangle', gain: 0.22 },
  // Urgent two-tone — shared by SOS send and staff SOS receive.
  alert:  { freqs: [880, 620, 880],  durationMs: 260, type: 'square',   gain: 0.25 },
};

/** Haptic pattern paired with each cue (see lib/haptics.ts). */
export const CUE_HAPTIC: Record<Cue, 'tap' | 'success' | 'warn' | 'error'> = {
  task:   'success',
  stage:  'success',
  rankUp: 'success',
  alert:  'error',
};

/** Whether a leaderboard change is a genuine improvement (strictly lower rank). */
export function isRankUp(prev: number | undefined, next: number | undefined): boolean {
  if (typeof prev !== 'number' || typeof next !== 'number') return false;
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return false;
  if (prev < 1 || next < 1) return false; // ranks are 1-based; guard nonsense
  return next < prev;
}

/** The mute gate: feedback fires only when sound is enabled. */
export function shouldFeedback(soundEnabled: boolean): boolean {
  return soundEnabled === true;
}

// ── Web Audio plumbing (DOM-bound; not imported by the pure test) ────────────

let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;
function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create or resume the shared AudioContext. Must be called from a user gesture
 * (tap/click/keydown) to satisfy the iOS/Safari autoplay policy. Idempotent and
 * a silent no-op where Web Audio is unavailable.
 */
export function unlockAudio(): void {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* unsupported / blocked — silent no-op */
  }
}

/**
 * Play the synthesized cue. Drops silently (never queues) if the context is
 * missing or not yet unlocked (running). Never throws.
 */
export function playCue(cue: Cue): void {
  try {
    if (!ctx || ctx.state !== 'running') return; // not unlocked → drop, don't queue
    const env = ENVELOPES[cue];
    const now = ctx.currentTime;
    const total = env.durationMs / 1000;
    const step = total / env.freqs.length;
    env.freqs.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gainNode = ctx!.createGain();
      osc.type = env.type;
      osc.frequency.value = freq;
      const start = now + i * step;
      const end = start + step;
      // Quick attack, exponential release so notes don't click.
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(env.gain, start + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gainNode).connect(ctx!.destination);
      osc.start(start);
      osc.stop(end);
    });
  } catch {
    /* audio glitch — never break the surrounding flow */
  }
}

/**
 * Fire the unified cue: sound + vibration, gated by the persistent mute toggle.
 * When sound is off, neither plays.
 */
export function feedback(cue: Cue): void {
  if (!shouldFeedback(loadSound())) return;
  playCue(cue);
  haptic(CUE_HAPTIC[cue]);
}
