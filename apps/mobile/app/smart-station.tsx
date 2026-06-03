import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, ActivityIndicator, Pressable, Image, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { SmartStationConfig } from '@rushpoint/shared';
import { functions, storage, auth } from '../src/services/firebase.config';
import { useGameStore } from '../src/store/gameStore';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { useToast } from '../src/components/Toast';
import { useTranslation } from '../src/i18n';

// The slot mirrors a client-safe `smart` config from the task doc onto the
// active slot. We read it straight off gameState (no extra Firestore round-trip).
type SlotWithSmart = { index: number; taskId?: string; taskTitle?: string; smart?: SmartStationConfig };

// Which step the play screen is currently showing.
type Phase = 'intro' | 'play' | 'success' | 'failure' | 'pending';

// A flag defaults to ON when it is absent (per the contract).
function flag(v: boolean | undefined): boolean {
  return v !== false;
}

export default function SmartStationScreen() {
  const insets = useSafeAreaInsets();
  const { t, isRtl } = useTranslation();
  const { show } = useToast();
  const live = useGameStore((s) => s.live);

  // Read the active slot + its smart config from the live mirror.
  const activeSlot = useMemo(
    () => (live?.slots.find((s) => s.status === 'active') as SlotWithSmart | undefined) ?? null,
    [live?.slots],
  );
  const smart = activeSlot?.smart ?? null;
  const taskId = activeSlot?.taskId ?? null;

  // Start on the intro screen when enabled, otherwise jump straight into play.
  const [phase, setPhase] = useState<Phase>(() =>
    flag(smart?.showIntroScreen) ? 'intro' : 'play',
  );

  // code_verification
  const [code, setCode] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Brute-force cooldown: lock the field for 60s after 3 consecutive wrong codes.
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const locked = lockedUntil != null && now < lockedUntil.getTime();
  const lockSecondsLeft = locked ? Math.ceil((lockedUntil!.getTime() - now) / 1000) : 0;

  // Tick once per second while locked so the countdown updates; auto-reset on expiry.
  useEffect(() => {
    if (lockedUntil == null) return;
    const id = setInterval(() => {
      const ts = Date.now();
      if (ts >= lockedUntil.getTime()) {
        setLockedUntil(null);
        setWrongAttempts(0);
        clearInterval(id);
      }
      setNow(ts);
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  // photo_upload
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Loading / guards ──────────────────────────────────────────────────────
  if (!live) {
    return (
      <View className="flex-1 bg-app-bg items-center justify-center">
        <ActivityIndicator color="#F59E0B" />
        <Text variant="bodySmall" className="text-zinc-500 mt-3">{t('station.loading')}</Text>
      </View>
    );
  }

  if (!smart || !smart.enabled || !taskId) {
    return (
      <View className="flex-1 bg-app-bg" style={{ paddingTop: insets.top + 8 }}>
        <Header onBack={() => router.back()} backLabel={t('map.back')} title={t('station.title')} />
        <View className="flex-1 px-5 pt-6">
          <Card className="p-6 items-center">
            <Text variant="bodySmall" className="text-zinc-400 text-center">{t('station.noConfig')}</Text>
          </Card>
        </View>
      </View>
    );
  }

  const longInstructions = isRtl
    ? (smart.longInstructionsHe ?? smart.longInstructions)
    : smart.longInstructions;
  const attemptLimit = smart.attemptLimit && smart.attemptLimit > 0 ? smart.attemptLimit : null;
  const attemptsLeft = attemptLimit != null ? Math.max(0, attemptLimit - attempts) : null;

  // ── Code verification ───────────────────────────────────────────────────
  async function submitCode() {
    if (!taskId || !code.trim() || submitting || locked) return;
    setSubmitting(true);
    try {
      const fn = httpsCallable<{ taskId: string; code: string }, { correct: boolean; completed: boolean }>(
        functions,
        'submitStationCode',
      );
      const { data } = await fn({ taskId, code: code.trim() });
      if (data.correct && data.completed) {
        setWrongAttempts(0);
        setPhase('success');
      } else {
        setAttempts((n) => n + 1);
        setCode('');
        const nextWrong = wrongAttempts + 1;
        setWrongAttempts(nextWrong);
        if (nextWrong >= 3) {
          setLockedUntil(new Date(Date.now() + 60_000));
          setNow(Date.now());
        } else if (flag(smart!.showFailureScreen)) {
          setPhase('failure');
        } else {
          show(t('station.wrongCode'), 'error');
        }
      }
    } catch {
      show(t('station.codeError'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Photo upload ──────────────────────────────────────────────────────────
  async function pickPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        show(t('station.permissionDenied'), 'error');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch {
      show(t('station.uploadError'), 'error');
    }
  }

  async function submitPhoto() {
    if (!taskId || !photoUri || busy) return;
    setBusy(true);
    try {
      const uid = auth.currentUser?.uid ?? 'anon';
      const path = `stationPhotos/${taskId}/${uid}-${Date.now()}`;
      const resp = await fetch(photoUri);
      const blob = await resp.blob();
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, blob);
      const photoUrl = await getDownloadURL(fileRef);
      const fn = httpsCallable<{ taskId: string; photoUrl?: string }, { success: boolean; submissionId: string }>(
        functions,
        'requestStationReview',
      );
      await fn({ taskId, photoUrl });
      setPhase('pending');
    } catch {
      show(t('station.uploadError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ── Manual judge ───────────────────────────────────────────────────────────
  async function markReady() {
    if (!taskId || busy) return;
    setBusy(true);
    try {
      const fn = httpsCallable<{ taskId: string }, { success: boolean; submissionId: string }>(
        functions,
        'requestStationReview',
      );
      await fn({ taskId });
      setPhase('pending');
    } catch {
      show(t('station.reviewError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ── Success / failure / pending screens ─────────────────────────────────────
  if (phase === 'success') {
    return (
      <Outcome
        emoji="🎉"
        color="text-neon-green"
        title={t('station.successTitle')}
        body={t('station.successBody')}
        cta={t('station.successBack')}
        onCta={() => router.replace('/dashboard')}
      />
    );
  }

  if (phase === 'pending') {
    const canRetry = flag(smart.allowRetry);
    return (
      <Outcome
        emoji="⏳"
        color="text-neon-blue"
        title={t('station.pendingTitle')}
        body={t('station.pendingBody')}
        cta={t('station.pendingBack')}
        onCta={() => router.replace('/dashboard')}
        secondaryCta={canRetry ? t('station.retry') : undefined}
        onSecondary={canRetry ? () => { setPhotoUri(null); setPhase('play'); } : undefined}
      />
    );
  }

  if (phase === 'failure') {
    const outOfAttempts = attemptsLeft != null && attemptsLeft <= 0;
    return (
      <Outcome
        emoji="❌"
        color="text-neon-red"
        title={t('station.failTitle')}
        body={outOfAttempts ? t('station.noAttempts') : t('station.failBody')}
        cta={outOfAttempts ? t('station.pendingBack') : t('station.retry')}
        onCta={() => (outOfAttempts ? router.replace('/dashboard') : setPhase('play'))}
      />
    );
  }

  // ── Intro screen ─────────────────────────────────────────────────────────
  if (phase === 'intro') {
    const mediaUrl = smart.mediaUrl;
    return (
      <View className="flex-1 bg-app-bg" style={{ paddingTop: insets.top + 8 }}>
        <Header onBack={() => router.back()} backLabel={t('map.back')} title={t('station.title')} />
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-6 pb-16">
          <Text variant="heading" className="text-neon-gold mb-4">
            {activeSlot?.taskTitle ?? t('station.title')}
          </Text>

          {smart.imageUrl ? (
            <Image
              source={{ uri: smart.imageUrl }}
              className="w-full h-48 rounded-2xl mb-4"
              resizeMode="cover"
            />
          ) : null}

          {longInstructions ? (
            <Card className="p-5 mb-4">
              <Text variant="body" className="text-white leading-relaxed">{longInstructions}</Text>
            </Card>
          ) : null}

          {smart.extraInfo ? (
            <Card className="p-4 mb-4 border border-neon-blue/30 bg-neon-blue/5">
              <Text variant="label" className="text-neon-blue mb-1">ℹ️ {t('station.extraInfoLabel')}</Text>
              <Text variant="bodySmall" className="text-zinc-300 leading-relaxed">{smart.extraInfo}</Text>
            </Card>
          ) : null}

          {mediaUrl ? (
            <Pressable onPress={() => void Linking.openURL(mediaUrl)} className="mb-6">
              <Text variant="bodySmall" className="text-neon-cyan">{t('station.viewMedia')}</Text>
            </Pressable>
          ) : null}

          <Button onPress={() => setPhase('play')} fullWidth>{t('station.start')}</Button>
        </ScrollView>
      </View>
    );
  }

  // ── Play screen — branches by verification type ─────────────────────────────
  return (
    <View className="flex-1 bg-app-bg" style={{ paddingTop: insets.top + 8 }}>
      <Header onBack={() => router.back()} backLabel={t('map.back')} title={t('station.title')} />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-6 pb-16">
        <Text variant="heading" className="text-neon-gold mb-4">
          {activeSlot?.taskTitle ?? t('station.title')}
        </Text>

        {smart.verificationType === 'code_verification' && (
          <Card glowColor="gold" className="p-5">
            <Text variant="subheading" className="text-white mb-3">{t('station.codeTitle')}</Text>
            <Input
              label={smart.codeInputLabel ?? t('station.codeDefaultLabel')}
              value={code}
              onChangeText={setCode}
              placeholder={t('station.codePlaceholder')}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting && !locked && (attemptsLeft == null || attemptsLeft > 0)}
              className="mb-3"
            />
            {locked && (
              <View className="mb-3 p-3 rounded-2xl border border-neon-red/40 bg-neon-red/10">
                <Text variant="caption" className="text-neon-red font-semibold text-start">
                  {t('station.tooManyAttempts')}
                </Text>
                <Text variant="caption" className="text-neon-red mt-1 text-start">
                  {t('station.tryAgainIn', { seconds: lockSecondsLeft })}
                </Text>
              </View>
            )}
            {attemptsLeft != null && (
              <Text variant="caption" className={`mb-3 ${attemptsLeft <= 1 ? 'text-neon-red' : 'text-zinc-500'}`}>
                {attemptsLeft > 0 ? t('station.attemptsLeft', { n: attemptsLeft }) : t('station.noAttempts')}
              </Text>
            )}
            <Button
              onPress={submitCode}
              disabled={!code.trim() || submitting || locked || (attemptsLeft != null && attemptsLeft <= 0)}
              loading={submitting}
              fullWidth
            >
              {submitting ? t('station.checking') : t('station.submit')}
            </Button>
          </Card>
        )}

        {smart.verificationType === 'photo_upload' && (
          <Card glowColor="gold" className="p-5">
            <Text variant="subheading" className="text-white mb-2">{t('station.photoTitle')}</Text>
            <Text variant="bodySmall" className="text-zinc-400 mb-4 leading-relaxed">{t('station.photoIntro')}</Text>

            {photoUri ? (
              <Image source={{ uri: photoUri }} className="w-full h-56 rounded-2xl mb-4" resizeMode="cover" />
            ) : null}

            <Pressable
              onPress={() => void pickPhoto()}
              disabled={busy}
              className="mb-4 py-3 rounded-2xl border border-neon-gold/40 bg-neon-gold/10 items-center active:opacity-70"
            >
              <Text variant="bodySmall" className="text-neon-gold font-semibold">
                {photoUri ? t('station.retakePhoto') : t('station.choosePhoto')}
              </Text>
            </Pressable>

            <Button onPress={submitPhoto} disabled={!photoUri || busy} loading={busy} fullWidth>
              {busy ? t('station.uploading') : t('station.submitForReview')}
            </Button>
          </Card>
        )}

        {smart.verificationType === 'manual_judge' && (
          <Card glowColor="gold" className="p-5">
            <Text variant="subheading" className="text-white mb-2">{t('station.manualTitle')}</Text>
            <Text variant="bodySmall" className="text-zinc-400 mb-5 leading-relaxed">{t('station.manualIntro')}</Text>
            <Button onPress={markReady} disabled={busy} loading={busy} fullWidth>
              {t('station.markReady')}
            </Button>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Shared sub-components ─────────────────────────────────────────────────────

function Header({ onBack, backLabel, title }: { onBack: () => void; backLabel: string; title: string }) {
  return (
    <View className="px-5 pb-4 border-b border-zinc-800 flex-row items-center justify-between">
      <Pressable onPress={onBack} hitSlop={8}>
        <Text variant="caption" className="text-neon-green">{backLabel}</Text>
      </Pressable>
      <Text variant="caption" className="text-zinc-500">{title}</Text>
    </View>
  );
}

function Outcome({
  emoji, color, title, body, cta, onCta, secondaryCta, onSecondary,
}: {
  emoji: string;
  color: string;
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
  secondaryCta?: string;
  onSecondary?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-app-bg items-center justify-center px-8" style={{ paddingTop: insets.top }}>
      <Text className="text-6xl mb-5">{emoji}</Text>
      <Text variant="heading" className={`${color} text-center mb-2`}>{title}</Text>
      <Text variant="bodySmall" className="text-zinc-400 text-center leading-relaxed mb-8">{body}</Text>
      <View className="w-full gap-3">
        <Button onPress={onCta} fullWidth>{cta}</Button>
        {secondaryCta && onSecondary ? (
          <Button onPress={onSecondary} variant="secondary" fullWidth>{secondaryCta}</Button>
        ) : null}
      </View>
    </View>
  );
}
