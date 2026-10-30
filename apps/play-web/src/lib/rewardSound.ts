// The sounds that say "that worked" (Ahiya, 30.10: the sounds are not satisfying enough). play-web carries
// an identical copy at the same path, deliberately duplicated like mapRtl.ts (packages/shared has no DOM
// types); scripts/test-reward-sound.ts fails if the two drift.
//
// Why these and not one beep. A real thing that is struck has three parts, and a lone oscillator has
// one: a click at the instant of contact (the ear locks onto it, so the sound feels caused by the
// finger), a body with overtones that fade faster than the note (that is what makes it read as an object),
// and a room around it (a short tail, so it does not stop dead). Every note here is built from those.
// Pitches stay on the C major pentatonic, so any two sounds overlapping still agree, and a success climbs
// while nothing in the set falls. A success right after a success lands higher on that scale: the streak
// can be heard. A few cents of random detune stop a repeated sound from being the identical waveform,
// which is what makes a repeated UI sound grate.
//
// Synthesized: nothing to load, nothing to fail. Takes any BaseAudioContext, so a test can render it offline.

export type RewardSound = 'tap' | 'check' | 'step' | 'swap' | 'task' | 'stage' | 'rankUp' | 'finish';
export type Voice = 'tick' | 'wood' | 'glass' | 'bell' | 'thump';

export interface Note {
  /** Delay from the start of the sound, ms. */
  at: number;
  voice: Voice;
  hz: number;
  /** Decay length, ms. */
  len: number;
  gain: number;
}

const n = (at: number, voice: Voice, hz: number, len: number, gain: number): Note => ({ at, voice, hz, len, gain });

export const REWARD_SCORES: Record<RewardSound, readonly Note[]> = {
  // A press: the frequent one, so the smallest.
  tap: [n(0, 'tick', 4000, 10, 0.04), n(0, 'wood', 1047, 55, 0.13)],
  // Something just got filled in: one clean glass drop.
  check: [n(0, 'tick', 5000, 10, 0.08), n(0, 'glass', 1319, 260, 0.3)],
  // Moving on: a small knock and the answer to it.
  step: [n(0, 'wood', 784, 90, 0.15), n(70, 'glass', 1175, 220, 0.22)],
  // Dice in the hand slowing down, then landing on the new mission.
  swap: [
    n(0, 'wood', 330, 35, 0.09), n(50, 'wood', 392, 35, 0.09), n(95, 'wood', 349, 35, 0.09),
    n(135, 'wood', 440, 35, 0.09), n(175, 'wood', 392, 40, 0.1), n(225, 'wood', 523, 45, 0.11),
    n(290, 'tick', 4000, 10, 0.06), n(290, 'wood', 659, 110, 0.18), n(290, 'glass', 1319, 240, 0.12),
  ],
  // A mission done on a player's phone: a rising third that opens into a fifth.
  task: [
    n(0, 'tick', 5000, 10, 0.07), n(0, 'bell', 1047, 200, 0.2), n(85, 'bell', 1319, 200, 0.22),
    n(170, 'bell', 1568, 480, 0.26), n(170, 'glass', 3136, 320, 0.04),
  ],
  // A stage done.
  stage: [
    n(0, 'thump', 131, 150, 0.22), n(0, 'wood', 523, 110, 0.18), n(85, 'wood', 659, 110, 0.18),
    n(170, 'wood', 784, 110, 0.19), n(255, 'tick', 5000, 10, 0.07), n(255, 'bell', 1047, 760, 0.27),
    n(255, 'bell', 1568, 620, 0.13), n(320, 'glass', 3136, 380, 0.04),
  ],
  // Passing another team: quick and bright.
  rankUp: [
    n(0, 'wood', 659, 80, 0.17), n(60, 'wood', 784, 80, 0.17), n(120, 'wood', 1047, 80, 0.18),
    n(180, 'bell', 1319, 560, 0.25), n(180, 'bell', 2093, 420, 0.1), n(250, 'glass', 2637, 320, 0.05),
  ],
  // The whole game done: the only big one.
  finish: [
    n(0, 'thump', 98, 200, 0.24), n(0, 'wood', 523, 120, 0.18), n(100, 'wood', 659, 120, 0.18),
    n(200, 'wood', 784, 120, 0.19), n(300, 'wood', 1047, 130, 0.2),
    n(430, 'thump', 131, 240, 0.24), n(430, 'tick', 5000, 12, 0.08), n(430, 'bell', 523, 1300, 0.17),
    n(430, 'bell', 784, 1300, 0.16), n(430, 'bell', 1047, 1300, 0.18), n(430, 'bell', 1319, 1300, 0.17),
    n(520, 'glass', 2637, 420, 0.05), n(610, 'glass', 3136, 420, 0.05), n(700, 'glass', 4186, 420, 0.04),
  ],
};

/** How long a streak stays alive between two successes, per sound. Absent: this sound does not climb. */
export const STREAK_WINDOW_MS: Partial<Record<RewardSound, number>> = { check: 20_000, task: 900_000 };

// Semitones up the pentatonic, from the sound's own root. Ends at the octave: past that it would whistle.
const STREAK_SEMITONES = [0, 2, 4, 7, 9, 12];

/** Where on the climb the next success lands. Total: nonsense input starts the streak over. */
export function nextStreak(prev: number, lastAt: number | null, now: number, windowMs: number): number {
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt) || !Number.isFinite(now)) return 0;
  const since = now - lastAt;
  if (since < 0 || since > windowMs || !Number.isFinite(prev) || prev < 0) return 0;
  return Math.min(Math.floor(prev) + 1, STREAK_SEMITONES.length - 1);
}

