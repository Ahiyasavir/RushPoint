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
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  resolveEmulatorHost,
  normalizeContentType,
  isEmulatorBuild,
  shouldInitAppCheck,
  appCheckSiteKey,
} from '@rushpoint/shared';
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

// ── App Check (change: app-check-ready) — READY, BUT DARK BY DEFAULT ─────────
// Attached ONLY when shouldInitAppCheck() says so: never in an emulator build
// (dev:all / --mode playtest / e2e — those emulators mint no App Check tokens),
// and never without a configured reCAPTCHA v3 site key. So with today's env this
// is a no-op and the bundle behaves exactly as before.
// FAIL OPEN: a missing, invalid or network-blocked key must never white-screen a
// participant mid-race, so the whole thing is wrapped — an unattested session is
// far better than an app that won't boot. Enforcement is a SERVER decision
// (functions/src/appCheckGuard.ts) and is currently 'off' everywhere.
const appCheckFlag = globalThis as unknown as { __rpPlayAppCheck?: boolean };
if (shouldInitAppCheck(import.meta.env) && !appCheckFlag.__rpPlayAppCheck) {
  appCheckFlag.__rpPlayAppCheck = true;
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey(import.meta.env) as string),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Already initialized (HMR) or a bad key — carry on unattested.
  }
}

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
// Self-hosted API server (change: self-host-functions-on-vps). When
// VITE_API_ORIGIN is set, every httpsCallable() is routed to
// `<VITE_API_ORIGIN>/<name>` (the Node server running the SAME functions code on
// the VPS) instead of Cloud Functions. Auth, Firestore and Storage keep talking
// to real Firebase — only the callable compute moves off Cloud Functions. Unset
// ⇒ today's behaviour exactly (Cloud Functions, or the emulator wiring below).
const apiOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim() || undefined;
export const functions = apiOrigin ? getFunctions(app, apiOrigin) : getFunctions(app);
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
    // VITE_API_ORIGIN, when set, wins over the emulator for callables.
    if (!apiOrigin) (functions as unknown as { emulatorOrigin: string }).emulatorOrigin = pageOrigin;
    (storage as unknown as { host: string; _protocol: string }).host = originHost;
    (storage as unknown as { host: string; _protocol: string })._protocol = 'https';
  } else {
    // Emulator host: 127.0.0.1 for normal dev. Default keeps dev:all unchanged.
    const host = resolveEmulatorHost(import.meta.env, pageOrigin || null);
    connectFirestoreEmulator(db, host, 8080);
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    if (!apiOrigin) connectFunctionsEmulator(functions, host, 5001);
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

// ── Resilient upload ────────────────────────────────────────────────────────
// Dual path (change: vps-upload-route):
//   • When VITE_API_ORIGIN is set (production — api.rush-point.com), files are
//     uploaded directly to the VPS via PUT /upload?path=…. No Firebase Storage
//     bucket needed. This is what makes photo/audio work without Blaze billing.
//   • When VITE_API_ORIGIN is unset (local emulator dev:all), the original
//     Firebase Storage upload is used so the emulator workflow is unchanged.
//
// Both paths share the same retry / timeout / stall-detection / progress
// infrastructure (lib/uploadResiliency.ts) and the SAME public API
// (uploadTaskPhoto, uploadTaskAudio). Callers don't know which transport ran.
const UPLOAD_ATTEMPTS = 3;
/** No progress byte for this long ⇒ the attempt is dead; cancel and retry. */
const UPLOAD_STALL_MS = 45_000;
/** Absolute cap for a single attempt, however slowly it is progressing. */
const UPLOAD_MAX_MS = 180_000;
/** Cap on the post-upload getDownloadURL metadata fetch (the old un-timed leg). */
const DOWNLOAD_URL_MS = 30_000;

// ── VPS upload (production path) ────────────────────────────────────────────
// Uses XMLHttpRequest (not fetch) for upload-progress events — the same UX the
// Firebase resumable upload provided. The VPS endpoint is a plain PUT with the
// file as the raw body, path + content-type in query/header. Auth is a Firebase
// ID token in the Authorization header.
function uploadViaVps(
  path: string,
  data: Blob | File,
  contentType: string,
  // Receives an aborter so the caller's ABSOLUTE timeout can actually stop the
  // request. Without it a timed-out upload kept streaming in the background
  // while the retry sent a second copy of the same file over the same link —
  // exactly the congestion that makes a slow upload look frozen.
  onAbortable?: (abort: () => void) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onAbortable?.(() => { try { xhr.abort(); } catch { /* already settled */ } });
    const url = `${apiOrigin}/upload?path=${encodeURIComponent(path)}`;
    xhr.open('PUT', url);

    // Firebase ID token for server-side auth (same token the callables use).
    const token = auth.currentUser?.getIdToken();
    if (!token) { reject(new Error('Not authenticated')); return; }

    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { stalled = true; xhr.abort(); }, UPLOAD_STALL_MS);
    };

    // Progress tracking — mirrors the Firebase `state_changed` callback.
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        armStall();
        setUploadProgress(uploadPercent(e.loaded, e.total));
      }
    });

    xhr.addEventListener('load', () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          setUploadProgress(100);
          resolve(body.url);
        } catch {
          reject(Object.assign(new Error('Invalid server response'), { code: 'storage/internal-error' }));
        }
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(Object.assign(new Error('Auth failed'), { code: 'storage/unauthorized' }));
      } else if (xhr.status >= 400 && xhr.status < 500 && xhr.status !== 408 && xhr.status !== 429) {
        // A PERMANENT client error — oversized file, disallowed content type,
        // malformed path. Must NOT carry a retryable code: `runWithRetry` would
        // re-send the identical body twice more, so the player waits three times
        // as long to be told the same no. Only 408/429 are worth re-sending.
        reject(Object.assign(
          new Error(`Upload rejected: ${xhr.status}`),
          { code: 'storage/invalid-argument' },
        ));
      } else {
        // 5xx, 408, 429 → genuinely transient, safe to re-send (same path ⇒
        // idempotent overwrite).
        reject(Object.assign(new Error(`Upload failed: ${xhr.status}`), { code: 'storage/internal-error' }));
      }
    });

    xhr.addEventListener('error', () => {
      if (stallTimer) clearTimeout(stallTimer);
      reject(Object.assign(new Error('Network error'), { code: 'storage/unknown' }));
    });

    xhr.addEventListener('abort', () => {
      if (stallTimer) clearTimeout(stallTimer);
      reject(Object.assign(
        new Error(stalled ? 'upload stalled' : 'upload aborted'),
        { code: 'storage/deadline-exceeded' },
      ));
    });

    // Send the raw file body with the correct content-type.
    token.then((t) => {
      xhr.setRequestHeader('Authorization', `Bearer ${t}`);
      xhr.setRequestHeader('Content-Type', contentType);
      armStall();
      xhr.send(data);
    }).catch(reject);
  });
}

