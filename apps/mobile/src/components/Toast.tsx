import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'info' | 'success' | 'error';

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

// ─── Static class maps ────────────────────────────────────────────────────────

const BG_CLASSES: Record<ToastType, string> = {
  info:    'bg-zinc-800 border border-zinc-700',
  success: 'bg-emerald-950 border border-emerald-700',
  error:   'bg-red-950 border border-red-700',
};

const TEXT_CLASSES: Record<ToastType, string> = {
  info:    'text-zinc-200',
  success: 'text-emerald-300',
  error:   'text-red-300',
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();

  const [toastState, setToastState] = useState<{
    message: string;
    type: ToastType;
    visible: boolean;
  }>({ message: '', type: 'info', visible: false });

  const translateY = useSharedValue(-120);
  const opacity    = useSharedValue(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    translateY.value = withTiming(-120, { duration: 250 });
    opacity.value    = withTiming(0,    { duration: 250 });
    // Delay state clear until slide-out finishes so text doesn't vanish mid-animation.
    setTimeout(() => setToastState((s) => ({ ...s, visible: false })), 300);
  }, [translateY, opacity]);

  const show = useCallback(
    (message: string, type: ToastType = 'info') => {
      if (timerRef.current) clearTimeout(timerRef.current);

      setToastState({ message, type, visible: true });
      translateY.value = withSpring(0, { damping: 14, stiffness: 120 });
      opacity.value    = withTiming(1, { duration: 200 });

      timerRef.current = setTimeout(hide, 3500);
    },
    [translateY, opacity, hide],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity:   opacity.value,
  }));

  return (
    <ToastContext.Provider value={{ show }}>
      {children}

      {toastState.visible && (
        <Animated.View
          style={[animatedStyle, { top: insets.top + 8, zIndex: 999 }]}
          className={`absolute left-4 right-4 rounded-xl px-4 py-3 ${BG_CLASSES[toastState.type]}`}
          pointerEvents="none"
        >
          <Text className={`text-sm font-medium ${TEXT_CLASSES[toastState.type]}`}>
            {toastState.message}
          </Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}
