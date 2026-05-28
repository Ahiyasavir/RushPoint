import '../global.css';

import React from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components/Toast';

export default function RootLayout() {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <ToastProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#07070a' },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="access-code" />
          <Stack.Screen name="register" />
          <Stack.Screen name="dashboard" options={{ gestureEnabled: false }} />
          <Stack.Screen name="map" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="basket-zone" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
