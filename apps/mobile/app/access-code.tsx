import React, { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../src/services/firebase.config';
import { useGameStore } from '../src/store/gameStore';
import { Text } from '../src/components/Text';
import { Input } from '../src/components/Input';
import { Button } from '../src/components/Button';
import { useToast } from '../src/components/Toast';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';

export default function AccessCodeScreen() {
  const initTeam = useGameStore((s) => s.initTeam);
  const { show: showToast } = useToast();

  const [code, setCode]         = useState('');
  const [codeError, setCodeError] = useState('');

  async function handleSubmit() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setCodeError('Please enter your access code.');
      return;
    }
    setCodeError('');

    const codeRef = doc(db, `artifacts/${APP_ID}/accessCodes/${trimmed}`);
    let codeSnap;
    try {
      codeSnap = await getDoc(codeRef);
    } catch {
      showToast('שגיאת חיבור — נסה שוב', 'error');
      return;
    }

    if (!codeSnap.exists()) {
      showToast('קוד גישה שגוי', 'error');
      return;
    }

    const codeData = codeSnap.data() as { claimed: boolean; teamId?: string };

    if (codeData.claimed && codeData.teamId) {
      // Code already used — load the existing team and go straight to dashboard.
      try {
        const teamRef  = doc(db, `artifacts/${APP_ID}/users/${codeData.teamId}/profile/team`);
        const teamSnap = await getDoc(teamRef);
        if (teamSnap.exists()) {
          const t = teamSnap.data() as { name: string; memberNames: string[] };
          initTeam(codeData.teamId, t.name, t.memberNames ?? []);
        }
      } catch {
        // Non-fatal: still navigate; dashboard will surface any Firestore error.
      }
      router.replace('/dashboard');
      return;
    }

    // Unclaimed — send to registration, carry the code as a route param.
    router.push({ pathname: '/register', params: { code: trimmed } });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-zinc-950"
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Branding ──────────────────────────────────────────────────── */}
        <View className="mt-24 mb-14">
          <Text variant="label" className="text-zinc-600 mb-1">
            הַמִּרוּץ לְצִיּוֹן
          </Text>
          <Text variant="display">Rush</Text>
          <Text variant="display" className="text-emerald-400">Point</Text>
          <Text variant="bodySmall" className="text-zinc-500 mt-3 leading-relaxed">
            Enter your event access code to begin the race.
          </Text>
        </View>

        {/* ── Code input ────────────────────────────────────────────────── */}
        <Input
          label="Access Code"
          value={code}
          onChangeText={(v) => { setCode(v); setCodeError(''); }}
          placeholder="e.g. LION01"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          error={codeError}
          className="mb-6"
        />

        <Button onPress={handleSubmit} fullWidth>
          Enter Event →
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
