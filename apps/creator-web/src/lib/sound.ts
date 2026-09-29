// Minimal Web-Audio alert cue for the organizer Run Console.
//
// Mirrors (does NOT import) apps/play-web's lib/sound.ts: the participant/staff
// apps play an urgent two-tone when a new SOS arrives; the organizer console had
// no audible cue at all, so a raised alert could sit silent on a busy screen.
// This is a tiny, self-contained synthesizer — no audio assets, nothing fetched.
// Everything degrades silently: no Web Audio, or a context not yet unlocked by a
// user gesture (autoplay policy) → no-op, never a throw.

let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;
function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create or resume the shared AudioContext. Should be called from a user gesture
 * (click/keydown) to satisfy the autoplay policy. Idempotent; silent no-op where
 * Web Audio is unavailable.
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

// Urgent two-tone — matches the play-web 'alert' envelope so the cue is familiar.
const ALERT_FREQS = [880, 620, 880];
const ALERT_DURATION_MS = 260;
const ALERT_GAIN = 0.25;

/**
 * Play the urgent alert cue. Drops silently (never queues) if the context is
 * missing or not yet unlocked. Never throws.
 */
export function playAlert(): void {
  try {
    unlockAudio();
    if (!ctx || ctx.state !== 'running') return; // not unlocked → drop, don't queue
    const now = ctx.currentTime;
    const total = ALERT_DURATION_MS / 1000;
    const step = total / ALERT_FREQS.length;
    ALERT_FREQS.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gainNode = ctx!.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const start = now + i * step;
      const end = start + step;
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(ALERT_GAIN, start + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gainNode).connect(ctx!.destination);
      osc.start(start);
      osc.stop(end);
    });
  } catch {
    /* audio glitch — never break the surrounding flow */
  }
}

// ── The review-wait alarm (change: review-wait-alarm) ─────────────────────────
// Louder, longer and lower than the SOS two-tone, so the organizer can tell "a team is waiting
// for you" from "a team is in trouble" without looking. Same rules: drop, never queue, never throw.
const URGENT_FREQS = [523, 659, 784, 659, 523, 659, 784];
const URGENT_DURATION_MS = 900;
const URGENT_GAIN = 0.35;

export function playUrgent(): void {
  try {
    unlockAudio();
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const step = URGENT_DURATION_MS / 1000 / URGENT_FREQS.length;
    URGENT_FREQS.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gainNode = ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = now + i * step;
      const end = start + step * 0.9;
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(URGENT_GAIN, start + 0.01);
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
 * Can the console make a sound right now? `locked` = the browser has not allowed this page to
 * play audio yet (no click since it loaded): every alert would be dropped SILENTLY, so the console
 * shows a control to enable sound instead of letting the organizer believe it is on.
 */
export function audioState(): 'running' | 'locked' | 'unavailable' {
  if (!audioCtor()) return 'unavailable';
  return ctx && ctx.state === 'running' ? 'running' : 'locked';
}
