import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { useGameStore } from '../src/store/gameStore';
import '../../src/services/firebase.config'; // ensure Firebase is initialized

/**
 * Auth gate — runs once on app start.
 * - If no Firebase user: sign in anonymously (no UI needed in Phase 1)
 * - If team already init'd (teamId in store): go straight to dashboard
 * - Otherwise: go to register screen to enter team name + members
 */
export default function IndexScreen() {
  const teamId = useGameStore((s) => s.teamId);
  const auth   = getAuth();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch {
          // Auth failure — still let the user register; retry happens on next mount
        }
      }

      if (teamId) {
        router.replace('/dashboard');
      } else {
        router.replace('/register');
      }
    });

    return unsub;
  }, []);

  return (
    <View className="flex-1 bg-app-bg items-center justify-center">
      <ActivityIndicator size="large" color="#22c55e" />
    </View>
  );
}
