import React from 'react';
import { View, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Text } from '../src/components/Text';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { useTranslation } from '../src/i18n';

// Bump this string whenever the waiver wording changes. The accepted version is
// recorded with the team profile (registerTeam) so we know which terms each team
// agreed to — important for a real event's dispute/consent trail.
export const WAIVER_VERSION = '2026.1';
export const WAIVER_UPDATED = '2026-06-01';

// Section keys rendered in order. Each maps to `<key>Title` / `<key>Body` in i18n.
const SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;

/**
 * Formal, full-text participation waiver & terms. Reachable from the registration
 * screen ("read the full waiver") and rendered as a standalone scrollable
 * document so participants can actually read what the accept toggle commits to.
 *
 * NOTE: the body text is a clearly-marked TEMPLATE — replace each section in
 * src/i18n with organizer-approved legal wording before the live event.
 */
export default function WaiverScreen() {
  const { t } = useTranslation();

  return (
    <View className="flex-1 bg-app-bg">
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-14 pb-10">
        <Text variant="heading">{t('waiver.docTitle')}</Text>
        <Text variant="caption" className="text-zinc-500 mt-1 mb-4">
          {t('waiver.lastUpdated', { v: WAIVER_VERSION, date: WAIVER_UPDATED })}
        </Text>

        <Card className="p-3 mb-6 border-amber-500/30 bg-amber-500/5">
          <Text variant="caption" className="text-amber-300 leading-relaxed">
            {t('waiver.placeholderNotice')}
          </Text>
        </Card>

        {SECTIONS.map((s) => (
          <View key={s} className="mb-5">
            <Text variant="label" className="mb-1.5">{t(`waiver.${s}Title`)}</Text>
            <Text variant="bodySmall" className="text-zinc-400 leading-relaxed">
              {t(`waiver.${s}Body`)}
            </Text>
          </View>
        ))}

        <View className="mt-2">
          <Button variant="ghost" fullWidth onPress={() => router.back()}>
            {t('waiver.back')}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
