import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { useGameStore } from '../src/store/gameStore';

const MAX_MEMBERS = 8;
const MIN_MEMBERS = 2;

export default function RegisterScreen() {
  const initTeam = useGameStore((s) => s.initTeam);
  const auth     = getAuth();

  const [teamName, setTeamName] = useState('');
  const [members, setMembers]   = useState(['', '']);
  const [error, setError]       = useState('');

  function addMember() {
    if (members.length < MAX_MEMBERS) setMembers([...members, '']);
  }

  function removeMember(i: number) {
    if (members.length <= MIN_MEMBERS) return;
    setMembers(members.filter((_, idx) => idx !== i));
  }

  function updateMember(i: number, value: string) {
    setMembers(members.map((m, idx) => (idx === i ? value : m)));
  }

  function handleStart() {
    const trimmedName    = teamName.trim();
    const trimmedMembers = members.map((m) => m.trim()).filter(Boolean);

    if (!trimmedName) {
      setError('Enter a team name.');
      return;
    }
    if (trimmedMembers.length < MIN_MEMBERS) {
      setError(`Add at least ${MIN_MEMBERS} team members.`);
      return;
    }

    const uid = auth.currentUser?.uid ?? `local-${Date.now()}`;
    initTeam(uid, trimmedName, trimmedMembers);
    router.replace('/dashboard');
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-app-bg"
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-16 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / Title */}
        <View className="mb-10">
          <Text className="text-zinc-500 text-sm tracking-[0.2em] uppercase mb-1">
            הַמִּרוּץ לְצִיּוֹן
          </Text>
          <Text className="text-white text-4xl font-black tracking-tight leading-tight">
            Rush{'\n'}
            <Text className="text-emerald-400">Point</Text>
          </Text>
          <Text className="text-zinc-500 text-sm mt-3 leading-relaxed">
            Register your team to begin the adventure.
          </Text>
        </View>

        {/* Team Name */}
        <Text className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-2">
          Team Name
        </Text>
        <TextInput
          value={teamName}
          onChangeText={(v) => { setTeamName(v); setError(''); }}
          placeholder="e.g. The Lions"
          placeholderTextColor="#3f3f46"
          className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white text-base mb-6"
          maxLength={30}
          autoCapitalize="words"
        />

        {/* Members */}
        <Text className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-3">
          Team Members ({members.length}/{MAX_MEMBERS})
        </Text>

        {members.map((name, i) => (
          <View key={i} className="flex-row items-center gap-2 mb-2.5">
            <TextInput
              value={name}
              onChangeText={(v) => { updateMember(i, v); setError(''); }}
              placeholder={`Member ${i + 1}`}
              placeholderTextColor="#3f3f46"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm"
              maxLength={30}
              autoCapitalize="words"
            />
            {members.length > MIN_MEMBERS && (
              <Pressable
                onPress={() => removeMember(i)}
                className="w-9 h-9 rounded-full bg-zinc-800 items-center justify-center"
              >
                <Text className="text-zinc-400 text-lg leading-none">×</Text>
              </Pressable>
            )}
          </View>
        ))}

        {members.length < MAX_MEMBERS && (
          <Pressable onPress={addMember} className="mt-1 mb-6">
            <Text className="text-emerald-500 text-sm font-semibold">+ Add member</Text>
          </Pressable>
        )}

        {/* Error */}
        {error ? (
          <Text className="text-red-400 text-sm mb-4">{error}</Text>
        ) : null}

        {/* CTA */}
        <Pressable
          onPress={handleStart}
          className="bg-emerald-500 active:bg-emerald-600 rounded-2xl py-4 items-center mt-2"
          style={{ shadowColor: '#22c55e', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 10 }}
        >
          <Text className="text-white text-base font-bold tracking-wide">
            Start the Adventure →
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
