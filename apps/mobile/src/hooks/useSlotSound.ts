import { useEffect, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import type { SlotType } from '../store/gameStore';

// Drop sound files into assets/sounds/ with these exact names.
// If a file is missing the hook silently skips — never crashes the app.
const SOUND_MAP: Record<SlotType, any> = {
  green:  require('../../assets/sounds/unlock_green.mp3'),
  orange: require('../../assets/sounds/unlock_orange.mp3'),
  gold:   require('../../assets/sounds/unlock_gold.mp3'),
};

export function useSlotSound() {
  const soundRef = useRef<Audio.Sound | null>(null);

  // Keep audio session non-interrupting so field music keeps playing
  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
    }).catch(() => {});

    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const playUnlock = useCallback(async (type: SlotType) => {
    try {
      // Unload any previous sound to free memory immediately
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(SOUND_MAP[type], {
        shouldPlay: true,
        volume: 0.75,
      });
      soundRef.current = sound;

      // Auto-unload after playback to avoid leaking native resources
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      });
    } catch {
      // Missing file or device audio error — fail silently
    }
  }, []);

  return { playUnlock };
}
