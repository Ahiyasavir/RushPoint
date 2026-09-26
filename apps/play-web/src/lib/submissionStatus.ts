// One truthful status per media mission (change: submission-status-truth).
//
// Reproduced 2026-09-25 at 375×812 against a review-required photo mission:
//   * after a SUCCESSFUL send the screen showed "הוגש. ממתין לאישור." AND an upload bar reading
//     "מתחיל להעלות…" AND a primary button stuck on "עובד…": UploadProgress rendered whenever the
//     entry's `busy` was true, and `busy` was `frozen`, which the post-submit `sentFor` latch held
//     true for as long as the organizer had not decided. That IS "stuck in the middle".
//   * after an organizer REJECTION the card said "try again" while "retake" stayed disabled: the
//     latch only cleared when the task id changed, and a rejection keeps the task.
//   * after a RELOAD the pending submission vanished (its line lived only in local state) and
//     players sent it again. Production disk holds one 6.7 MB clip uploaded 5 times in 50 s.
//
// Every fact the correct screen needs already reaches the device: the participant sanitizer
// copies the whole `taskSubmissions` map (status, submittedAt, photoUrl, reviewNote). This module
// turns local in-flight flags + that server record into exactly ONE phase. It names only phases
// the platform performs: there is no transcription or image analysis, so there is no such phase.
//
// Pure and total: scripts/test-submission-status.ts.

export type SubmissionPhase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'uploading'; pct: number | null }
  | { kind: 'retrying' }
  | { kind: 'saving' }
  | { kind: 'waitingForApproval'; sentAtMs: number | null; mediaUrl: string | null }
  | { kind: 'approved' }
  | { kind: 'rejected'; note: string }
  | { kind: 'failed'; reason: SubmissionFailReason };

export type SubmissionFailReason = 'network' | 'tooLarge' | 'refused' | 'unknown';

/** What THIS device is doing right now. */
export interface SubmissionLocal {
  preparing: boolean;
  uploading: boolean;
  uploadPct: number | null;
  retrying: boolean;
  saving: boolean;
  failed: SubmissionFailReason | null;
}

/** The team's stored submission for this mission, exactly as the sanitized payload carries it. */
export interface SubmissionServerRecord {
  status?: unknown;
  submittedAt?: unknown;
  photoUrl?: unknown;
  reviewNote?: unknown;
}

const MAX_NOTE_CHARS = 280;

function isRecord(v: unknown): v is SubmissionServerRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Precedence, highest first:
 *  1. a LOCAL in-flight phase (preparing → retrying/uploading → saving): it describes something
 *     happening on this device right now, including a re-send over an older rejection;
 *  2. the SERVER record: rejected / approved / pending;
 *  3. a local failure;
 *  4. idle.
 */
export function submissionPhase(input: {
  local: SubmissionLocal;
  server: SubmissionServerRecord | null | undefined;
}): SubmissionPhase {
  const local = input?.local;
  if (local?.preparing) return { kind: 'preparing' };
  if (local?.retrying) return { kind: 'retrying' };
  if (local?.uploading) {
    const pct = typeof local.uploadPct === 'number' && Number.isFinite(local.uploadPct)
      ? Math.max(0, Math.min(100, Math.round(local.uploadPct)))
      : null;
    return { kind: 'uploading', pct };
  }
  if (local?.saving) return { kind: 'saving' };

  const server = input?.server;
  if (isRecord(server)) {
    if (server.status === 'rejected') {
      const note = typeof server.reviewNote === 'string' ? server.reviewNote.trim().slice(0, MAX_NOTE_CHARS) : '';
      return { kind: 'rejected', note };
    }
    if (server.status === 'approved') return { kind: 'approved' };
    if (server.status === 'pending') {
      const parsed = typeof server.submittedAt === 'string' ? Date.parse(server.submittedAt) : NaN;
      return {
        kind: 'waitingForApproval',
        sentAtMs: Number.isFinite(parsed) ? parsed : null,
        mediaUrl: typeof server.photoUrl === 'string' && server.photoUrl ? server.photoUrl : null,
      };
    }
  }

  if (local?.failed) return { kind: 'failed', reason: local.failed };
  return { kind: 'idle' };
}

/**
 * Which record describes this mission's submission right now.
 *
 * `optimistic` is what THIS device just sent, held until the team snapshot carries it. It replaces
 * the old `sentFor` latch, whose job was closing the double-send window between a successful submit
 * and the next state refresh (live run 2026-09-17: a video re-uploaded because the control came back
 * live in that window). The server record wins as soon as it is about the SAME file, so an
 * organizer's verdict on it shows at once; a server record about an OLDER file is stale for this
 * purpose and does not.
 */
export function pickSubmissionRecord(
  server: SubmissionServerRecord | null | undefined,
  optimistic: SubmissionServerRecord | null | undefined,
): SubmissionServerRecord | null {
  if (!isRecord(optimistic)) return isRecord(server) ? server : null;
  if (!isRecord(server)) return optimistic;
  return server.photoUrl === optimistic.photoUrl ? server : optimistic;
}

/** A phase in which the send control must not be offered (the submission already stands). */
export function submissionStands(phase: SubmissionPhase): boolean {
  return phase.kind === 'waitingForApproval' || phase.kind === 'approved';
}

/** A phase with bytes or a call in flight on this device. */
export function submissionInFlight(phase: SubmissionPhase): boolean {
  return phase.kind === 'preparing' || phase.kind === 'uploading' || phase.kind === 'retrying' || phase.kind === 'saving';
}
