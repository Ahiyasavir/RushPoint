import React, { useState } from 'react';
import { View, Image as RNImage, Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import {
  fitRouteView,
  projectToPixel,
  routePathFor,
  STATION_COLOR,
  type RaceConfig,
} from '@rushpoint/shared';
import { Text } from './Text';
import { buildTopoTiles } from '../data/topoTiles';
import { framePoints } from '../data/stations';
import { type MapStation } from '../hooks/useRaceConfig';

interface Coords { lat: number; lng: number }

interface Props {
  width: number;
  height: number;
  config: RaceConfig;
  stations: MapStation[];
  coords: Coords | null;
  label?: string;
}

const pctToPx = (pct: number, total: number) => (pct / 100) * total;

/**
 * One map tile. On WEB we use react-native's <Image> (renders a plain <img>) —
 * expo-image's web build relies on disk caching that fails under browser sandbox
 * constraints, which left the map a black screen. On NATIVE we use expo-image
 * with memory+disk cache so tiles loaded at the start survive the Arazim-valley
 * dead zones. `onReady` flips the skeleton off once the first tile paints.
 */
function Tile({ uri, style, onReady }: { uri: string; style: object; onReady: () => void }) {
  if (Platform.OS === 'web') {
    return <RNImage source={{ uri }} style={style} resizeMode="cover" onLoad={onReady} />;
  }
  return (
    <ExpoImage
      source={{ uri }}
      style={style}
      cachePolicy="memory-disk"
      contentFit="cover"
      onLoad={onReady}
    />
  );
}

/**
 * Keyless topographic mission map: OpenTopoMap raster tiles composed into the
 * viewport, with the route line, station markers, and the live "You Are Here"
 * dot drawn on top. No MapTiler key and no GL dependency — works on web + native.
 * Markers/dot use the same projectToPixel frame as the tiles, so they align.
 */
export function TopoMap({ width, height, config, stations, coords, label }: Props) {
  const [ready, setReady] = useState(false);
  const view = fitRouteView(width, height, framePoints(config, stations));
  const tiles = buildTopoTiles(width, height, view);

  // Route polyline as rotated View segments (no react-native-svg available).
  const routePx = routePathFor(config).map((p) => {
    const pr = projectToPixel(p.lat, p.lng, width, height, view);
    return { x: pctToPx(pr.leftPct, width), y: pctToPx(pr.topPct, height) };
  });
  const segments = routePx.slice(1).map((p2, i) => {
    const p1 = routePx[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return { key: i, midX: (p1.x + p2.x) / 2, midY: (p1.y + p2.y) / 2, len, angle };
  });

  // Markers: start / finish / gate + every visible station, projected.
  const markers = [
    { lat: config.start.lat, lng: config.start.lng, color: '#39FF14', ring: true },
    { lat: config.finish.lat, lng: config.finish.lng, color: '#FFD700', ring: true },
    { lat: config.gate.lat, lng: config.gate.lng, color: '#00F0FF', ring: false },
    ...stations.map((s) => ({ lat: s.lat, lng: s.lng, color: STATION_COLOR[s.type], ring: false })),
  ].map((m) => ({ ...m, p: projectToPixel(m.lat, m.lng, width, height, view) }));

  const me = coords ? projectToPixel(coords.lat, coords.lng, width, height, view) : null;

  return (
    <View
      style={{
        width,
        height,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: 'rgba(57,255,20,0.25)',
        overflow: 'hidden',
        backgroundColor: '#0b1220',
      }}
    >
      {/* Base tiles */}
      {tiles.map((tile) => (
        <Tile
          key={tile.key}
          uri={tile.url}
          onReady={() => setReady(true)}
          style={{
            position: 'absolute',
            left: tile.left,
            top: tile.top,
            width: Math.ceil(tile.size) + 1,
            height: Math.ceil(tile.size) + 1,
          }}
        />
      ))}

      {/* Skeleton loader — pulsing grid until the first tile paints */}
      {!ready && (
        <View
          className="animate-pulse-neon"
          pointerEvents="none"
          style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1220' }}
        >
          <Text className="text-5xl mb-2">🗺️</Text>
          <Text variant="caption" className="text-neon-green/70 font-mono tracking-widest">LOADING TERRAIN…</Text>
        </View>
      )}

      {/* Route line */}
      {segments.map((s) => (
        <View
          key={s.key}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: s.midX - s.len / 2,
            top: s.midY - 2,
            width: s.len,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#39FF14',
            opacity: 0.9,
            transform: [{ rotate: `${s.angle}deg` }],
          }}
        />
      ))}

      {/* Station / start / finish / gate markers */}
      {markers.map((m, i) =>
        m.p.inBounds ? (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${m.p.leftPct}%`,
              top: `${m.p.topPct}%`,
              marginLeft: -7,
              marginTop: -7,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: m.color,
              borderWidth: m.ring ? 3 : 2,
              borderColor: '#ffffff',
              shadowColor: m.color,
              shadowOpacity: 0.9,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
              elevation: 6,
            }}
          />
        ) : null,
      )}

      {/* "You Are Here" — live GPS dot */}
      {me?.inBounds && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${me.leftPct}%`,
            top: `${me.topPct}%`,
            marginLeft: -9,
            marginTop: -9,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#00F0FF',
            borderWidth: 3,
            borderColor: '#ffffff',
            shadowColor: '#00F0FF',
            shadowOpacity: 0.9,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
            elevation: 6,
          }}
        />
      )}

      {/* Off-map hint */}
      {coords && !me?.inBounds && (
        <View className="absolute bottom-2 left-2 right-2 items-center">
          <Text variant="caption" className="text-zinc-200 bg-app-surface/80 px-2 py-1 rounded-md">
            {label}
          </Text>
        </View>
      )}

      {/* Attribution (OpenTopoMap CC-BY-SA / OSM) */}
      <View pointerEvents="none" style={{ position: 'absolute', right: 4, bottom: 3 }}>
        <Text style={{ fontSize: 9, color: '#9ca3af' }}>© OpenTopoMap (CC-BY-SA) · OSM</Text>
      </View>
    </View>
  );
}
