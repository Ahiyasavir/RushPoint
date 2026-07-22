// Callable-rejection → localized-copy mapping for the creator console
// (change: play-no-silent-failures).
//
// The wallet page used to render `e.message` straight into a dialog — raw
// English, at the exact moment money is involved, in a Hebrew-first product.
// These classifiers read the rejection's `code` ONLY; free-form message text is
// never inspected and never rendered (it goes to the console instead).

export type CallFailureKey =
  | 'rateLimited'
  | 'offline'
  | 'notAllowed'
  | 'generic';

export type BillingFailureKey =
  | 'insufficientFunds'
  | 'rateLimited'
  | 'offline'
  | 'notConfigured'
  | 'generic';

/** Bare Firebase/Functions error code, `functions/` prefix stripped, '' if none. */
function bareCode(e: unknown): string {
  if (!e || typeof e !== 'object') return '';
  const raw = (e as { code?: unknown }).code;
  if (typeof raw !== 'string') return '';
  return raw.replace(/^functions\//, '');
}

/** Generic mapping for any creator-side callable rejection. */
export function classifyCallError(e: unknown): CallFailureKey {
  switch (bareCode(e)) {
    case 'resource-exhausted':
      return 'rateLimited';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'offline';
    case 'permission-denied':
    case 'unauthenticated':
      return 'notAllowed';
    default:
      return 'generic';
  }
}

/**
 * Billing-specific mapping (purchaseCredits / subscribePro). `failed-precondition`
 * is what the payments module throws when the wallet cannot cover the action;
 * `unimplemented` is what a payments-disabled deployment returns.
 */
export function classifyBillingError(e: unknown): BillingFailureKey {
  switch (bareCode(e)) {
    case 'failed-precondition':
      return 'insufficientFunds';
    case 'resource-exhausted':
      return 'rateLimited';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'offline';
    case 'unimplemented':
      return 'notConfigured';
    default:
      return 'generic';
  }
}
