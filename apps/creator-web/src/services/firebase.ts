import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithPopup,
  reauthenticateWithCredential,
  updateProfile,
  updateEmail,
  updatePassword,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
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

// ── Creator auth (email/password + Google) ───────────────────────────────────

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// In dev, the main `auth` is wired to the Auth Emulator — which intercepts
// signInWithPopup and shows a fake widget. To get the *real* Google account
// chooser we open the popup on a second app instance that is never emulated,
// then bridge the signed-in identity into the emulated `auth` (via a
// deterministic email/password) so Firestore rules still see request.auth.uid.
const googleApp =
  getApps().find((a) => a.name === 'google-oauth') ??
  initializeApp(firebaseConfig, 'google-oauth');
const googleAuth = getAuth(googleApp);
// googleAuth is intentionally NOT connected to the emulator.

export async function signInWithGoogle() {
  if (!import.meta.env.DEV) {
    // Production: `auth` is real Firebase — the popup opens Google directly.
    return signInWithPopup(auth, googleProvider);
  }

  // Dev: real Google account chooser via the non-emulated instance.
  const { user } = await signInWithPopup(googleAuth, googleProvider);

  // Bridge the real Google identity into the emulated auth so the rest of the
  // app (Firestore/Functions on the emulator) sees a matching signed-in user.
  const email = user.email!;
  const devPassword = `__google_proxy_${user.uid}`;
  try {
    return await signInWithEmailAndPassword(auth, email, devPassword);
  } catch {
    const cred = await createUserWithEmailAndPassword(auth, email, devPassword);
    await updateProfile(cred.user, {
      displayName: user.displayName ?? email.split('@')[0],
      photoURL: user.photoURL ?? undefined,
    });
    return cred;
  }
}

export function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
) {
  return createUserWithEmailAndPassword(auth, email, password).then(async (cred) => {
    if (displayName) await updateProfile(cred.user, { displayName });
    return cred;
  });
}
export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function resetPassword(email: string) {
  return sendPasswordResetEmail(auth, email);
}
export function signOut() {
  return fbSignOut(auth);
}
export function watchAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

// ── Account management (self-service, all on the caller's own identity) ───────

// True when the account has an email/password credential (vs. Google-only).
// Email & password changes require re-auth with the current password, which
// only password accounts can satisfy.
export function hasPasswordProvider(): boolean {
  return auth.currentUser?.providerData.some((p) => p.providerId === 'password') ?? false;
}

// Re-establish a recent login (required by Firebase before sensitive changes).
async function reauthWithPassword(currentPassword: string): Promise<User> {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Not signed in');
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  return user;
}

// Update the locally-cached display name immediately (the backend callable
// updateMyProfile syncs the Auth record + gallery denorm in parallel).
export async function updateDisplayNameLocal(displayName: string) {
  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName });
}

export async function changeMyEmail(currentPassword: string, newEmail: string) {
  const user = await reauthWithPassword(currentPassword);
  await updateEmail(user, newEmail.trim());
}

export async function changeMyPassword(currentPassword: string, newPassword: string) {
  const user = await reauthWithPassword(currentPassword);
  await updatePassword(user, newPassword);
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
