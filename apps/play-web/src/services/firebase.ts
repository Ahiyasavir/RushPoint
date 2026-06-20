import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  signInWithCustomToken,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'emulator-key',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'rushpoint-pwa-7daaa.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'rushpoint-pwa-7daaa',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'rushpoint-pwa-7daaa.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? 'emulator-app-id',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db        = getFirestore(app);
export const auth      = getAuth(app);
export const functions = getFunctions(app);

const emuFlag = globalThis as unknown as { __rpPlayEmu?: boolean };
if (import.meta.env.DEV && !emuFlag.__rpPlayEmu) {
  emuFlag.__rpPlayEmu = true;
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// Participants play anonymously (uid == teamId). Each device/browser is a team.
let authReady: Promise<void> | null = null;
export function ensureAuth(): Promise<void> {
  if (!authReady) authReady = signInAnonymously(auth).then(() => undefined);
  return authReady;
}

// Staff sign in with a custom token minted by the staffSignIn callable.
export async function signInStaff(customToken: string) {
  await signInWithCustomToken(auth, customToken);
}

export function callable<Req = void, Res = unknown>(name: string): (data?: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data?: Req) => {
    await ensureAuth();
    const res = await fn(data as Req);
    return res.data;
  };
}

export const uid = () => auth.currentUser?.uid ?? null;
