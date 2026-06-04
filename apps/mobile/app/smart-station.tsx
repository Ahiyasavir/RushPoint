import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { getOneShotLocation } from '../src/hooks/oneShotLocation';

// The slot mirrors a client-safe `smart` config from the task doc onto the
// active slot. We read it straight off gameState (no extra Firestore round-trip).
type SlotWithSmart = { index: number; taskId?: string; taskTitle?: string; smart?: SmartStationConfig };

// Which step the play screen is currently showing.
type Phase = 'intro' | 'play' | 'success' | 'failure' | 'pending';

// A flag defaults to ON when it is absent (per the contract).
function flag(v: boolean | undefined): boolean {
  return v !== false;
}

// Great-circle distance between two GPS points, in metres.
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Whole metres below 1 km, one-decimal km above.
function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

// A server validation error the player can act on (vs a transient network error).
// These carry a `details.code` set by the submitStationCode callable.
function validationCode(err: unknown): 'location-required' | 'too-far' | null {
  const c = (err as { details?: { code?: string } })?.details?.code;
  return c === 'location-required' || c === 'too-far' ? c : null;
}

// True for transient network/latency failures that are safe to retry (offline,
// timeout, server unavailable, or a raw fetch error with no Firebase code). A
// definite server-logic error (unauthenticated/invalid-argument/…) is NOT retried,
// so we never loop forever on a real rejection.
function isRetriableError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (!code) return true; // raw fetch/timeout error → treat as network
  return /(?:^|\/)(unavailable|deadline-exceeded|internal|cancelled|unknown|aborted)$/.test(code);
}

