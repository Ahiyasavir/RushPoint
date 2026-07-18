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
