import React, { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Text } from './Text';
import { useTranslation } from '../i18n';
import type { Announcement, AnnouncementLevel } from '@rushpoint/shared';

const STORAGE_KEY = 'rushpoint.dismissedAnnouncements';

const LEVEL_STYLE: Record<AnnouncementLevel, { bg: string; border: string; text: string; glow: string; icon: string }> = {
  info:     { bg: 'rgba(0,170,255,0.12)',  border: 'rgba(0,170,255,0.45)',  text: 'text-neon-blue',   glow: '#00aaff', icon: 'ℹ️' },
  warning:  { bg: 'rgba(255,170,0,0.12)',  border: 'rgba(255,170,0,0.5)',   text: 'text-neon-gold',   glow: '#ffaa00', icon: '⚠️' },
  critical: { bg: 'rgba(255,61,0,0.15)',   border: 'rgba(255,61,0,0.6)',    text: 'text-neon-red',    glow: '#FF0055', icon: '🚨' },
};

function readDismissed(): Set<string> {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const raw = ls?.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* storage unavailable */ }
  return new Set();
}

function persistDismissed(ids: Set<string>): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    ls?.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch { /* storage unavailable */ }
}

/**
 * Persistent, high-priority operational banner pinned to the top of the dashboard.
 * Shows the most severe active announcement the team hasn't dismissed on THIS
 * device. Critical announcements outrank warning outrank info; dismissal is
 * per-device (localStorage) and sticks per announcement id.
 */
export function AnnouncementBanner({ announcements }: { announcements: Announcement[] }) {
  const { isRtl } = useTranslation();
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [pulse]);

  const severity: Record<AnnouncementLevel, number> = { critical: 3, warning: 2, info: 1 };
  const visible = announcements
    .filter((a) => !dismissed.has(a.id))
    .sort((a, b) => severity[b.level] - severity[a.level])[0];

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: pulse.value,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  }));

  if (!visible) return null;

  const style = LEVEL_STYLE[visible.level] ?? LEVEL_STYLE.info;
  const text = isRtl ? (visible.messageHe ?? visible.message) : visible.message;

  function dismiss() {
    const next = new Set(dismissed);
    next.add(visible.id);
    setDismissed(next);
    persistDismissed(next);
  }

  return (
    <Animated.View
      style={[glowStyle, { backgroundColor: style.bg, borderColor: style.border, borderBottomWidth: 1, shadowColor: style.glow }]}
      className="w-full px-4 py-3 flex-row items-center gap-3"
    >
      <Text className="text-lg">{style.icon}</Text>
      <Text variant="bodySmall" className={`flex-1 font-semibold ${style.text}`} numberOfLines={3}>
        {text}
      </Text>
      <Pressable onPress={dismiss} hitSlop={8} className="px-2 py-1 rounded-lg active:opacity-60">
        <Text variant="caption" className="text-zinc-400">✕</Text>
      </Pressable>
    </Animated.View>
  );
}
