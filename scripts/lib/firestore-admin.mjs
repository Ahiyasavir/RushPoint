// Firebase Admin, wired to the local emulator. Loads .env first (side-effect
// import) so RUSHPOINT_* vars are available. Exports a ready db + auth.
import './env.mjs';
import admin from 'firebase-admin';

const PROJECT_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
process.env.FIRESTORE_EMULATOR_HOST     ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });

export const db = admin.firestore();
export const auth = admin.auth();
export { admin };
