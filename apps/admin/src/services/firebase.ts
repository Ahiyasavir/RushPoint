import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'demo-api-key',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'rushpoint-dev.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'rushpoint-dev',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'rushpoint-dev.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? '1:000000000000:web:demo',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db        = getFirestore(app);
export const auth      = getAuth(app);
export const functions = getFunctions(app);

export const APP_ID = import.meta.env.VITE_RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';

// ── Emulator wiring (dev only) ────────────────────────────────────────────────
// Guard against double-connect under Vite HMR (module re-evaluation).
const emuFlag = globalThis as unknown as { __rushpointEmu?: boolean };
if (import.meta.env.DEV && !emuFlag.__rushpointEmu) {
  emuFlag.__rushpointEmu = true;
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, 'localhost', 5001);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
// Judge callables only require an authenticated caller on the emulator. A single
// anonymous sign-in satisfies that; production judges carry an admin claim.
let authReady: Promise<void> | null = null;
export function ensureAuth(): Promise<void> {
  if (!authReady) {
    authReady = signInAnonymously(auth).then(() => undefined);
  }
  return authReady;
}
