import '../global.css';

import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components/Toast';
import ErrorBoundary from '../src/components/ErrorBoundary';
import { initTelemetry } from '../src/services/telemetry';

// Install global crash handlers once, before the tree mounts.
initTelemetry();

// PWA wiring (web only). Expo Router's SPA ("single") output ships a default
// index.html that ignores app/+html.tsx, so we inject the install/iOS metadata
// into <head> at runtime (idempotent — skips anything already present, e.g. when
// running in static-render mode where +html.tsx already added it). The service
// worker is registered in production only — in Expo dev (__DEV__) it would cache
// stale Metro bundles and shadow HMR.
function usePwa() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as unknown as { document?: Document }).document;
    if (!doc) return;

    const ensureLink = (rel: string, href: string, attrs: Record<string, string> = {}) => {
      if (doc.head.querySelector(`link[rel="${rel}"]`)) return;
      const el = doc.createElement('link');
      el.rel = rel;
      el.href = href;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      doc.head.appendChild(el);
    };
    const ensureMeta = (name: string, content: string) => {
      if (doc.head.querySelector(`meta[name="${name}"]`)) return;
      const el = doc.createElement('meta');
      el.setAttribute('name', name);
      el.setAttribute('content', content);
      doc.head.appendChild(el);
    };

    ensureLink('manifest', '/manifest.json');
    ensureLink('icon', '/icon.svg', { type: 'image/svg+xml' });
    ensureLink('apple-touch-icon', '/icon.svg');
    ensureMeta('theme-color', '#0B0F17');
    ensureMeta('apple-mobile-web-app-capable', 'yes');
    ensureMeta('mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    ensureMeta('apple-mobile-web-app-title', 'RushPoint');
    // Extend the matte UI under the notch (viewport-fit=cover).
    const vp = doc.head.querySelector('meta[name="viewport"]');
    if (vp && !/viewport-fit/.test(vp.getAttribute('content') ?? '')) {
      vp.setAttribute('content', `${vp.getAttribute('content')}, viewport-fit=cover`);
    }

    // Service worker — production builds only.
    if (!__DEV__) {
      const nav = (globalThis as unknown as { navigator?: Navigator }).navigator;
      if (nav && 'serviceWorker' in nav) {
        nav.serviceWorker.register('/sw.js').catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[RushPoint] SW registration failed:', err);
        });
      }
    }
  }, []);
}

export default function RootLayout() {
  usePwa();
  return (
    <ErrorBoundary>
      <GestureHandlerRootView className="flex-1">
        <SafeAreaProvider>
          <ToastProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0B0F17' },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="access-code" />
          <Stack.Screen name="register" />
          <Stack.Screen name="waiver" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="dashboard" options={{ gestureEnabled: false }} />
          <Stack.Screen name="map" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="basket-zone" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="wrapped" options={{ animation: 'slide_from_bottom' }} />
          </Stack>
          </ToastProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
