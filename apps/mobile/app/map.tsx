import React from 'react';
import { View, ScrollView, Image, Pressable, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { useTranslation } from '../src/i18n';
import { buildStaticMapUrl } from '../src/data/stations';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();

  // Static map sized to the screen (capped for the Mapbox API limits).
  const mapW = Math.min(Math.round(width - 32), 1280);
  const mapH = Math.round(mapW * 0.66);

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
        {MAPBOX_TOKEN ? (
          <Image
            source={{ uri: buildStaticMapUrl(MAPBOX_TOKEN, mapW, mapH) }}
            style={{ width: mapW, height: mapH, borderRadius: 16, borderColor: 'rgba(0,255,170,0.15)', borderWidth: 1 }}
            resizeMode="cover"
            accessibilityLabel={t('map.title')}
          />
        ) : (
          <Card className="p-6 items-center justify-center h-80 border border-glass-border">
            <Text variant="bodySmall" className="text-zinc-500 text-center">
              {t('map.noToken')}
            </Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
