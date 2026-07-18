import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithPopup,
  signInWithCredential,
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
import {
  getStorage,
  connectStorageEmulator,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';
import { resolveEmulatorHost } from '@rushpoint/shared';
import { buildEmulatorGoogleClaims } from './authClaims';

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

// Playtest tunnel detection: when the page is served from a remote origin (a
// cloudflared/ngrok tunnel), every emulator service must be reached through that
// single https origin — the proxy (scripts/proxy.mjs) routes each path signature
// to the right local emulator. A one-port tunnel can't expose :8080/:9099/etc,
// and an https page can't call http://host:8080 (mixed content). Local dev:all
// (localhost/127.0.0.1) keeps the direct port-based wiring unchanged.
const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const originHost = typeof window !== 'undefined' ? window.location.hostname : '';
// Wire the emulator in `vite dev` (DEV) AND in the production `--mode playtest`
// build the always-on tunnel host serves — otherwise the minified bundle hits real
// Firebase and creator sign-in / all callables fail over the tunnel.
const emulatorBuild = import.meta.env.DEV || import.meta.env.MODE === 'playtest';
const tunnelMode =
  emulatorBuild && !!originHost && originHost !== 'localhost' && originHost !== '127.0.0.1';

// Firestore over a tunnel needs ssl + no port at creation time (settings can't be
// changed after first use), so build it with host/ssl here; local dev uses the
// default instance + connectFirestoreEmulator below.
export const db = tunnelMode
  ? (() => {
      try {
        return initializeFirestore(app, { host: originHost, ssl: true, experimentalAutoDetectLongPolling: true });
      } catch {
        return getFirestore(app);
      }
    })()
  : getFirestore(app);
export const auth      = getAuth(app);
export const functions = getFunctions(app);
export const storage   = getStorage(app);

// ── Emulator wiring (dev only) ────────────────────────────────────────────────
const emuFlag = globalThis as unknown as { __rushpointEmu?: boolean };
if (emulatorBuild && !emuFlag.__rushpointEmu) {
  emuFlag.__rushpointEmu = true;
  if (tunnelMode) {
    // Single-origin routing through the tunnel (https, no explicit port).
    connectAuthEmulator(auth, pageOrigin, { disableWarnings: true });
    // Functions/Storage have no https-origin emulator API in firebase 10.x, so we
    // set the documented internal fields directly (verified against the SDK).
    (functions as unknown as { emulatorOrigin: string }).emulatorOrigin = pageOrigin;
    (storage as unknown as { host: string; _protocol: string }).host = originHost;
    (storage as unknown as { host: string; _protocol: string })._protocol = 'https';
  } else {
    // Emulator host: 127.0.0.1 for normal dev. Default keeps dev:all unchanged.
    const host = resolveEmulatorHost(import.meta.env, pageOrigin || null);
    connectFirestoreEmulator(db, host, 8080);
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFunctionsEmulator(functions, host, 5001);
    connectStorageEmulator(storage, host, 9199);
  }
}

// ── Task-media upload (change: task-media-attachments) ────────────────────────
// Upload a creator-picked image/video file to the creator's own media folder so
// Storage rules (gameMedia/{ownerUid}/…) confine writes to the authenticated owner.
// Returns the download URL to store on the task's `media` entry. `onProgress` gets
// 0–100. The task's media kind is derived from the file's MIME type.
export async function uploadTaskMedia(
  file: File,
  p: { gameId: string; taskId: string },
  onProgress?: (pct: number) => void,
): Promise<{ url: string; kind: 'image' | 'video' }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const kind: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';
  const ext = (file.name.split('.').pop() ?? (kind === 'video' ? 'mp4' : 'jpg'))
    .toLowerCase().replace(/[^a-z0-9]/g, '') || (kind === 'video' ? 'mp4' : 'jpg');
  const safeTask = p.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `gameMedia/${uid}/games/${p.gameId}/${safeTask}-${Date.now()}.${ext}`;
  const r = storageRef(storage, path);
  const task = uploadBytesResumable(r, file, { contentType: file.type || 'image/jpeg' });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      () => resolve(),
    );
  });
  const url = await getDownloadURL(r);
  return { url, kind };
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
  if (!emulatorBuild) {
    // Production: `auth` is real Firebase — the popup opens Google directly.
    return signInWithPopup(auth, googleProvider);
  }

  // Dev (localhost OR playtest tunnel): open the REAL Google account chooser via
  // the non-emulated instance, then bridge the identity into the emulated `auth`.
  // Over a tunnel this requires the tunnel host to be in the Firebase project's
  // Authorized Domains (Console → Authentication → Settings) — localhost is
  // pre-authorized; a fixed ngrok domain must be added once. A random
  // *.trycloudflare.com host can't be pre-authorized, so use playtest:ngrok.
  const { user } = await signInWithPopup(googleAuth, googleProvider);

  // Bridge the real Google identity into the emulated auth as a Google *credential*
  // (not a synthetic password). The Auth Emulator links google.com onto an existing
  // account with the same email — so an account first registered with email+password
  // resolves to that SAME account (same uid) instead of failing on email-already-in-use.
  // If no account exists yet, it creates one. (unify-email-google-login)
  const claims = JSON.stringify(buildEmulatorGoogleClaims(user));
  const googleCredential = GoogleAuthProvider.credential(claims);
  return signInWithCredential(auth, googleCredential);
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
