// The Firestore implementation of the @rushpoint/data repository contract.
//
// Consumers construct it with an ALREADY-INITIALISED Firestore instance:
//
//   import * as admin from 'firebase-admin';
//   import { db } from './firebase';                  // functions/src/firebase.ts
//   import { createFirestoreRepository } from '@rushpoint/data/firestore';
//
//   export const repo = createFirestoreRepository({
//     db,
//     deleteSentinel: () => admin.firestore.FieldValue.delete(),
//   });
//
// This package never imports firebase-admin — see context.ts for why.

export {
  FirestoreContext,
  isContendedError,
  toDataError,
  type FirestoreDeps,
  type FsDatabase,
  type FsDocumentReference,
  type FsQuery,
  type FsTransaction,
  type FsWriteBatch,
} from './context';

export {
  applyPatchInMemory,
  assertNoFieldPaths,
  isEmptyPatch,
  toDocumentData,
  toUpdateData,
} from './patch';

export { colPaths, docPaths, groupIds, assertId, lastSegment } from './paths';

export {
  backoffMs,
  withLockRetry,
  DEFAULT_MAX_ATTEMPTS,
} from './transaction';

export {
  FirestoreRepository,
  createFirestoreRepository,
  chunk,
  MAX_BATCH_OPS,
} from './repository';
