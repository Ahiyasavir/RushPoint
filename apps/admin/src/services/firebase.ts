import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// Emulator-safe defaults: the Firebase SDK only requires non-empty apiKey/appId
// strings to initialize locally â€” they are never validated against the emulator.
// projectId MUST match .firebaserc and the seed script (rushpoint-pwa-7daaa).
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'emulator-key',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'rushpoint-pwa-7daaa.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'rushpoint-pwa-7daaa',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'rushpoint-pwa-7daaa.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? 'emulator-app-id',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Detect when the dashboard is served through the public reverse-proxy tunnel
// (cloudflare `*.trycloudflare.com`, localtunnel, …): a remote HTTPS origin, or an
// explicit VITE_TUNNEL_URL. In that mode every Firebase service is reached
// same-origin over HTTPS:443 and the proxy routes by path. Local dev (localhost
// over http) keeps the direct-port wiring.
const tunnelUrlEnv: string | undefined = import.meta.env.VITE_TUNNEL_URL;
const tunnelHost = tunnelUrlEnv
  ? new URL(tunnelUrlEnv).hostname
  : (typeof window !== 'undefined' &&
     window.location.protocol === 'https:' &&
     !['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? window.location.hostname
      : null);

// Offline persistence: back Firestore with IndexedDB so the judge/admin dashboard
// survives a dropped connection (Jerusalem dead zones) and resyncs on reconnect.
// persistentMultipleTabManager lets several admin tabs share one cache. Falls back
// to the already-initialised instance under Vite HMR re-evaluation.
function initDb(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      // Through the tunnel Firestore must talk HTTPS; connectFirestoreEmulator
      // forces ssl:false, so host/ssl is baked in here at initialize time instead.
      ...(tunnelHost
        ? { host: tunnelHost, ssl: true, experimentalForceLongPolling: true }
        : {}),
    });
  } catch {
    // Already initialised (Fast Refresh) — reuse it.
    return getFirestore(app);
  }
}

export const db        = initDb();
export const auth      = getAuth(app);
export const functions = getFunctions(app);

export const APP_ID = import.meta.env.VITE_RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

// ── Emulator wiring (dev only) ────────────────────────────────────────────────
// Guard against double-connect under Vite HMR (module re-evaluation).
const emuFlag = globalThis as unknown as { __rushpointEmu?: boolean };
if (import.meta.env.DEV && !emuFlag.__rushpointEmu) {
  emuFlag.__rushpointEmu = true;

  if (tunnelHost) {
    // Served through the HTTPS reverse-proxy tunnel. Firestore is already wired in
    // initDb(); auth/functions point at the same origin over 443 and the proxy
    // routes by path. connectFunctionsEmulator hardcodes http, so the functions
    // origin is set to https directly.
    connectAuthEmulator(auth, `https://${tunnelHost}`, { disableWarnings: true });
    (functions as unknown as { emulatorOrigin: string }).emulatorOrigin = `https://${tunnelHost}`;
  } else {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }
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