export function streakRatio(streak: number): number {
  const i = Math.max(0, Math.min(Math.floor(streak) || 0, STREAK_SEMITONES.length - 1));
  return 2 ** (STREAK_SEMITONES[i] / 12);
}

// ── Web Audio (never reached by the pure test) ───────────────────────────────

interface Bus { input: GainNode; dry: AudioNode; wet: GainNode; noise: AudioBuffer }
const buses = new WeakMap<BaseAudioContext, Bus>();

// A small warm room, generated: decaying noise, darkened as it goes.
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.9);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const white = (Math.random() * 2 - 1) * (1 - t) ** 3;
      low += (white - low) * (0.5 - 0.42 * t);
      d[i] = low;
    }
  }
  return buf;
}

function busFor(ctx: BaseAudioContext): Bus {
  const found = buses.get(ctx);
  if (found) return found;
  const input = ctx.createGain();
  input.gain.value = 1.5; // Phone speakers: the scores stay readable, the level lives here.
  const limit = ctx.createDynamicsCompressor();
  // A limiter, not a compressor: the default soft knee quietly pressed every short sound to a third.
  limit.threshold.value = -4;
  limit.knee.value = 0;
  limit.ratio.value = 12;
  limit.attack.value = 0.002;
  limit.release.value = 0.12;
  const room = ctx.createConvolver();
  room.buffer = roomImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.2;
  input.connect(limit);
  input.connect(room).connect(wet).connect(limit);
  limit.connect(ctx.destination);
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const bus = { input, dry: limit, wet, noise };
  buses.set(ctx, bus);
  return bus;
}

function decay(ctx: BaseAudioContext, peak: number, start: number, attack: number, end: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  return g;
}

function tone(ctx: BaseAudioContext, hz: number, out: AudioNode, start: number, end: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.frequency.value = hz;
  o.connect(out);
  o.start(start);
  o.stop(end + 0.02);
  return o;
}

function strike(ctx: BaseAudioContext, bus: Bus, note: Note, start: number, ratio: number, cents: number): void {
  const hz = note.hz * ratio;
  const end = start + note.len / 1000;
  if (note.voice === 'tick') {
    const src = ctx.createBufferSource();
    src.buffer = bus.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = note.hz;
    src.connect(hp).connect(decay(ctx, note.gain, start, 0.001, end)).connect(bus.input);
    src.start(start);
    src.stop(end + 0.01);
    return;
  }
  if (note.voice === 'thump') {
    const g = decay(ctx, note.gain, start, 0.003, end);
    g.connect(bus.input);
    const o = tone(ctx, hz, g, start, end);
    o.frequency.setValueAtTime(hz * 1.6, start);
    o.frequency.exponentialRampToValueAtTime(hz, start + 0.07);
    return;
  }
  const body = decay(ctx, note.gain, start, note.voice === 'wood' ? 0.001 : 0.002, end);
  body.connect(bus.input);
  const main = tone(ctx, hz, body, start, end);
  main.detune.value = cents;
  if (note.voice === 'wood') {
    // An inharmonic overtone that is gone almost at once: this is what reads as a struck bar.
    const over = decay(ctx, note.gain * 0.4, start, 0.001, start + Math.min(0.03, note.len / 1000));
    over.connect(bus.input);
    tone(ctx, hz * 3.93, over, start, end).detune.value = cents;
  } else if (note.voice === 'glass') {
    const over = decay(ctx, note.gain * 0.22, start, 0.002, start + (end - start) * 0.5);
    over.connect(bus.input);
    tone(ctx, hz * 2, over, start, end).detune.value = cents;
  } else {
    // Bell: frequency modulation that dies fast, so it starts bright and settles into a pure tone.
    const fm = ctx.createGain();
    fm.gain.setValueAtTime(hz * 1.1, start);
    fm.gain.exponentialRampToValueAtTime(1, start + Math.min(0.16, (end - start) * 0.7));
    fm.connect(main.frequency);
    tone(ctx, hz * 2, fm, start, end);
    const over = decay(ctx, note.gain * 0.14, start, 0.002, start + (end - start) * 0.6);
    over.connect(bus.input);
    tone(ctx, hz * 2.76, over, start, end).detune.value = cents;
  }
}

const streaks = new Map<RewardSound, { step: number; at: number }>();

/** Build the graph ahead of time, so the first sound does not pay for the room in the middle of a press. */
export function warmReward(ctx: BaseAudioContext): void {
  busFor(ctx);
}

/** Schedule a sound on `ctx`. Throws on a broken context: callers own the fallback. */
export function renderReward(ctx: BaseAudioContext, sound: RewardSound, streak = 0, at = ctx.currentTime): void {
  const bus = busFor(ctx);
  const ratio = streakRatio(streak);
  for (const note of REWARD_SCORES[sound]) {
    strike(ctx, bus, note, at + note.at / 1000, ratio, (Math.random() - 0.5) * 12);
  }
}

/** Play it now, and carry the streak for the sounds that climb. */
export function playReward(ctx: BaseAudioContext, sound: RewardSound): void {
  const window = STREAK_WINDOW_MS[sound];
  let step = 0;
  if (window !== undefined) {
    const prev = streaks.get(sound);
    const now = Date.now();
    step = nextStreak(prev?.step ?? 0, prev?.at ?? null, now, window);
    streaks.set(sound, { step, at: now });
  }
  renderReward(ctx, sound, step);
}
