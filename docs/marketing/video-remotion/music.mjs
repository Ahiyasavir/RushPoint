// Original instrumental bed for the RushPoint video — synthesized from scratch.
// v3 "stomp-clap indie folk" arrangement: real plucked acoustic guitar (Karplus-Strong),
// foot stomps, hand claps, tambourine, and a catchy whistle hook — an outdoors,
// friends-adventure vibe. Structure timed to the hero timeline:
// minimal intro → building groove → full band at the brand reveal → breakdown on
// "no judges" → audience → big finish.
import fs from 'fs';

const MODE = process.argv[3] || 'hero';
const SR = 48000;
const BPM = 128;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const DUR = MODE === 'social' ? 20.2 : 76.9;
const N = Math.floor(SR * DUR);
const L = new Float64Array(N);
const R = new Float64Array(N);

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const panL = (p) => Math.cos((p + 1) * Math.PI / 4);
const panR = (p) => Math.sin((p + 1) * Math.PI / 4);

// ── Karplus-Strong plucked string (acoustic-guitar timbre) ───────────────────
function addPluck({ start, freq, gain = 0.5, dur = 1.4, pan = 0, decay = 0.996, bright = 0.5 }) {
  const p = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(p);
  for (let i = 0; i < p; i++) buf[i] = Math.random() * 2 - 1;
  // pre-lowpass the excitation for a warmer, less twangy pluck
  let s = 0;
  for (let i = 0; i < p; i++) { s += (buf[i] - s) * (0.25 + bright * 0.5); buf[i] = s; }
  const i0 = Math.floor(start * SR);
  const total = Math.floor(dur * SR);
  const wl = panL(pan), wr = panR(pan);
  let idx = 0;
  for (let i = 0; i < total; i++) {
    const o = i0 + i; if (o < 0) { idx = (idx + 1) % p; continue; } if (o >= N) break;
    const cur = buf[idx];
    const nxt = buf[(idx + 1) % p];
    buf[idx] = (cur + nxt) * 0.5 * decay;
    idx = (idx + 1) % p;
    const atk = i < 40 ? i / 40 : 1;
    const v = cur * gain * atk;
    L[o] += v * wl; R[o] += v * wr;
  }
}

// strum a chord = plucks spread over ~14ms (down = low→high, up = high→low, softer)
function strum(start, midis, { gain = 0.5, up = false, dur = 1.2, pan = 0 }) {
  const order = up ? [...midis].reverse() : midis;
  order.forEach((m, k) => addPluck({ start: start + k * 0.014, freq: midi(m), gain: gain * (up ? 0.7 : 1), dur, pan: pan + (k - 1) * 0.12, bright: up ? 0.65 : 0.5 }));
}

function addNoise({ start, len, gain = 0.3, hp = 0, decay = 0.05, pan = 0 }) {
  const i0 = Math.floor(start * SR);
  const total = Math.ceil(len * SR);
  const wl = panL(pan), wr = panR(pan);
  let prev = 0;
  for (let i = 0; i < total; i++) {
    const o = i0 + i; if (o < 0 || o >= N) continue;
    const t = i / SR;
    let n = Math.random() * 2 - 1;
    if (hp > 0) { const out = n - prev; prev = n; n = out * hp; }
    const v = n * Math.exp(-t / decay) * gain;
    L[o] += v * wl; R[o] += v * wr;
  }
}

// hand-clap: layered short bursts + snap body
function addClap(start, gain = 0.34) {
  [0, 0.010, 0.02, 0.038].forEach((offv, k) =>
    addNoise({ start: start + offv, len: 0.14, gain: gain * (k === 3 ? 1 : 0.5), hp: 0.7, decay: k === 3 ? 0.12 : 0.028, pan: 0.05 }));
}

