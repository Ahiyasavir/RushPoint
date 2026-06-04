// Functions-side adapter for the pure validators in @rushpoint/shared.
//
// `validate()` runs the payload checks and, on the first failure, rethrows the
// pure ValidationError as an `invalid-argument` HttpsError whose `details` carry
// the wrapped `{ success:false, error:{ field, constraint, message, messageHe } }`
// shape — a typed, bilingual error the client can render, never a raw stack trace.
// Any non-validation throw is re-raised unchanged.

import * as functions from 'firebase-functions';
import { ValidationError } from '@rushpoint/shared';

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
