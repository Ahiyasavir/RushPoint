// SHA-256 of a captured file, as lowercase hex (change: rejected-photo-resend).
//
// The server counts rejections per hash so the same picture cannot be sent a third time. Hashing is
// a convenience, never a gate: no `crypto.subtle` (an insecure origin, an old WebView) or any
// failure resolves to null, and a submission without a hash is accepted as before.
export async function mediaHashOf(file: Blob | null | undefined): Promise<string | null> {
  try {
    if (!file || typeof crypto === 'undefined' || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
