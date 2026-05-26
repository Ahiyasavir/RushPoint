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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const initTeam      = useGameStore((s) => s.initTeam);
  const { show: showToast } = useToast();

  const [teamName,       setTeamName]       = useState('');
  const [captainPhone,   setCaptainPhone]   = useState('');
  const [participants,   setParticipants]   = useState<Participant[]>([{ name: '', age: '' }]);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [errors,         setErrors]         = useState<FormErrors>({});

  // ── Participant helpers ──────────────────────────────────────────────────────

  function addParticipant() {
    setParticipants((prev) => [...prev, { name: '', age: '' }]);
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
      errs.teamName = 'Team name is required.';

    if (!captainPhone.trim())
      errs.captainPhone = "Captain's phone number is required.";

    const filledParticipants = participants.filter((p) => p.name.trim());
    if (filledParticipants.length < 1)
      errs.participants = 'Add at least one participant name.';

    if (!waiverAccepted)
      errs.waiver = 'You must accept the waiver to continue.';

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
      });
      const { teamId } = res.data as { teamId: string };
      initTeam(teamId, teamName.trim(), memberNames);
      router.replace('/dashboard');
    } catch (err) {
      const message =
        (err as { message?: string }).message ??
        'Registration failed — check your connection and try again.';
      showToast(message, 'error');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-zinc-950"
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-14 pb-20"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="mb-8">
          <Text variant="label" className="text-emerald-600 mb-1">Code: {code}</Text>
          <Text variant="heading">Register Your Team</Text>
          <Text variant="bodySmall" className="text-zinc-500 mt-1">
            Fill in the details below to begin the race.
          </Text>
        </View>

        {/* ── Team Name ─────────────────────────────────────────────────── */}
        <Input
          label="Team Name"
          value={teamName}
          onChangeText={(v) => { setTeamName(v); setErrors((e) => ({ ...e, teamName: undefined })); }}
          placeholder="e.g. The Lions"
          maxLength={40}
          autoCapitalize="words"
          error={errors.teamName}
          className="mb-5"
        />

        {/* ── Captain Phone ─────────────────────────────────────────────── */}
        <Input
          label="Captain's Phone Number"
          value={captainPhone}
          onChangeText={(v) => { setCaptainPhone(v); setErrors((e) => ({ ...e, captainPhone: undefined })); }}
          placeholder="+972 50 000 0000"
          keyboardType="phone-pad"
          error={errors.captainPhone}
          className="mb-6"
        />

        {/* ── Participants ──────────────────────────────────────────────── */}
        <Text variant="label" className="mb-3">Participants</Text>

        {participants.map((p, i) => (
          <View key={i} className="flex-row gap-2 mb-3 items-start">
            <Input
              value={p.name}
              onChangeText={(v) => updateParticipant(i, 'name', v)}
              placeholder={`Name ${i + 1}`}
              maxLength={30}
              autoCapitalize="words"
              className="flex-1"
            />
            <Input
              value={p.age}
              onChangeText={(v) => updateParticipant(i, 'age', v)}
              placeholder="Age"
              keyboardType="number-pad"
              maxLength={3}
              className="w-20"
            />
            {participants.length > 1 && (
              <Pressable
                onPress={() => removeParticipant(i)}
                className="w-10 h-[52px] rounded-xl bg-zinc-800 items-center justify-center"
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
          <Button variant="ghost" size="sm" onPress={addParticipant}>
            + Add Participant
          </Button>
        </View>

        {/* ── Liability Waiver ──────────────────────────────────────────── */}
        <Card className="p-4 mb-2">
          <Text variant="label" className="mb-2">Liability & Health Waiver</Text>
          <Text variant="caption" className="text-zinc-400 leading-relaxed mb-4">
            I confirm all participants are in good health and fit to participate in
            this physical outdoor activity. I release the organizers from any liability
            for personal injuries or accidents during the event.
          </Text>
          <View className="flex-row items-center justify-between">
            <Text variant="bodySmall" className="text-zinc-300 flex-1 mr-4">
              I accept all terms and conditions
            </Text>
            <Switch
              value={waiverAccepted}
              onValueChange={(v) => { setWaiverAccepted(v); setErrors((e) => ({ ...e, waiver: undefined })); }}
              trackColor={{ false: '#3f3f46', true: '#10b981' }}
              thumbColor={waiverAccepted ? '#ffffff' : '#71717a'}
            />
          </View>
        </Card>

        {errors.waiver ? (
          <Text variant="caption" className="text-red-400 mb-4">{errors.waiver}</Text>
        ) : <View className="mb-4" />}

        {/* ── Submit ────────────────────────────────────────────────────── */}
        <Button onPress={handleSubmit} fullWidth disabled={!waiverAccepted}>
          Start the Race →
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
