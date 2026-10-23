/// <reference types="vite/client" />

// zzfx ships plain JS with no types (used by lib/setupSounds.ts).
declare module 'zzfx' {
  export function zzfx(...parameters: (number | undefined)[]): AudioBufferSourceNode;
  export const ZZFX: { volume: number; sampleRate: number; audioContext: AudioContext };
}
