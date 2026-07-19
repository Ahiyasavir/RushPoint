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
import { resolveEmulatorHost, normalizeContentType, isEmulatorBuild } from '@rushpoint/shared';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'emulator-key',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'rushpoint-pwa-7daaa.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'rushpoint-pwa-7daaa',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'rushpoint-pwa-7daaa.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? 'emulator-app-id',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Playtest tunnel detection — see the creator-web copy for the full rationale:
// behind a single https tunnel origin every emulator service is reached through
// that origin (the proxy routes each path signature); a one-port tunnel can't
// expose :8080/:9099/etc and an https page can't call http://host:8080. Local
// dev:all (localhost/127.0.0.1) keeps the direct port-based wiring.
const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const originHost = typeof window !== 'undefined' ? window.location.hostname : '';
// Wire the local emulator not only in `vite dev` (DEV) but also in the PRODUCTION
// `--mode playtest` build the always-on tunnel host serves. Without this, the
// minified bundle drops all emulator wiring and hits real Firebase — where
// anonymous auth is disabled (auth/admin-restricted-operation) — so no real phone
// can join. MODE is 'playtest' for that build (see playtest:build).
const emulatorBuild = isEmulatorBuild(import.meta.env);
const tunnelMode =
  emulatorBuild && !!originHost && originHost !== 'localhost' && originHost !== '127.0.0.1';

// Offline-first cache: live run/team state is served from IndexedDB when the
// participant briefly loses signal in the field, and listeners reconnect
// automatically. Multi-tab manager keeps several open tabs consistent.
// Cached on globalThis so a Vite HMR re-execution of this module reuses the
// same instance instead of calling initializeFirestore() twice (which throws).
// In tunnel mode Firestore also needs host/ssl at creation (routes via the proxy).
const dbHolder = globalThis as unknown as { __rpPlayDb?: ReturnType<typeof getFirestore> };
function initDb() {
  if (dbHolder.__rpPlayDb) return dbHolder.__rpPlayDb;
  try {
    dbHolder.__rpPlayDb = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ...(tunnelMode ? { host: originHost, ssl: true, experimentalAutoDetectLongPolling: true } : {}),
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
if (emulatorBuild && !emuFlag.__rpPlayEmu) {
  emuFlag.__rpPlayEmu = true;
  if (tunnelMode) {
    // Single-origin routing through the tunnel (https, no explicit port); the
    // proxy forwards each path to the right emulator. Firestore host/ssl was set
    // in initDb() above. Functions/Storage lack an https-origin emulator API in
    // firebase 10.x, so set the (SDK-verified) internal fields directly.
    connectAuthEmulator(auth, pageOrigin, { disableWarnings: true });
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
    }).catch((e) => {
      // A transient failure (network blip on the first anonymous sign-in) must
      // not poison the cached promise forever: leaving a rejected promise cached
      // makes every later ensureAuth() — and thus every callable / join attempt —
      // reject without ever re-trying. Clear it so the next call starts fresh.
      authReady = null;
      throw e;
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
  // Camera captures are compressed to JPEG before upload (change:
  // fix-photo-camera-capture), so this accepts the resulting Blob too.
  file: File | Blob,
  p: { runId: string; teamId: string; taskId: string },
): Promise<string> {
  await ensureAuth();
  const safeTask = p.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `runs/${p.runId}/teams/${p.teamId}/${safeTask}-${Date.now()}.jpg`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: 'image/jpeg' });
  return getDownloadURL(r);
}

// Upload an audio-mission clip (audio-tasks). Shares the SAME path scheme as
// photos (runs/{runId}/teams/{teamId}/…) so storage rules confine writes to the
// authenticated participant; uploads with the NORMALIZED content-type so the
// widened storage.rules content-type match (audio/webm|mp4|mpeg|ogg) succeeds.
// Returns { url, contentType } — the caller passes the type to submitStationPhoto.
export async function uploadTaskAudio(
  blob: Blob,
  p: { runId: string; teamId: string; taskId: string; contentType: string },
): Promise<{ url: string; contentType: string }> {
  await ensureAuth();
  const contentType = normalizeContentType(p.contentType || blob.type || 'audio/webm');
  const ext = contentType === 'audio/mp4' ? 'm4a'
    : contentType === 'audio/mpeg' ? 'mp3'
    : contentType === 'audio/ogg' ? 'ogg'
    : 'webm';
  const safeTask = p.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `runs/${p.runId}/teams/${p.teamId}/${safeTask}-${Date.now()}.${ext}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, blob, { contentType });
  return { url: await getDownloadURL(r), contentType };
}

// Under a ~20-player run over an ngrok tunnel, a momentary backend contention or
// tunnel blip can reject a write straight to the player. These are the transient,
// retry-SAFE Firebase callable error codes; our privileged mutations are
// idempotent (e.g. completeTaskForTeam returns false on a repeat), so re-issuing
// one is safe. A non-safe code (permission-denied, invalid-argument, …) still
// throws immediately.
const RETRYABLE_CALLABLE_CODES = new Set([
  'functions/internal',
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/aborted',
]);
const CALLABLE_TIMEOUT_MS = 20_000;
const CALLABLE_ATTEMPTS = 3;

export function callable<Req = void, Res = unknown>(
  name: string,
  // Most privileged mutations are idempotent, so a timeout/transient retry is
  // safe. A NON-idempotent callable (e.g. triggerSOS creates a new auto-id alert
  // doc each call) must opt out, or a retry-after-timeout duplicates the write.
  opts: { retry?: boolean } = {},
): (data?: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  const maxAttempts = opts.retry === false ? 1 : CALLABLE_ATTEMPTS;
  return async (data?: Req) => {
    await ensureAuth();
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error(`callable ${name} timed out`), { code: 'functions/deadline-exceeded' })),
            CALLABLE_TIMEOUT_MS,
          );
        });
        try {
          const res = await Promise.race([fn(data as Req), timeout]);
          return (res as { data: Res }).data;
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch (e) {
        lastErr = e;
        const code = String((e as { code?: string }).code ?? '');
        const isLast = attempt === maxAttempts - 1;
        if (isLast || !RETRYABLE_CALLABLE_CODES.has(code)) throw e;
        // Jittered backoff before the next attempt.
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1) + Math.random() * 250));
      }
    }
    throw lastErr;
  };
}

export const uid = () => auth.currentUser?.uid ?? null;
