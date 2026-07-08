// Station QR payload (change: qr-station-scan). A printed station QR is just a
// versioned carrier for the station's existing secret code — it feeds the
// EXISTING verifyStationCode flow, adds no backend surface, and is not
// authentication (the code IS the shared secret). The `RP1:` prefix is a strict
// gate: a scanned grocery barcode, a foreign QR, or a future `RP2:` payload
// parses to null and is never submitted, and the version can bump later without
// breaking already-printed sheets. Pure and dependency-free.

/** Versioned prefix for a station QR payload. Pinned literally — printed sheets
 * in the field carry this exact string, so changing it breaks old QR sheets. */
export const STATION_QR_PREFIX = 'RP1:';

/**
 * Build the QR payload string for a station secret code: `RP1:<trimmed code>`.
 * Throws on an empty / whitespace-only code — a creator bug we want loud at
 * print time, not a blank QR taped to a wall in the field.
 */
export function buildStationQrPayload(code: string): string {
  const trimmed = (code ?? '').trim();
  if (trimmed === '') {
    throw new Error('buildStationQrPayload: code must be a non-empty string');
  }
  return STATION_QR_PREFIX + trimmed;
}

/**
 * Inverse of buildStationQrPayload. Returns the trimmed station code, or null
 * when the text is null/empty, the `RP1:` prefix is missing or foreign (grocery
 * barcode, someone else's QR, a future `RP2:` payload), or the remainder trims
 * to ''. null ⇒ the scanner keeps scanning and NEVER submits.
 */
export function parseStationQrPayload(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  if (!text.startsWith(STATION_QR_PREFIX)) return null;
  const code = text.slice(STATION_QR_PREFIX.length).trim();
  return code === '' ? null : code;
}
