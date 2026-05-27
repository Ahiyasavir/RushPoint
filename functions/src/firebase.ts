import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();
// Optional fields (e.g. a gold slot with no taskTitle) must not crash writes.
// Firestore rejects `undefined` in documents/arrays unless told to ignore it.
db.settings({ ignoreUndefinedProperties: true });
export const auth = admin.auth();
export const storage = admin.storage();
