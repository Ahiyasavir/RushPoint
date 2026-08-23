// Failure-surfacing decisions, extracted from the components so they can be
// tested (change: play-no-silent-failures). play-web has no component test
// runner, so anything left inside a .tsx can only be eyeballed — these four
// pure functions are covered by scripts/test-failure-visibility.ts.
//
// HARD RULE for every classifier here: read the rejection's `code` ONLY, never
// its free-form `message`. Classifying by message text is how an untranslated
// server string ("Missing or insufficient permissions") ends up rendered to a
// Hebrew-speaking volunteer. No code ⇒ 'generic' ⇒ localized fallback copy.

// ─── 1. Task-card message tone ───────────────────────────────────────────────
// TaskRunner's single `msg` sink carries BOTH progress ("Uploading photo…") and
// rejections ("Too far, 120m away") and used to render them in identical neutral
// grey. The tone travels with the text so the two can never be confused again.
export type MessageTone = 'error' | 'progress';

export interface TaskMessage {
  text: string;
  tone: MessageTone;
}

/** Static Tailwind class string for a task-card message of this tone. */
export function taskMessageClass(tone: MessageTone): string {
  return tone === 'error'
    ? 'text-center text-sm mt-3 font-medium text-rp-alert'
    : 'text-center text-sm mt-3 text-zinc-300';
}

// ─── 2. Staff-console rejections ─────────────────────────────────────────────
export type StaffFailureKey =
  | 'sessionExpired'
  | 'notFound'
  | 'rateLimited'
  | 'offline'
  | 'generic';

export interface StaffFailure {
  /** Key into `t.staff` — the copy the volunteer actually reads. */
  key: StaffFailureKey;
  /**
   * The staff custom token is no longer accepted, so nothing on this screen can
   * succeed again. The console offers a button back to the PIN screen; it never
   * signs the volunteer out on its own.
   */
  sessionExpired: boolean;
}

/**
 * Read a Firebase/HttpsError `code` off an unknown rejection, stripping the
 * `functions/` prefix. Returns '' when there is no usable code — which is the
 * signal to fall back to generic localized copy rather than echo anything.
 */
function bareCode(e: unknown): string {
  if (!e || typeof e !== 'object') return '';
  const raw = (e as { code?: unknown }).code;
  if (typeof raw !== 'string') return '';
  return raw.replace(/^functions\//, '');
}

export function classifyStaffError(e: unknown): StaffFailure {
  switch (bareCode(e)) {
    // Firestore/Functions emit these only for a genuinely rejected identity, not
    // for a transient hiccup — so mapping them to "session expired" is safe.
    case 'permission-denied':
    case 'unauthenticated':
      return { key: 'sessionExpired', sessionExpired: true };
    case 'not-found':
      return { key: 'notFound', sessionExpired: false };
    case 'resource-exhausted':
      return { key: 'rateLimited', sessionExpired: false };
    case 'unavailable':
    case 'deadline-exceeded':
      return { key: 'offline', sessionExpired: false };
    default:
      return { key: 'generic', sessionExpired: false };
  }
}

// ─── 3. Staff announcement payload ───────────────────────────────────────────
export interface AnnouncementPayload {
  message: string;
  messageHe?: string;
}

/**
 * Build the `pushAnnouncement` payload from the composer's two fields, or null
 * when there is nothing to send.
 *
 * The load-bearing case is HEBREW ONLY. Participants render
 * `lang === 'he' && messageHe ? messageHe : message` (LiveOps.tsx), so shipping
 * a Hebrew-only announcement with an empty `message` would show an EMPTY bubble
 * to every English-language participant. We duplicate the Hebrew into `message`
 * instead: the callable contract is unchanged (`message` stays a non-empty
 * string) and everyone sees the text the volunteer meant to broadcast.
 */
export function announcementPayload(en: string, he: string): AnnouncementPayload | null {
  const e = (en ?? '').trim();
  const h = (he ?? '').trim();
  if (!e && !h) return null;
  if (!e) return { message: h, messageHe: h };
  if (!h) return { message: e };
  return { message: e, messageHe: h };
}

// ─── 4. Routing-wait retry reveal ────────────────────────────────────────────
const ROUTING_RETRY_AFTER_MS = 12_000;

/**
 * Should the "finding your next task" card show its retry button yet?
 * Hidden for the first ~12s (routing normally lands well inside that), then
 * revealed. Once the player has retried at least once the option stays visible
 * immediately, so a second retry never costs another 12s wait.
 */
export function shouldOfferRetry(waitedMs: number, attempt: number): boolean {
  if (attempt > 0) return true;
  if (!Number.isFinite(waitedMs)) return false;
  return waitedMs >= ROUTING_RETRY_AFTER_MS;
}
