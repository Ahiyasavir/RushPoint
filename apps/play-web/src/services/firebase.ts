import { initializeApp, getApps } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import {
  getStorage,
  connectStorageEmulator,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import { resolveEmulatorHost } from '@rushpoint/shared';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'emulator-key',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'rushpoint-pwa-7daaa.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'rushpoint-pwa-7daaa',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'rushpoint-pwa-7daaa.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? 'emulator-app-id',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Offline-first cache: live run/team state is served from IndexedDB when the
// participant briefly loses signal in the field, and listeners reconnect
// automatically. Multi-tab manager keeps several open tabs consistent.
// Cached on globalThis so a Vite HMR re-execution of this module reuses the
// same instance instead of calling initializeFirestore() twice (which throws).
const dbHolder = globalThis as unknown as { __rpPlayDb?: ReturnType<typeof getFirestore> };
function initDb() {
  if (dbHolder.__rpPlayDb) return dbHolder.__rpPlayDb;
  try {
    dbHolder.__rpPlayDb = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    dbHolder.__rpPlayDb = getFirestore(app);
  }
  return dbHolder.__rpPlayDb;
}
export const db = initDb();
export const auth      = getAuth(app);
export const functions = getFunctions(app);
export const storage   = getStorage(app);

const emuFlag = globalThis as unknown as { __rpPlayEmu?: boolean };
if (import.meta.env.DEV && !emuFlag.__rpPlayEmu) {
  emuFlag.__rpPlayEmu = true;
  // Emulator host: 127.0.0.1 for normal dev; the tunnel origin in playtest so a
  // remote phone reaches the backend (playtest-shareable-links).
  const host = resolveEmulatorHost(import.meta.env, typeof window !== 'undefined' ? window.location.origin : null);
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}

// Participants play anonymously (uid == teamId). Each device/browser is a team.
// Staff sign in with a one-time custom token; their session persists across
// reloads, so we only mint a *new* anonymous user when none is restored —
// otherwise a reload would clobber a restored staff (or anonymous) session.
let authReady: Promise<void> | null = null;
export function ensureAuth(): Promise<void> {
  if (!authReady) {
    authReady = new Promise<void>((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        if (user) { resolve(); return; }
        signInAnonymously(auth).then(() => resolve(), reject);
      });
    });
  }
  return authReady;
}

// Staff sign in with a custom token minted by the staffSignIn callable.
export async function signInStaff(customToken: string) {
  await signInWithCustomToken(auth, customToken);
}

// Upload a photo-mission image to Storage and return its download URL. Path is
// scoped to the team's own folder (runs/{runId}/teams/{teamId}/…) so storage
// rules can confine writes to the authenticated participant.
export async function uploadTaskPhoto(
  file: File,
  p: { runId: string; teamId: string; taskId: string },
): Promise<string> {
  await ensureAuth();
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const safeTask = p.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `runs/${p.runId}/teams/${p.teamId}/${safeTask}-${Date.now()}.${ext}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(r);
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
