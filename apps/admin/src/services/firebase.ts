import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// Emulator-safe defaults: the Firebase SDK only requires non-empty apiKey/appId
// strings to initialize locally â€” they are never validated against the emulator.
// projectId MUST match .firebaserc and the seed script (race-to-tzion-2026).
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'emulator-key',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'race-to-tzion-2026.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'race-to-tzion-2026',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'race-to-tzion-2026.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? 'emulator-app-id',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db        = getFirestore(app);
export const auth      = getAuth(app);
export const functions = getFunctions(app);

export const APP_ID = import.meta.env.VITE_RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';

// â”€â”€ Emulator wiring (dev only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Guard against double-connect under Vite HMR (module re-evaluation).
const emuFlag = globalThis as unknown as { __rushpointEmu?: boolean };
if (import.meta.env.DEV && !emuFlag.__rushpointEmu) {
  emuFlag.__rushpointEmu = true;
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Judge callables only require an authenticated caller on the emulator. A single
// anonymous sign-in satisfies that; production judges carry an admin claim.
let authReady: Promise<void> | null = null;
export function ensureAuth(): Promise<void> {
  if (!authReady) {
    authReady = signInAnonymously(auth).then(() => undefined);
  }
  return authReady;
}
