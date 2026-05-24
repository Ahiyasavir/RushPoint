import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTeamStore } from '../store/teamStore';
import type { Slot } from '@rushpoint/shared';

const SLOT_COLORS: Record<string, string> = {
  green: '#22c55e',
  orange: '#f97316',
  gold: '#eab308',
};

function SlotCard({ slot }: { slot: Slot }) {
  const color = SLOT_COLORS[slot.type];
  const isCompleted = slot.status === 'completed';
  const isActive = slot.status === 'active';

  return (
    <View style={[
      styles.slot,
      { borderColor: color },
      isCompleted && { backgroundColor: color + '33' },
      isActive && { backgroundColor: color + '22', borderWidth: 2 },
    ]}>
      <View style={[styles.slotDot, { backgroundColor: isCompleted ? color : '#333' }]} />
      <Text style={[styles.slotLabel, { color: isCompleted || isActive ? color : '#555' }]}>
        {isCompleted ? 'Done' : isActive ? 'Active' : `Slot ${slot.index + 1}`}
      </Text>
    </View>
  );
}

export default function DashboardScreen() {
  const team = useTeamStore((s) => s.team);

  if (!team) return null;

  const greenSlots = team.slots.slice(0, 4);
  const orangeSlot = team.slots[4];
  const goldSlots = team.slots.slice(5, 8);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.teamName}>{team.name}</Text>
      <Text style={styles.score}>{team.score} pts</Text>

      <Text style={styles.sectionLabel}>Open Field Missions</Text>
      <View style={styles.grid}>
        {greenSlots.map((slot) => <SlotCard key={slot.index} slot={slot} />)}
      </View>

      <Text style={styles.sectionLabel}>Find the Tene</Text>
      <View style={styles.grid}>
        <SlotCard slot={orangeSlot} />
      </View>

      <Text style={styles.sectionLabel}>Fill the Basket</Text>
      <View style={styles.grid}>
        {goldSlots.map((slot) => <SlotCard key={slot.index} slot={slot} />)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, paddingBottom: 48 },
  teamName: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 4 },
  score: { fontSize: 18, color: '#888', marginBottom: 32 },
  sectionLabel: { fontSize: 13, color: '#555', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
  slot: {
    width: '47%', aspectRatio: 1.4, borderRadius: 12, borderWidth: 1, borderColor: '#333',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  slotDot: { width: 12, height: 12, borderRadius: 6 },
  slotLabel: { fontSize: 12, fontWeight: '600' },
});
