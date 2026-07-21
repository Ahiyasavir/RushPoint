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
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';
import { resolveEmulatorHost, normalizeContentType, isEmulatorBuild } from '@rushpoint/shared';
import {
  runWithRetry,
  withTimeout,
  isRetryableStorageError,
  errorCode,
  uploadPercent,
  setUploadProgress,
  setUploadRetrying,
} from '../lib/uploadResiliency';

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

// ── Resilient Storage upload ────────────────────────────────────────────────
// The upload used to be a bare, non-resumable `uploadBytes`: no timeout, no
// retry, no progress — while the callable right below it already retried 3× with
// a timeout. So `submitStationPhoto` survived a flaky moment on mobile data but
// the upload before it did not, and the player just got "couldn't save the photo,
// take it again". Now: uploadBytesResumable + progress + stall/absolute timeouts
// + the SAME bounded jittered-backoff retry policy (shared implementation in
// lib/uploadResiliency.ts). See docs/wave-a/upload-resiliency.md.
const UPLOAD_ATTEMPTS = 3;
/** No progress byte for this long ⇒ the attempt is dead; cancel and retry. */
const UPLOAD_STALL_MS = 45_000;
/** Absolute cap for a single attempt, however slowly it is progressing. */
const UPLOAD_MAX_MS = 180_000;

async function uploadResilient(
  path: string,
  data: Blob | File,
  contentType: string,
): Promise<string> {
  await ensureAuth();
  // The path is computed ONCE by the caller, so a retry overwrites the same
  // object instead of leaving an orphan — and the server-validated shape
  // (runs/{runId}/teams/{teamId}/{taskId}-{ts}.ext, requireStorageUrl) is stable.
  const r = storageRef(storage, path);
  try {
    return await runWithRetry(
      async () => {
        setUploadRetrying(false);
        setUploadProgress(0);
        const task = uploadBytesResumable(r, data, { contentType });
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        let stalled = false;
        const cancel = () => { try { task.cancel(); } catch { /* already settled */ } };
        const armStall = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(() => { stalled = true; cancel(); }, UPLOAD_STALL_MS);
        };
        const done = new Promise<void>((resolve, reject) => {
          armStall();
          task.on(
            'state_changed',
            (snap) => {
              armStall();
              setUploadProgress(uploadPercent(snap.bytesTransferred, snap.totalBytes));
            },
            (err) => {
              if (stallTimer) clearTimeout(stallTimer);
              // A cancel WE caused is a stall, not a user abort — surface it with
              // the retryable synthetic code so the loop tries again.
              reject(stalled
                ? Object.assign(new Error('upload stalled'), { code: 'storage/deadline-exceeded' })
                : err);
            },
            () => { if (stallTimer) clearTimeout(stallTimer); resolve(); },
          );
        });
        await withTimeout(done, UPLOAD_MAX_MS, 'storage/deadline-exceeded', cancel);
        setUploadProgress(100);
        return getDownloadURL(r);
      },
      {
        attempts: UPLOAD_ATTEMPTS,
        isRetryable: isRetryableStorageError,
        onRetry: () => setUploadRetrying(true),
      },
    );
  } finally {
    setUploadRetrying(false);
    setUploadProgress(null);
  }
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
  const safeTask = p.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `runs/${p.runId}/teams/${p.teamId}/${safeTask}-${Date.now()}.jpg`;
  return uploadResilient(path, file, 'image/jpeg');
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
  const contentType = normalizeContentType(p.contentType || blob.type || 'audio/webm');
  const ext = contentType === 'audio/mp4' ? 'm4a'
    : contentType === 'audio/mpeg' ? 'mp3'
    : contentType === 'audio/ogg' ? 'ogg'
    : 'webm';
  const safeTask = p.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `runs/${p.runId}/teams/${p.teamId}/${safeTask}-${Date.now()}.${ext}`;
  return { url: await uploadResilient(path, blob, contentType), contentType };
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
    // Same timeout + jittered-backoff policy as before, now via the shared
    // implementation the Storage uploads use (lib/uploadResiliency.ts) so there
    // is exactly one retry loop in the app.
    return runWithRetry(
      async () => {
        const res = await withTimeout(
          fn(data as Req),
          CALLABLE_TIMEOUT_MS,
          'functions/deadline-exceeded',
        );
        return (res as { data: Res }).data;
      },
      {
        attempts: maxAttempts,
        isRetryable: (e) => RETRYABLE_CALLABLE_CODES.has(errorCode(e)),
      },
    );
  };
}

export const uid = () => auth.currentUser?.uid ?? null;
