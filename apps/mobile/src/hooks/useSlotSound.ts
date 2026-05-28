import { useCallback, useRef } from 'react';
import type { SlotType } from '../store/gameStore';

// Distinct two-note chimes per slot tier. Synthesised with the Web Audio API
// so the demo needs zero binary assets and never breaks the Metro bundle.
// On native (no window.AudioContext) every call is a silent no-op.
const CHIME: Record<SlotType, number[]> = {
  green:  [523.25, 783.99], // C5 → G5
  gate:   [440.0,  880.0],  // A4 → A5 (octave jump for drama)
  orange: [587.33, 880.0],  // D5 → A5
  gold:   [659.25, 987.77], // E5 → B5
};

type AudioCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export function useSlotSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const playUnlock = useCallback((type: SlotType) => {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return; // native / unsupported — silent

    try {
      const ctx = ctxRef.current ?? (ctxRef.current = new Ctor());
      // Browsers start the context suspended until a user gesture.
      if (ctx.state === 'suspended') void ctx.resume();

      const notes = CHIME[type];
      const now = ctx.currentTime;
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + i * 0.12;
        const end = start + 0.22;

        osc.type = 'sine';
        osc.frequency.value = freq;
        // Short pluck envelope to avoid clicks.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(end);
      });
    } catch {
      // Audio unavailable / autoplay blocked — fail silently.
    }
  }, []);

  return { playUnlock };
}
