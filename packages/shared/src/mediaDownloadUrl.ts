// Ask the media route to SAVE rather than display (change: download-actually-downloads)
//
// THE BUG. Both download buttons - the organizer's media gallery and the player's
// "keep a copy" - were plain `<a download href="https://api.rush-point.com/uploads/…">`.
// **The `download` attribute is ignored on a CROSS-ORIGIN url.** The browser has no
// obligation to honour a filename the linking page chose for somebody else's server,
// so it navigates instead: the organizer reported "it just opens the image in a tab
// and does not download it", which is the specified behaviour, not a browser quirk.
//
// The server already had the answer. `functions/mediaServing.js` sets
// `Content-Disposition: attachment` when the request carries `?download=1`, and a
// Content-Disposition from the SERVING origin is authoritative - it is the one thing
// that makes a cross-origin save work. Nothing was asking for it.
//
// So this is the whole fix: put the flag on the url. Kept in shared, and used by both
// apps, because the two surfaces drifting apart is how one of them ended up broken
// while the other looked fine.
//
// Dependency-free and total — scripts/test-media-download-url.ts.

/** The query flag `functions/mediaServing.js` reads. */
export const MEDIA_DOWNLOAD_FLAG = 'download';

/**
 * The same object, asked for as an attachment.
 *
 * Total: anything that is not a usable absolute or root-relative url is returned
 * unchanged rather than corrupted into one. A download button that does nothing is a
 * disappointment; a button that navigates somewhere invented is worse.
 *
 * Preserves an existing query string and fragment, and is idempotent — calling it
 * twice cannot produce `?download=1&download=1`.
 */
export function mediaDownloadUrl(url: string | null | undefined): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed === '') return '';
  // A blob:/data: url is already local to this page, where `download` DOES work, and
  // appending a query to either one breaks it.
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;

  // Split off a fragment so the flag lands on the query, not inside the hash.
  const hashAt = trimmed.indexOf('#');
  const hash = hashAt >= 0 ? trimmed.slice(hashAt) : '';
  const base = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;

  const [path, query = ''] = base.split('?', 2);
  const parts = query.split('&').filter((p) => p !== '');
  // Idempotent: never add the flag twice.
  if (parts.some((p) => p === MEDIA_DOWNLOAD_FLAG || p.startsWith(`${MEDIA_DOWNLOAD_FLAG}=`))) {
    return trimmed;
  }
  parts.push(`${MEDIA_DOWNLOAD_FLAG}=1`);
  return `${path}?${parts.join('&')}${hash}`;
}