export default function SmartStationScreen() {
  const insets = useSafeAreaInsets();
  const { t, isRtl } = useTranslation();
  const { show } = useToast();
  const live = useGameStore((s) => s.live);
  const isOnline = useGameStore((s) => s.isOnline);
  const pending = useGameStore((s) => s.pendingStationSubmission);
  const setPending = useGameStore((s) => s.setPendingStationSubmission);

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
  // Synchronous re-entry guard: `submitting` state updates on the next render, so a
  // second tap fired during the pre-submit GPS await (geofenced stations) would slip
  // past the state check and trigger a duplicate request. This ref blocks it instantly.
  const submitInFlight = useRef(false);
  // Offline/latency queue: a non-null `pending` (in the store) drives the "will retry
  // when connected" banner and survives navigation; `retryTick` bumps on each failed
  // network attempt to re-arm the backoff timer.
  const [retryTick, setRetryTick] = useState(0);
  const queued = pending != null;

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

  // ── Live distance to a geofenced station ──────────────────────────────────
  // Once the play phase starts, sample the device GPS every 5s and show how far
  // the team is from the station (haversine). Only geofenced stations carry
  // stationCoords, so non-geofenced stations never trigger a location prompt.
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const stationCoords = smart?.stationCoords;
  const geofenceRadius = smart?.geofenceRadiusMeters;
  const showDistance =
    phase === 'play' && !!stationCoords && typeof geofenceRadius === 'number' && geofenceRadius > 0;
  useEffect(() => {
    if (!showDistance || !stationCoords) return;
    let cancelled = false;
    const sample = async () => {
      const coords = await getOneShotLocation();
      if (cancelled || !coords) return;
      setDistanceMeters(haversineMeters(coords, stationCoords));
    };
    void sample();
    const id = setInterval(() => void sample(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showDistance, stationCoords?.lat, stationCoords?.lng]);

  // ── Offline/latency auto-retry ─────────────────────────────────────────────
  // A queued submission retries with exponential backoff while online; going
  // offline parks the timer (effect returns early) and reconnecting re-runs the
  // effect to schedule the next attempt. runSubmission is reached through a ref so
  // the effect (declared here, above the guards, to satisfy the Rules of Hooks)
  // always calls the latest closure without re-subscribing every render.
  const runRef = useRef<(p: { taskId: string; code: string; lat?: number; lng?: number }) => void>(() => {});
  useEffect(() => {
    if (!pending || !isOnline) return;
    const delay = Math.min(30_000, 1500 * 2 ** Math.min(retryTick, 5));
    const id = setTimeout(() => { void runRef.current(pending); }, delay);
    return () => clearTimeout(id);
  }, [pending, isOnline, retryTick]);

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
  // Runs one submission round-trip. A transient network/latency failure does NOT
  // surface a raw rejection: the submission is parked in the store and re-tried
  // automatically (see the retry effect below). Only real validation results —
  // wrong code, too-far, location-required — are shown to the player. The server
  // is idempotent on (taskId, completed slot), so a retry can never double-complete.
  async function runSubmission(params: { taskId: string; code: string; lat?: number; lng?: number }) {
    setSubmitting(true);
    try {
      const fn = httpsCallable<
        { taskId: string; code: string; lat?: number; lng?: number },
        { correct: boolean; completed: boolean }
      >(functions, 'submitStationCode');
      const { data } = await fn(params);
      // Round-trip succeeded — clear any queued retry, then act on the real result.
      setPending(null);
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
    } catch (err) {
      const vc = validationCode(err);
      if (vc === 'location-required') {
        setPending(null);
        show(t('station.locationRequired'), 'error');
      } else if (vc === 'too-far') {
        setPending(null);
        const details = (err as { details?: { distanceMetres?: number; radiusMetres?: number } })?.details;
        show(
          t('station.tooFar', {
            distance: details?.distanceMetres ?? 0,
            radius: details?.radiusMetres ?? 0,
          }),
          'error',
        );
      } else if (isRetriableError(err)) {
        // Transient network/latency error: queue + auto-retry, never a raw rejection.
        setPending(params);
        setRetryTick((n) => n + 1);
      } else {
        setPending(null);
        show(t('station.codeError'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCode() {
    if (!taskId || !code.trim() || submitting || submitInFlight.current || locked) return;
    submitInFlight.current = true;
    try {
      // Geofenced stations need a GPS fix; request a one-shot position. Non-geofenced
      // stations never trigger a location prompt. A denied/unavailable fix leaves
      // lat/lng undefined — the server then returns 'location-required' if it enforces.
      let coords: { lat: number; lng: number } | null = null;
      const radius = smart!.geofenceRadiusMeters;
      if (typeof radius === 'number' && radius > 0) {
        coords = await getOneShotLocation();
      }
      await runSubmission({ taskId, code: code.trim(), lat: coords?.lat, lng: coords?.lng });
    } finally {
      submitInFlight.current = false;
    }
  }

  // Keep the retry timer (declared above the guards to satisfy the Rules of Hooks)
  // pointed at the latest closure without re-subscribing on every render.
  runRef.current = runSubmission;

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
              editable={!submitting && !queued && !locked && (attemptsLeft == null || attemptsLeft > 0)}
              className="mb-3"
            />
            {showDistance && distanceMeters != null && (
              <Text variant="caption" className="text-zinc-400 mb-3 text-start">
                📍 {t('station.distanceAway', { dist: `~${formatDistance(distanceMeters)}` })}
              </Text>
            )}
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
            {queued && (
              <View className="mb-3 p-3 rounded-2xl border border-neon-blue/40 bg-neon-blue/10 flex-row items-center gap-2">
                <ActivityIndicator color="#60A5FA" size="small" />
                <Text variant="caption" className="text-neon-blue flex-1 text-start">
                  {isOnline ? t('station.retrying') : t('station.queued')}
                </Text>
              </View>
            )}
            <Button
              onPress={submitCode}
              disabled={!code.trim() || submitting || queued || locked || (attemptsLeft != null && attemptsLeft <= 0)}
              loading={submitting || queued}
              fullWidth
            >
              {submitting || queued ? t('station.checking') : t('station.submit')}
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

        {smart.hintCount != null && smart.hintCount > 0 && (
          <HintSection
            taskId={taskId}
            hintCount={Math.floor(smart.hintCount)}
            disabled={locked || submitting || busy}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Shared sub-components ─────────────────────────────────────────────────────

// Pay-per-hint: each hint is a locked card with a two-step confirm. On confirm we
// call requestStationHint (server charges 25 pts once per index, idempotently) and
// keep the revealed text in local state for the rest of the session.
function HintSection({ taskId, hintCount, disabled }: { taskId: string; hintCount: number; disabled: boolean }) {
  const { t, isRtl } = useTranslation();
  const { show } = useToast();
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [armed, setArmed] = useState<number | null>(null);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  async function reveal(i: number) {
    setBusyIndex(i);
    try {
      const fn = httpsCallable<
        { taskId: string; hintIndex: number; lang: string },
        { hintText: string; hintsUsed: number[]; hintCount: number }
      >(functions, 'requestStationHint');
      const { data } = await fn({ taskId, hintIndex: i, lang: isRtl ? 'he' : 'en' });
      setRevealed((r) => ({ ...r, [i]: data.hintText }));
    } catch {
      show(t('station.hint.error'), 'error');
    } finally {
      setBusyIndex(null);
      setArmed(null);
    }
  }

  return (
    <Card className="p-5 mt-4">
      <Text variant="subheading" className="text-white mb-3">💡 {t('station.hint.title')}</Text>
      <View className="gap-2">
        {Array.from({ length: hintCount }).map((_, i) => {
          const text = revealed[i];
          if (text !== undefined) {
            return (
              <View key={i} className="p-3 rounded-2xl border border-neon-gold/30 bg-neon-gold/5">
                <Text variant="caption" className="text-neon-gold mb-1 text-start">{t('station.hint.revealed', { n: i + 1 })}</Text>
                <Text variant="bodySmall" className="text-white text-start leading-relaxed">{text}</Text>
              </View>
            );
          }
          const isArmed = armed === i;
          const isBusy = busyIndex === i;
          return (
            <View key={i} className="p-3 rounded-2xl border border-zinc-800 bg-zinc-900/40">
              {!isArmed ? (
                <Pressable
                  onPress={() => setArmed(i)}
                  disabled={disabled || busyIndex !== null}
                  className="flex-row items-center justify-between active:opacity-70"
                >
                  <Text variant="bodySmall" className="text-zinc-300 text-start">🔒 {t('station.hint.reveal', { n: i + 1 })}</Text>
                  <Text variant="caption" className="text-zinc-600">{t('station.hint.cost')}</Text>
                </Pressable>
              ) : (
                <View className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => void reveal(i)}
                    disabled={isBusy}
                    className="flex-1 py-2 rounded-xl bg-neon-gold/10 border border-neon-gold/30 items-center active:bg-neon-gold/20"
                  >
                    <Text variant="bodySmall" className="text-neon-gold font-semibold">{isBusy ? '…' : t('station.hint.confirm')}</Text>
                  </Pressable>
                  <Pressable onPress={() => setArmed(null)} hitSlop={6} className="px-3 py-2">
                    <Text variant="caption" className="text-zinc-500">{t('station.hint.cancel')}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

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
