import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
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

export const db = getFirestore(app);
export const auth = getAuth(app);
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
