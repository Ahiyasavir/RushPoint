import React, { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { db, functions, auth } from '../src/services/firebase.config';
import { useGameStore } from '../src/store/gameStore';
import { Text } from '../src/components/Text';
import { Input } from '../src/components/Input';
import { Button } from '../src/components/Button';
import { useToast } from '../src/components/Toast';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { useTranslation } from '../src/i18n';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

export default function AccessCodeScreen() {
  const initTeam = useGameStore((s) => s.initTeam);
  const { show: showToast } = useToast();
  const { t } = useTranslation();

  const [code, setCode]         = useState('');
  const [codeError, setCodeError] = useState('');

  async function handleSubmit() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setCodeError(t('access.codeRequired'));
      return;
    }
    setCodeError('');

    const codeRef = doc(db, `artifacts/${APP_ID}/accessCodes/${trimmed}`);
    let codeSnap;

    try {
      codeSnap = await getDoc(codeRef);
    } catch (error) {
      console.error('Firestore error reading access code:', error);
      showToast(t('access.connError'), 'error');
      return;
    }

    if (!codeSnap.exists()) {
      showToast(t('access.invalidCode'), 'error');
      return;
    }

    const codeData = codeSnap.data() as { claimed: boolean; teamId?: string };

    if (codeData.claimed && codeData.teamId) {
      // Code already used — this is a second device joining the SAME team.
      // Anonymous auth gives this device a different uid, so it can't read the
      // team's owner-scoped data. joinTeam mints a custom token for the original
      // team uid; signing in with it makes this device the same account.
      try {
        const joinTeam = httpsCallable(functions, 'joinTeam');
        const res = await joinTeam({ code: trimmed });
        const { token, teamId, teamName, memberNames } =
          res.data as { token: string; teamId: string; teamName: string; memberNames: string[] };
        await signInWithCustomToken(auth, token);
        initTeam(teamId, teamName, memberNames ?? []);
        router.replace('/dashboard');
      } catch (error) {
        console.error('joinTeam failed:', error);
        showToast(t('access.connError'), 'error');
      }
      return;
    }

    // Unclaimed — send to registration, carry the code as a route param.
    router.push({ pathname: '/register', params: { code: trimmed } });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-app-bg"
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Language toggle ───────────────────────────────────────────── */}
        <View className="flex-row justify-end mt-12">
          <LanguageToggle />
        </View>

        {/* ── Branding ──────────────────────────────────────────────────── */}
        <View className="mt-10 mb-14">
          <Text variant="label" className="text-zinc-500 mb-2 tracking-widest uppercase text-xs">
            {t('brand.tagline')}
          </Text>
          <Text variant="display" className="font-brand text-white leading-none">Rush</Text>
          <Text variant="display" className="font-brand text-neon-green leading-none animate-pulse-neon">
            Point
          </Text>
          <View className="w-16 h-px bg-neon-green mt-3 mb-4" style={{ opacity: 0.4 }} />
          <Text variant="bodySmall" className="text-zinc-500 leading-relaxed">
            {t('access.intro')}
          </Text>
        </View>

        {/* ── Code input ────────────────────────────────────────────────── */}
        <Input
          label={t('access.codeLabel')}
          value={code}
          onChangeText={(v) => { setCode(v); setCodeError(''); }}
          placeholder={t('access.codePlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          error={codeError}
          className="mb-6"
        />

        <Button onPress={handleSubmit} fullWidth size="lg">
          {t('access.enter')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