// foot stomp: boomy low body + wood knock
function addStomp(start, gain = 0.9) {
  const i0 = Math.floor(start * SR), total = Math.ceil(0.4 * SR);
  let ph = 0;
  for (let i = 0; i < total; i++) {
    const o = i0 + i; if (o < 0 || o >= N) continue;
    const t = i / SR;
    const f = 78 * Math.exp(-t / 0.05) + 44;
    ph += 2 * Math.PI * f / SR;
    const body = Math.sin(ph) * Math.exp(-t / 0.16);
    const knock = t < 0.02 ? (Math.random() * 2 - 1) * Math.exp(-t / 0.008) * 0.35 : 0;
    const v = (body + knock) * gain;
    L[o] += v; R[o] += v;
  }
}

// tambourine: metallic jingle = bright bandpassy noise with fast decay
function addTamb(start, gain = 0.16, decay = 0.05) {
  const i0 = Math.floor(start * SR), total = Math.ceil(0.16 * SR);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < total; i++) {
    const o = i0 + i; if (o < 0 || o >= N) continue;
    const t = i / SR;
    let n = Math.random() * 2 - 1;
    const out = n - p1; p1 = n; // highpass
    const jingle = Math.sin(2 * Math.PI * 9000 * t) * 0.3 + Math.sin(2 * Math.PI * 6300 * t) * 0.2;
    const v = (out * 0.8 + jingle) * Math.exp(-t / decay) * gain;
    L[o] += v * panR(0.25); R[o] += v * panL(0.25);
  }
}

// whistle: sine + vibrato + tiny breath, soft attack/release
function addWhistle({ start, freq, dur, gain = 0.16, pan = 0 }) {
  const i0 = Math.floor(start * SR), rel = 0.08, total = Math.ceil((dur + rel) * SR);
  const wl = panL(pan), wr = panR(pan);
  let ph = 0;
  for (let i = 0; i < total; i++) {
    const o = i0 + i; if (o < 0 || o >= N) continue;
    const t = i / SR;
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t);
    ph += 2 * Math.PI * freq * vib / SR;
    let env;
    if (t < 0.05) env = t / 0.05;
    else if (t < dur) env = 1;
    else env = Math.max(0, 1 - (t - dur) / rel);
    const breath = (Math.random() * 2 - 1) * 0.02;
    const v = (Math.sin(ph) + 0.08 * Math.sin(ph * 2) + breath) * env * gain;
    L[o] += v * wl; R[o] += v * wr;
  }
}

// ── G-major folk progression I–V–vi–IV : G · D · Em · C ──────────────────────
const PROG = [
  { root: 43, notes: [55, 59, 62, 67] }, // G  (G2; G3 B3 D4 G4)
  { root: 38, notes: [50, 54, 57, 62] }, // D  (D2; D3 F#3 A3 D4)
  { root: 40, notes: [52, 55, 59, 64] }, // Em (E2; E3 G3 B3 E4)
  { root: 36, notes: [48, 52, 55, 60] }, // C  (C2; C3 E3 G3 C4)
];

const BARS = Math.floor(DUR / BAR);
function section(bar) {
  if (MODE === 'social') {
    if (bar < 1) return 'intro';
    if (bar < 8) return 'main';
    if (bar < 9) return 'mainB';
    return 'cta';
  }
  if (bar < 3) return 'intro';        // hook
  if (bar < 16) return 'light';       // imagine/missions/fun
  if (bar < 29) return 'main';        // reveal/build/join/play
  if (bar < 31) return 'break';       // "בלי שופטים"
  if (bar < 32) return 'rebuild';
  if (bar < 37) return 'audience';
  return 'cta';
}
const full = (s) => s === 'main' || s === 'audience' || s === 'cta' || s === 'rebuild';

// whistle hook (bar%4, beat, midi, lenBeats) — G major pentatonic, catchy
const HOOK = [
  [0, 0, 67, 1], [0, 1, 69, 1], [0, 2, 71, 1.5], [0, 3.5, 69, 0.5],
  [1, 0, 66, 1.5], [1, 2, 62, 1], [1, 3, 66, 1],
  [2, 0, 67, 1], [2, 1, 71, 1], [2, 2, 74, 2],
  [3, 0, 72, 1], [3, 1, 71, 1], [3, 2, 67, 2],
];

