import React, { useState } from 'react';
import {
  View, ScrollView, KeyboardAvoidingView, Platform,
  Pressable, Switch,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../src/services/firebase.config';
import { useGameStore } from '../src/store/gameStore';
import { Text } from '../src/components/Text';
import { Input } from '../src/components/Input';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { useToast } from '../src/components/Toast';
import { useTranslation } from '../src/i18n';
import { WAIVER_VERSION } from './waiver';

interface Participant {
  name: string;
  age: string;
}

type FormErrors = Partial<{
  teamName:     string;
  captainPhone: string;
  participants: string;
  waiver:       string;
}>;

const registerTeam = httpsCallable(functions, 'registerTeam');

// Team-size rules (event constraint): min 4, max 7 participants.
const MIN_PARTICIPANTS = 4;
const MAX_PARTICIPANTS = 7;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const initTeam      = useGameStore((s) => s.initTeam);
  const { show: showToast } = useToast();
  const { t } = useTranslation();

  const [teamName,       setTeamName]       = useState('');
  const [captainPhone,   setCaptainPhone]   = useState('');
  const [participants,   setParticipants]   = useState<Participant[]>(
    Array.from({ length: MIN_PARTICIPANTS }, () => ({ name: '', age: '' })),
  );
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [errors,         setErrors]         = useState<FormErrors>({});

  // ── Participant helpers ──────────────────────────────────────────────────────

  function addParticipant() {
    setParticipants((prev) =>
      prev.length >= MAX_PARTICIPANTS ? prev : [...prev, { name: '', age: '' }],
    );
  }

  function removeParticipant(i: number) {
    if (participants.length <= 1) return;
    setParticipants((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateParticipant(i: number, field: keyof Participant, value: string) {
    setParticipants((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)),
    );
    if (field === 'name') setErrors((e) => ({ ...e, participants: undefined }));
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: FormErrors = {};

    if (!teamName.trim())
      errs.teamName = t('register.errTeamName');

    if (!captainPhone.trim())
      errs.captainPhone = t('register.errPhone');

    const filledParticipants = participants.filter((p) => p.name.trim());
    if (filledParticipants.length < MIN_PARTICIPANTS)
      errs.participants = t('register.errMinParticipants', { min: MIN_PARTICIPANTS });
    else if (filledParticipants.length > MAX_PARTICIPANTS)
      errs.participants = t('register.errMaxParticipants', { max: MAX_PARTICIPANTS });

    if (!waiverAccepted)
      errs.waiver = t('register.errWaiver');

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!validate()) return;

    const validParticipants = participants.filter((p) => p.name.trim());
    const memberNames       = validParticipants.map((p) => p.name.trim());

    // The server-side registerTeam function authoritatively claims the access
    // code, writes the profile, and seeds the initial gameState with the Admin SDK.
    try {
      const res = await registerTeam({
        code,
        teamName:       teamName.trim(),
        captainPhone:   captainPhone.trim(),
        participants:   validParticipants,
        waiverAccepted: true,
        waiverVersion:  WAIVER_VERSION,
      });
      const { teamId } = res.data as { teamId: string };
      initTeam(teamId, teamName.trim(), memberNames);
      router.replace('/dashboard');
    } catch (err) {
      const message =
        (err as { message?: string }).message ?? t('register.errSubmit');
      showToast(message, 'error');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-app-bg"
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-14 pb-20"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="mb-8">
          <View className="flex-row items-center gap-2 mb-3">
            <View className="px-2.5 py-1 rounded-full bg-neon-green/10 border border-neon-green/20">
              <Text variant="caption" className="text-neon-green font-mono tracking-widest">
                {code}
              </Text>
            </View>
            <Text variant="caption" className="text-zinc-600">{t('register.codeLabel', { code: '' }).trim()}</Text>
          </View>
          <Text variant="heading">{t('register.title')}</Text>
          <Text variant="bodySmall" className="text-zinc-500 mt-1">
            {t('register.subtitle')}
          </Text>
        </View>

        {/* ── Team Name ─────────────────────────────────────────────────── */}
        <Input
          label={t('register.teamName')}
          value={teamName}
          onChangeText={(v) => { setTeamName(v); setErrors((e) => ({ ...e, teamName: undefined })); }}
          placeholder={t('register.teamNamePlaceholder')}
          maxLength={40}
          autoCapitalize="words"
          error={errors.teamName}
          className="mb-5"
        />

        {/* ── Captain Phone ─────────────────────────────────────────────── */}
        <Input
          label={t('register.captainPhone')}
          value={captainPhone}
          onChangeText={(v) => { setCaptainPhone(v); setErrors((e) => ({ ...e, captainPhone: undefined })); }}
          placeholder="+972 50 000 0000"
          keyboardType="phone-pad"
          error={errors.captainPhone}
          className="mb-6"
        />

        {/* ── Participants ──────────────────────────────────────────────── */}
        <Text variant="label" className="mb-1">{t('register.participants')}</Text>
        <Text variant="caption" className="text-zinc-600 mb-3">
          {t('register.teamSizeHint', { min: MIN_PARTICIPANTS, max: MAX_PARTICIPANTS })}
        </Text>

        {participants.map((p, i) => (
          <View key={i} className="flex-row gap-2 mb-3 items-start">
            <Input
              value={p.name}
              onChangeText={(v) => updateParticipant(i, 'name', v)}
              placeholder={t('register.namePlaceholder', { n: i + 1 })}
              maxLength={30}
              autoCapitalize="words"
              className="flex-1"
            />
            <Input
              value={p.age}
              onChangeText={(v) => updateParticipant(i, 'age', v)}
              placeholder={t('register.age')}
              keyboardType="number-pad"
              maxLength={3}
              className="w-20"
            />
            {participants.length > 1 && (
              <Pressable
                onPress={() => removeParticipant(i)}
                className="w-10 h-[52px] rounded-xl bg-app-raised border border-glass-border items-center justify-center active:bg-app-card"
              >
                <Text variant="subheading" className="text-zinc-400 leading-none">×</Text>
              </Pressable>
            )}
          </View>
        ))}

        {errors.participants ? (
          <Text variant="caption" className="text-red-400 mb-2">{errors.participants}</Text>
        ) : null}

        <View className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onPress={addParticipant}
            disabled={participants.length >= MAX_PARTICIPANTS}
          >
            {t('register.addParticipant')}
          </Button>
        </View>

        {/* ── Liability Waiver ──────────────────────────────────────────── */}
        <Card className="p-4 mb-2">
          <Text variant="label" className="mb-2">{t('register.waiverTitle')}</Text>
          <Text variant="caption" className="text-zinc-400 leading-relaxed mb-3">
            {t('register.waiverBody')}
          </Text>
          <Pressable onPress={() => router.push('/waiver')} className="mb-4 active:opacity-70">
            <Text variant="bodySmall" className="text-neon-green">
              {t('register.waiverReadFull')}
            </Text>
          </Pressable>
          <View className="flex-row items-center justify-between">
            <Text variant="bodySmall" className="text-zinc-300 flex-1 me-4">
              {t('register.waiverAccept')}
            </Text>
            <Switch
              value={waiverAccepted}
              onValueChange={(v) => { setWaiverAccepted(v); setErrors((e) => ({ ...e, waiver: undefined })); }}
              trackColor={{ false: '#1e293b', true: '#F59E0B' }}
              thumbColor={waiverAccepted ? '#0B0F17' : '#52525b'}
            />
          </View>
        </Card>

        {errors.waiver ? (
          <Text variant="caption" className="text-red-400 mb-4">{errors.waiver}</Text>
        ) : <View className="mb-4" />}

        {/* ── Submit ────────────────────────────────────────────────────── */}
        <Button onPress={handleSubmit} fullWidth disabled={!waiverAccepted}>
          {t('register.start')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
