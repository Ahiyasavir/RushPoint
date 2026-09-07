// The one "save this to the creator's disk" helper (change: share-ladder-unification).
//
// Four export surfaces had each written the same six lines inline — the game file
// export in the Builder, the GDPR data export in Settings, the admin users CSV and
// the run analytics CSV — and every one of them made the same mistake:
//
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement('a');
//     a.href = url; a.download = name; a.click();
//     URL.revokeObjectURL(url);          // ← same tick as the click
//
// Chrome starts reading the blob synchronously inside `click()`, so it survives.
// Firefox and older WebKit queue the read, find the URL already revoked, and
// produce **nothing at all** — no file, no error, no console warning. The anchor
// was also never attached to the document, which some engines require before a
// programmatic click counts as a user-initiated download.
//
// Nothing could catch this: it is not a type error, not a lint error, and the only
// end-to-end coverage is a developer on Chrome watching a file appear. The worst
// instance was Settings' "export my data" — a legal obligation that silently did
// nothing for a whole class of browsers.
//
// The correct sequence already existed ~470 lines away in RunConsolePage's photo
// downloader (appendChild → click → remove). It just never travelled. So it lives
// here now, once.

/**
 * Save `blob` to the user's disk as `filename`.
 *
 * Returns false when there is no DOM to download into, so a caller can report a
 * failure rather than a success that never happened.
 */
export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(blob);
    const saved = downloadUrl(url, filename);
    // Deferred teardown — see the header. 60 s is far beyond what any engine needs
    // and costs nothing: the URL is revoked either way, so nothing leaks.
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* already revoked */ } }, 60_000);
    return saved;
  } catch {
    return false;
  }
}

/**
 * Save whatever `url` points at as `filename`. Separate from `downloadBlob`
 * because remote media (a team's uploaded photo) is downloaded by URL and has no
 * object URL to revoke.
 */
export function downloadUrl(url: string, filename: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noreferrer';
    a.style.display = 'none';
    // Attached before the click: a detached anchor's programmatic click is ignored
    // by some engines, which is the other half of the silent-no-file bug.
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

/** Save `text` as a UTF-8 file. */
export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): boolean {
  return downloadBlob(new Blob([text], { type: mime }), filename);
}

/** Save `value` as pretty-printed JSON. */
export function downloadJson(value: unknown, filename: string): boolean {
  return downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}

/**
 * Save `csv` as a spreadsheet-openable CSV.
 *
 * The UTF-8 BOM is not optional and not cosmetic: without it Excel decodes the
 * file as the system codepage and every Hebrew team name in a run export renders
 * as mojibake. One of the two CSV call sites remembered it and the other did not,
 * which is exactly the drift this module exists to end.
 */
export function downloadCsv(csv: string, filename: string): boolean {
  const BOM = '﻿';
  return downloadText(BOM + csv, filename, 'text/csv;charset=utf-8');
}