// ── Firebase Storage upload (emulator fallback) ─────────────────────────────
// Kept for local dev (dev:all / playtest). Identical to the pre-VPS version.
function uploadViaFirebaseStorage(
  path: string,
  data: Blob | File,
  contentType: string,
  onAbortable?: (abort: () => void) => void,
): Promise<string> {
  const r = storageRef(storage, path);
  return new Promise<string>((resolve, reject) => {
    setUploadProgress(0);
    const task = uploadBytesResumable(r, data, { contentType });
    onAbortable?.(() => { try { task.cancel(); } catch { /* already settled */ } });
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    const cancel = () => { try { task.cancel(); } catch { /* already settled */ } };
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { stalled = true; cancel(); }, UPLOAD_STALL_MS);
    };
    armStall();
    task.on(
      'state_changed',
      (snap) => {
        armStall();
        setUploadProgress(uploadPercent(snap.bytesTransferred, snap.totalBytes));
      },
      (err) => {
        if (stallTimer) clearTimeout(stallTimer);
        reject(stalled
          ? Object.assign(new Error('upload stalled'), { code: 'storage/deadline-exceeded' })
          : err);
      },
      async () => {
        if (stallTimer) clearTimeout(stallTimer);
        try {
          setUploadProgress(100);
          const url = await withTimeout(getDownloadURL(r), DOWNLOAD_URL_MS, 'storage/deadline-exceeded');
          resolve(url);
        } catch (e) { reject(e); }
      },
    );
  });
}

// ── Resilient upload dispatcher ─────────────────────────────────────────────
// Routes to VPS or Firebase Storage depending on whether VITE_API_ORIGIN is set.
// Wraps either transport in the same retry/timeout/progress envelope.
async function uploadResilient(
  path: string,
  data: Blob | File,
  contentType: string,
): Promise<string> {
  await ensureAuth();
  try {
    return await runWithRetry(
      async () => {
        setUploadRetrying(false);
        setUploadProgress(0);
        let abortUpload: (() => void) | undefined;
        const upload = apiOrigin
          ? uploadViaVps(path, data, contentType, (abort) => { abortUpload = abort; })
          : uploadViaFirebaseStorage(path, data, contentType, (abort) => { abortUpload = abort; });
        return await withTimeout(
          upload, UPLOAD_MAX_MS, 'storage/deadline-exceeded',
          () => abortUpload?.(),
        );
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