// down/up strum pattern within a bar (beat, up?)
const STRUM = [[0, false], [1, false], [1.5, true], [2, false], [2.5, true], [3, false], [3.5, true]];

for (let bar = 0; bar < BARS; bar++) {
  const sec = section(bar);
  const ch = PROG[bar % 4];
  const t0 = bar * BAR;
  const intro = sec === 'intro', brk = sec === 'break', light = sec === 'light';

  // ── acoustic guitar ──
  if (intro) {
    // gentle: one soft strum at the bar start + arpeggio
    ch.notes.forEach((m, k) => addPluck({ start: t0 + k * 0.11, freq: midi(m), gain: 0.28, dur: 1.6, pan: (k - 1.5) * 0.2, bright: 0.4 }));
  } else if (light) {
    // light strums on beats 1 & 3, softer
    strum(t0, ch.notes, { gain: 0.26, dur: 1.1, pan: -0.1 });
    strum(t0 + 2 * BEAT, ch.notes, { gain: 0.24, up: false, dur: 1.0, pan: -0.1 });
    strum(t0 + 3 * BEAT, ch.notes, { gain: 0.18, up: true, dur: 0.7, pan: -0.1 });
  } else if (brk) {
    strum(t0, ch.notes, { gain: 0.32, dur: 1.4, pan: -0.1 });
  } else {
    // full folk strum pattern
    for (const [beat, up] of STRUM) strum(t0 + beat * BEAT, ch.notes, { gain: up ? 0.22 : 0.34, up, dur: up ? 0.55 : 0.9, pan: -0.12 });
  }

  // ── acoustic bass (plucked low root, then fifth) ──
  if (!intro && !light) {
    addPluck({ start: t0, freq: midi(ch.root), gain: 0.5, dur: 1.0, pan: 0.05, decay: 0.992, bright: 0.3 });
    addPluck({ start: t0 + 2 * BEAT, freq: midi(ch.root + 7), gain: 0.42, dur: 0.9, pan: 0.05, decay: 0.992, bright: 0.3 });
    if (full(sec)) addPluck({ start: t0 + 3 * BEAT, freq: midi(ch.root), gain: 0.36, dur: 0.7, pan: 0.05, decay: 0.99, bright: 0.3 });
  } else if (light) {
    addPluck({ start: t0, freq: midi(ch.root), gain: 0.4, dur: 1.4, pan: 0.05, decay: 0.993, bright: 0.3 });
  }

  // ── stomps + claps (the "stomp-clap" engine) ──
  if (light) {
    addStomp(t0, 0.6); addStomp(t0 + 2 * BEAT, 0.55);
    addClap(t0 + 1 * BEAT, 0.22); addClap(t0 + 3 * BEAT, 0.22);
  } else if (full(sec)) {
    addStomp(t0, 0.95); addStomp(t0 + 2 * BEAT, 0.9);
    addClap(t0 + 1 * BEAT, 0.36); addClap(t0 + 3 * BEAT, 0.36);
    // tambourine on 8ths
    for (let h = 0; h < 8; h++) addTamb(t0 + h * (BEAT / 2), h % 2 ? 0.16 : 0.10, h % 2 ? 0.05 : 0.03);
  } else if (brk) {
    // breakdown: just stomps + claps, no guitar strums after the first
    addStomp(t0, 0.9); addStomp(t0 + 2 * BEAT, 0.9);
    addClap(t0 + 1 * BEAT, 0.4); addClap(t0 + 3 * BEAT, 0.4);
  }

  // ── whistle hook (main + cta) ──
  if (sec === 'main' || sec === 'cta') {
    for (const [b4, beat, m, len] of HOOK) {
      if (b4 !== bar % 4) continue;
      addWhistle({ start: t0 + beat * BEAT, freq: midi(m), dur: len * BEAT * 0.9, gain: 0.15, pan: 0.12 });
    }
  }

  // ── riser sweeps into big moments ──
  const risers = MODE === 'social' ? [0, 8] : [2, 15, 36];
  if (risers.includes(bar)) {
    const i0 = Math.floor(t0 * SR), tot = Math.floor(BAR * SR);
    let prev = 0;
    for (let i = 0; i < tot; i++) {
      const o = i0 + i; if (o >= N) break;
      const p = i / tot; let n = Math.random() * 2 - 1;
      const out = n - prev; prev = n; n = out * (0.4 + p * 0.6);
      const v = n * p * p * 0.14;
      L[o] += v; R[o] += v;
    }
  }
}

