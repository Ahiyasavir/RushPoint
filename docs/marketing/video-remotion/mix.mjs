// Mix the Hebrew VO lines over the music bed with sidechain-style ducking.
// Usage: node mix.mjs  (expects out/music-hero2.wav + vo/wav/<id>.wav)
import fs from 'fs';

const SR = 48000;
const DUR = 76.7;
const N = Math.floor(SR * DUR);

// VO placements (seconds) — aligned to the scene timeline in HeroCut.tsx
const PLACEMENTS = [
  { id: 'hook', at: 0.3 },
  { id: 'imagine', at: 4.9 },
  { id: 'missions', at: 12.0 },
  { id: 'fun', at: 21.4 },
  { id: 'meet', at: 29.6 },
  { id: 'build', at: 36.4 },
  { id: 'join', at: 43.0 },
  { id: 'auto', at: 47.8 },
  { id: 'audience', at: 58.9 },
  { id: 'cta', at: 68.0 },
];

const MUSIC_BASE = 0.72;  // music gain outside VO
const MUSIC_DUCK = 0.26;  // music gain under VO
const VO_GAIN = 1.9;      // edge-tts output is quiet; boosted then re-normalized

function readWav(path) {
  const b = fs.readFileSync(path);
  // minimal RIFF parse: find 'data' chunk, assume 16-bit PCM
  let off = 12;
  let fmt = { channels: 2, sampleRate: SR };
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt.channels = b.readUInt16LE(off + 10);
      fmt.sampleRate = b.readUInt32LE(off + 12);
    } else if (id === 'data') {
      const nS = size / (2 * fmt.channels);
      const L = new Float64Array(nS), R = new Float64Array(nS);
      let p = off + 8;
      for (let i = 0; i < nS; i++) {
        const l = b.readInt16LE(p) / 32768; p += 2;
        const r = fmt.channels > 1 ? b.readInt16LE(p) / 32768 : l;
        if (fmt.channels > 1) p += 2;
        L[i] = l; R[i] = r;
      }
      return { L, R, sampleRate: fmt.sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in ' + path);
}

const music = readWav('out/music-hero2.wav');
if (music.sampleRate !== SR) throw new Error('music SR mismatch');

const L = new Float64Array(N), R = new Float64Array(N);
for (let i = 0; i < N; i++) {
  L[i] = (music.L[i] ?? 0);
  R[i] = (music.R[i] ?? 0);
}

// duck envelope
const duck = new Float64Array(N).fill(MUSIC_BASE);
const ATT = Math.floor(0.14 * SR), REL = Math.floor(0.38 * SR);
const voSegs = [];
for (const pl of PLACEMENTS) {
  const wav = readWav(`vo/wav/${pl.id}.wav`);
  if (wav.sampleRate !== SR) throw new Error(`VO SR mismatch ${pl.id}: ${wav.sampleRate}`);
  voSegs.push({ ...pl, wav });
  const s0 = Math.floor(pl.at * SR);
  const s1 = s0 + wav.L.length;
  for (let i = Math.max(0, s0 - ATT); i < Math.min(N, s1 + REL); i++) {
    let g;
    if (i < s0) g = MUSIC_BASE - (MUSIC_BASE - MUSIC_DUCK) * ((i - (s0 - ATT)) / ATT);
    else if (i < s1) g = MUSIC_DUCK;
    else g = MUSIC_DUCK + (MUSIC_BASE - MUSIC_DUCK) * ((i - s1) / REL);
    if (g < duck[i]) duck[i] = g;
  }
}
for (let i = 0; i < N; i++) { L[i] *= duck[i]; R[i] *= duck[i]; }

// add VO (center)
for (const seg of voSegs) {
  const s0 = Math.floor(seg.at * SR);
  for (let i = 0; i < seg.wav.L.length; i++) {
    const idx = s0 + i; if (idx >= N) break;
    const v = ((seg.wav.L[i] + seg.wav.R[i]) / 2) * VO_GAIN;
    L[idx] += v; R[idx] += v;
  }
  const end = seg.at + seg.wav.L.length / SR;
  console.log(`${seg.id.padEnd(9)} ${seg.at.toFixed(2)}s → ${end.toFixed(2)}s`);
}

// soft limit + normalize to -1.2 dBFS
const softclip = (x) => Math.tanh(x);
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = softclip(L[i]); R[i] = softclip(R[i]); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = Math.pow(10, -1.2 / 20) / peak;

const dataLen = N * 4;
const buf = Buffer.alloc(44 + dataLen);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
let off = 44;
const clamp = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(clamp(L[i] * norm), off); off += 2;
  buf.writeInt16LE(clamp(R[i] * norm), off); off += 2;
}
fs.writeFileSync('out/audio-hero-final.wav', buf);
console.log(`wrote out/audio-hero-final.wav  peak=${peak.toFixed(3)} norm=${norm.toFixed(3)}`);
