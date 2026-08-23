// Firebase Admin, wired to the local emulator. Loads .env first (side-effect
// import) so RUSHPOINT_* vars are available. Exports a ready db + auth.
import './env.mjs';
import admin from 'firebase-admin';
// Ports via the ONE pure resolver (change: emulator-port-offset): unset
// RUSHPOINT_EMULATOR_PORT_OFFSET ⇒ byte-for-byte 127.0.0.1:8080 / :9099 as before.
import { resolveEmulatorHostEnv } from './emulatorPorts.mjs';

const PROJECT_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
// `??=` on purpose: an explicit *_EMULATOR_HOST (e.g. the one `emulators:exec` exports
// into its child with the ports it really bound) always wins; this only fills the gap.
const EMU_HOSTS = resolveEmulatorHostEnv(process.env);
process.env.FIRESTORE_EMULATOR_HOST     ??= EMU_HOSTS.FIRESTORE_EMULATOR_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= EMU_HOSTS.FIREBASE_AUTH_EMULATOR_HOST;

if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

export const db = admin.firestore();
export const auth = admin.auth();
export { admin };
