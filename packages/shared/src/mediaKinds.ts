// Media-kind gate for photo-pipeline submissions (change: audio-tasks).
//
// A photo-type task can capture either a photo (default) or an audio clip via the
// SAME ingest machinery — `task.smart.captureKind`. This pure helper is the single
// content-type gate shared by the server (submitStationPhoto) and the RED-first
// pure test. Dependency-free; exported from @rushpoint/shared.

export type MediaKind = 'photo' | 'audio';

// The exact audio content-types a captureKind:'audio' submission may declare.
// MediaRecorder emits 'audio/webm;codecs=opus' (Chrome/Firefox) or 'audio/mp4'
// (Safari); 'audio/mpeg'/'audio/ogg' cover other encoders. Codec params are
// stripped by normalizeContentType before matching, so this stays exact-match.
// Widened beyond the four MediaRecorder outputs (change: audio-recorder-fallback).
// When MediaRecorder is unavailable — an in-app WhatsApp/Instagram webview, or an
// Android build where the constructor throws — the player records with the PHONE's
// own recorder and picks the file. Those recorders emit containers MediaRecorder
// never produces: Android gives audio/3gpp or audio/amr, iOS gives audio/x-m4a or
// audio/aac. Without them the fallback is a dead end WITH EXTRA STEPS: the file
// uploads and is then refused by the server.
// Keep in sync with ALLOWED_CONTENT_TYPES in functions/server.js and storage.rules.
export const AUDIO_CONTENT_TYPES = [
  'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg',
  'audio/aac', 'audio/x-m4a', 'audio/3gpp', 'audio/amr',
] as const;

// 'audio/webm;codecs=opus' -> 'audio/webm'. Also lowercases + trims so a
// browser-supplied blob type matches the allowlist and the storage.rules regex.
export function normalizeContentType(ct: string): string {
  return ct.split(';')[0].trim().toLowerCase();
}

// kind 'photo': accepts any image/* (an omitted content-type is allowed too, so
//   existing play-web clients that never send one keep working).
// kind 'audio': REQUIRES a content-type and accepts exactly the normalized
//   AUDIO_CONTENT_TYPES. Cross submissions are rejected both ways (an image type
//   on an audio task, an audio type on a photo task).
export function isAllowedSubmissionContentType(
  kind: MediaKind,
  contentType: string | undefined,
): boolean {
  if (kind === 'audio') {
    if (!contentType) return false;
    return (AUDIO_CONTENT_TYPES as readonly string[]).includes(normalizeContentType(contentType));
  }
  // photo
  if (contentType === undefined) return true;
  return normalizeContentType(contentType).startsWith('image/');
}
