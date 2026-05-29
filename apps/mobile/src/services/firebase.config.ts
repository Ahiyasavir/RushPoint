import { Platform } from 'react-native';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import {
  getAuth,
  initializeAuth,
  connectAuthEmulator,
  type Auth,
} from 'firebase/auth';
// getReactNativePersistence ships in firebase's React-Native build (resolved by
// Metro) but is absent from the default web typings in firebase 10 — import it
// separately so the type-only gap doesn't break the rest of the auth imports.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error RN-only export missing from firebase/auth web typings
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// Emulator-safe defaults: the Firebase SDK only requires non-empty apiKey/appId
// strings to initialize locally — they are never validated against the emulator.
// projectId MUST match .firebaserc and the seed script (race-to-tzion-2026).
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'emulator-key',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'race-to-tzion-2026.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'race-to-tzion-2026',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'race-to-tzion-2026.appspot.com',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? 'emulator-app-id',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Offline persistence: on web, back Firestore with IndexedDB so reads/writes
// survive a dropped connection and sync on reconnect. Native runtimes (no
// IndexedDB) and HMR re-evaluation fall back to the already-started instance.
function initDb(): Firestore {
  if (Platform.OS === 'web') {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      // Already initialised (Fast Refresh) — reuse it.
    }
  }
  return getFirestore(app);
}

// On native, back Auth with AsyncStorage so the signed-in session (anonymous or
// the custom-token team identity) survives an app restart — otherwise RN defaults
// to in-memory persistence and the user would have to re-enter their code. On web,
// Auth persists in localStorage by default. Guard against Fast-Refresh re-init.
function initAuth(): Auth {
  if (Platform.OS !== 'web') {
    try {
      return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
    } catch {
      // Already initialised (Fast Refresh) — reuse it.
    }
  }
  return getAuth(app);
}

export const db = initDb();
export const auth = initAuth();
export const storage = getStorage(app);
export const functions = getFunctions(app);

// ── Emulator wiring (dev only) ────────────────────────────────────────────────
// Host is configurable: iOS simulator uses 'localhost', Android emulator needs
// '10.0.2.2'. Override with EXPO_PUBLIC_EMULATOR_HOST. Guarded against re-running
// under Fast Refresh.
const emu = globalThis as unknown as { __rushpointEmu?: boolean };
if (__DEV__ && !emu.__rushpointEmu) {
  emu.__rushpointEmu = true;
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? 'localhost';
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}

export default app;
