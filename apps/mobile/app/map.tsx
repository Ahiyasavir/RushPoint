import React from 'react';
import { View, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fitRouteView, projectToPixel } from '@rushpoint/shared';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { useTranslation } from '../src/i18n';
import { useDeviceLocation } from '../src/hooks/useDeviceLocation';
import { useRaceConfig } from '../src/hooks/useRaceConfig';
import { useGameStore } from '../src/store/gameStore';
import { buildStaticMapUrl, framePoints } from '../src/data/stations';

const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();

  // Static map sized to the screen (capped for the static API limits).
  const mapW = Math.min(Math.round(width - 32), 1280);
  const mapH = Math.round(mapW * 0.66);

  // Live race geography (editable in the admin Race Builder) → drives both the
  // static-map URL and the GPS-dot projection frame.
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

  // Live device location → projected onto the static map's known frame so the
  // "You Are Here" dot lines up. Same (mapW, mapH) AND same frame points as the URL.
  const coords = useDeviceLocation(!!MAPTILER_KEY);
  const view = fitRouteView(mapW, mapH, framePoints(config, visibleStations));
  const me = coords ? projectToPixel(coords.lat, coords.lng, mapW, mapH, view) : null;

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
        {MAPTILER_KEY ? (
          <View style={{ width: mapW, height: mapH }}>
            {/* expo-image caches to memory+disk: once the map loads at the start
                (signal at Motza), it survives the Arazim-valley dead zones. */}
            <Image
              source={{ uri: buildStaticMapUrl(MAPTILER_KEY, mapW, mapH, config, visibleStations) }}
              style={{ width: mapW, height: mapH, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,255,170,0.15)' }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
              accessibilityLabel={t('map.title')}
            />

            {/* "You Are Here" — live GPS dot, only when within the framed area. */}
            {me?.inBounds && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: `${me.leftPct}%`,
                  top: `${me.topPct}%`,
                  marginLeft: -9,
                  marginTop: -9,
                }}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: '#1d9bf0',
                    borderWidth: 3,
                    borderColor: '#ffffff',
                    shadowColor: '#1d9bf0',
                    shadowOpacity: 0.8,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 6,
                  }}
                />
              </View>
            )}

            {coords && !me?.inBounds && (
              <View className="absolute bottom-2 left-2 right-2 items-center">
                <Text variant="caption" className="text-zinc-300 bg-app-surface/80 px-2 py-1 rounded-md">
                  {t('map.offMap')}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <Card className="p-6 items-center justify-center h-80 border border-glass-border">
            <Text variant="bodySmall" className="text-zinc-500 text-center">
              {t('map.noToken')}
            </Text>
          </Card>
        )}

        {coords && (
          <Text variant="caption" className="text-zinc-600 mt-3 text-center">
            📍 {t('map.youAreHere')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
