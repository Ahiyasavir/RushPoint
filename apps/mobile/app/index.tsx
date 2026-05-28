import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '../src/services/firebase.config';
import { useGameStore } from '../src/store/gameStore';

export default function IndexScreen() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch {
          // sign-in failure — onAuthStateChanged re-fires after recovery
        }
        return;
      }

      // Read store state at callback time (not via hook closure) to avoid
      // stale captures when auth fires before a re-render.
      const { teamId } = useGameStore.getState();
      router.replace(teamId ? '/dashboard' : '/access-code');
    });

    return unsub;
  }, []);

  return (
    <View className="flex-1 bg-app-bg items-center justify-center">
      <View
        style={{
          width: 48, height: 48, borderRadius: 24,
          backgroundColor: 'rgba(0,255,170,0.08)',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color="#00ffaa" />
      </View>
    </View>
  );
}
