import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// Emulator-safe defaults: the Firebase SDK only needs non-empty apiKey/appId
// strings to initialize locally. projectId MUST match .firebaserc + the seed.
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

// ── Emulator wiring (dev only) ────────────────────────────────────────────────
const emuFlag = globalThis as unknown as { __rushpointEmu?: boolean };
if (import.meta.env.DEV && !emuFlag.__rushpointEmu) {
  emuFlag.__rushpointEmu = true;
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// ── Creator auth (real Firebase Auth: email/password + Google) ────────────────
const googleProvider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}
export function signUpWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password);
}
export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function signOut() {
  return fbSignOut(auth);
}
export function watchAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

// Promise that resolves to the current (or next) signed-in user, or null.
export function currentUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u);
    });
  });
}
