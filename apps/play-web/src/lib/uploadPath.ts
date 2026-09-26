// Where a participant device's media goes (change: attached-phone-uploads).
//
// The folder is the UPLOADING DEVICE's own uid, never the team id. All three server gates
// key on the caller: the VPS upload route (`ownsUploadPath`, functions/uploadRoute.js),
// `requireStorageUrl` in submitStationPhoto (packages/shared/src/validation.ts) and
// storage.rules (`request.auth.uid == teamId` on the folder segment). The founding phone has
// uid === teamId, so building the path from the team id looked right for months, while every
// upload from an ATTACHED phone holding control was refused with 403.
//
// Pure and dependency-free: scripts/test-participant-upload-path.ts.

export interface ParticipantUploadPathInput {
  runId: string;
  /** The signed-in uid of THIS device. */
  uid: string;
  taskId: string;
  ext: string;
  nowMs: number;
}

export function participantUploadPath(p: ParticipantUploadPathInput): string {
  const safeTask = String(p.taskId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `runs/${p.runId}/teams/${p.uid}/${safeTask}-${p.nowMs}.${p.ext}`;
}

/**
 * The upload route's folder refusal, recognised by its OWN message (functions/uploadRoute.js,
 * ownsUploadPath → 403 { error: { status: 'PERMISSION_DENIED', message: 'Cannot upload to another
 * team folder' } }). Never by the status alone: Cloudflare also answers 403 (the Israel geo-block,
 * bot protection) with an HTML page, and telling that player "this phone can't send for the team"
 * would be false. Total: anything unparsable is "not this".
 */
export function isFolderRefusal(body: unknown): boolean {
  if (typeof body !== 'string' || body === '') return false;
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown; message?: unknown } } | null;
    return parsed?.error?.status === 'PERMISSION_DENIED'
      && typeof parsed.error.message === 'string'
      && /another team folder/i.test(parsed.error.message);
  } catch { return false; }
}
