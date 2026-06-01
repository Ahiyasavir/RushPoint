import React from 'react';
import { View, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../src/components/Text';
import { TopoMap } from '../src/components/TopoMap';
import { useTranslation } from '../src/i18n';
import { useDeviceLocation } from '../src/hooks/useDeviceLocation';
import { useRaceConfig } from '../src/hooks/useRaceConfig';
import { useGameStore } from '../src/store/gameStore';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();

  // Map sized to the screen.
  const mapW = Math.min(Math.round(width - 32), 1280);
  const mapH = Math.round(mapW * 0.66);

  // Live race geography (editable in the admin Race Builder) → drives the map
  // frame and the GPS-dot projection.
  const { config, stations } = useRaceConfig();

  // Progressive reveal: the map only shows the stations the team has unlocked, so
  // they can't "scout ahead". Granularity is per station TYPE (the mission map
  // markers carry no per-task id) — green field stations are always shown; the
  // orange Tene-finding stations appear once the team reaches the basket leg; the
  // gold crafting/judge stations appear only once the 20-min clock has started.
  const live = useGameStore((s) => s.live);
  const activeType = live?.slots?.find((s) => s.status === 'active')?.type ?? null;
  const craftingStarted = live?.craftingStartedAt != null;
  const reachedBasket = craftingStarted || activeType === 'orange' || activeType === 'gold';
  const visibleStations = live
    ? stations.filter((s) =>
        s.type === 'green' ||
        (s.type === 'orange' && reachedBasket) ||
        (s.type === 'gold' && craftingStarted),
      )
    : stations; // no live state yet (e.g. opened map before sync) → show all

  // Live device location → projected onto the map frame so the "You Are Here"
  // dot lines up (TopoMap uses the same frame internally).
  const coords = useDeviceLocation(true);

  return (
    <View className="flex-1 bg-app-bg">
      <View className="px-5 pb-4" style={{ paddingTop: insets.top + 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodySmall" className="text-neon-green">{t('map.back')}</Text>
        </Pressable>
        <Text variant="heading" className="mt-2">{t('map.title')}</Text>
        <Text variant="bodySmall" className="text-zinc-500 mt-1">{t('map.subtitle')}</Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-16">
        {/* Keyless topographic map (OpenTopoMap tiles + route + markers + GPS dot). */}
        <TopoMap
          width={mapW}
          height={mapH}
          config={config}
          stations={visibleStations}
          coords={coords}
          label={t('map.offMap')}
        />

        {coords && (
          <Text variant="caption" className="text-zinc-600 mt-3 text-center">
            📍 {t('map.youAreHere')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
