// Functions-side adapter for the pure validators in @rushpoint/shared.
//
// `validate()` runs the payload checks and, on the first failure, rethrows the
// pure ValidationError as an `invalid-argument` HttpsError whose `details` carry
// the wrapped `{ success:false, error:{ field, constraint, message, messageHe } }`
// shape — a typed, bilingual error the client can render, never a raw stack trace.
// Any non-validation throw is re-raised unchanged.

import * as functions from 'firebase-functions';
import { ValidationError, StoredDocError } from '@rushpoint/shared';

export function validate<T>(build: () => T): T {
  try {
    return build();
  } catch (e) {
    if (e instanceof ValidationError) {
      throw new functions.https.HttpsError('invalid-argument', e.message, e.toResult());
    }
    throw e;
  }
}

// Read-boundary counterpart of `validate()`: run a stored-doc parse and, on a
// StoredDocError (a malformed document read back from Firestore — missing/wrong-
// typed required field), rethrow it as an `internal` HttpsError so the corrupt
// doc fails loud instead of feeding a mis-typed object into scoring/routing/
// payment math. Unlike a bad payload (the caller's fault ⇒ `invalid-argument`),
// a corrupt stored doc is a server-side data problem ⇒ `internal`. Any other
// throw is re-raised unchanged.
export function parseStored<T>(parse: () => T): T {
  try {
    return parse();
  } catch (e) {
    if (e instanceof StoredDocError) {
      throw new functions.https.HttpsError('internal', e.message);
    }
    throw e;
  }
}