// final stomp+clap hit
addStomp(Math.min(BARS * BAR, DUR - 0.5), 1.0);
addClap(Math.min(BARS * BAR, DUR - 0.5), 0.5);

// ── light sidechain on stomp beats (glue) ──
(function sidechain() {
  const duck = new Float64Array(N).fill(1);
  for (let bar = 0; bar < BARS; bar++) {
    const s = section(bar); if (!full(s) && s !== 'light') continue;
    for (const beat of [0, 2]) {
      const i0 = Math.floor((bar * BAR + beat * BEAT) * SR), win = Math.floor(0.16 * SR);
      for (let i = 0; i < win; i++) { const o = i0 + i; if (o < 0 || o >= N) continue; const g = 0.72 + 0.28 * (i / win); if (g < duck[o]) duck[o] = g; }
    }
  }
  for (let i = 0; i < N; i++) { L[i] *= duck[i]; R[i] *= duck[i]; }
})();

// ── ping-pong delay (space on whistle/guitar) ──
(function delay() {
  const dt = Math.floor((BEAT * 0.75) * SR), fb = 0.28, wet = 0.13;
  for (let i = dt; i < N; i++) { L[i] += R[i - dt] * fb * wet; R[i] += L[i - dt] * fb * wet; }
})();

// ── master: DC block, soft clip, fades ──
let hpL = 0, hpR = 0, pxL = 0, pxR = 0;
const sc = (x) => Math.tanh(x * 1.05);
for (let i = 0; i < N; i++) {
  const oL = L[i] - pxL + 0.9985 * hpL; pxL = L[i]; hpL = oL;
  const oR = R[i] - pxR + 0.9985 * hpR; pxR = R[i]; hpR = oR;
  let a = sc(oL * 0.95), b = sc(oR * 0.95);
  const t = i / SR;
  if (t < 0.02) { a *= t / 0.02; b *= t / 0.02; }
  if (t > DUR - 0.6) { const f = clamp((DUR - t) / 0.6, 0, 1); a *= f; b *= f; }
  L[i] = a; R[i] = b;
}
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = peak > 0 ? Math.pow(10, -1.5 / 20) / peak : 1;

const dataLen = N * 4, out = process.argv[2] || 'out/music-hero.wav';
const bufOut = Buffer.alloc(44 + dataLen);
bufOut.write('RIFF', 0); bufOut.writeUInt32LE(36 + dataLen, 4); bufOut.write('WAVE', 8);
bufOut.write('fmt ', 12); bufOut.writeUInt32LE(16, 16); bufOut.writeUInt16LE(1, 20);
bufOut.writeUInt16LE(2, 22); bufOut.writeUInt32LE(SR, 24);
bufOut.writeUInt32LE(SR * 4, 28); bufOut.writeUInt16LE(4, 32); bufOut.writeUInt16LE(16, 34);
bufOut.write('data', 36); bufOut.writeUInt32LE(dataLen, 40);
let w = 44;
for (let i = 0; i < N; i++) {
  bufOut.writeInt16LE(clamp(Math.round(L[i] * norm * 32767), -32768, 32767), w); w += 2;
  bufOut.writeInt16LE(clamp(Math.round(R[i] * norm * 32767), -32768, 32767), w); w += 2;
}
fs.writeFileSync(out, bufOut);
console.log(`wrote ${out}  ${DUR}s  peak=${peak.toFixed(3)} norm=${norm.toFixed(3)}`);
