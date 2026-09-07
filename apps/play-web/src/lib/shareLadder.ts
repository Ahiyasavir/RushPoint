// The ONE native-share / download / clipboard ladder (change: share-ladder-unification).
//
// Five call sites had each hand-rolled this same sequence — storyCard, podiumCard,
// sharePhoto, challengeCard, recapCollage — and they drifted, silently, in two ways
// that no gate could see because every one of them still compiled, still passed
// typecheck and still worked perfectly on Chrome desktop:
//
//  (1) **A cancelled share was reported as a FAILURE.** `navigator.share()` rejects
//      with a DOMException named `AbortError` when the user dismisses the OS share
//      sheet — which is not an error, it is the single most common outcome of tapping
//      a share button. Only challengeCard and recapCollage mapped it to 'cancelled';
//      storyCard's catch block literally read `/* cancelled */ return 'failed'`.
//      `shareOutcomeFeedback` (lib/shareFeedback.ts) exists precisely to turn
//      'cancelled' into 'silent' and 'failed' into a visible "couldn't share" notice —
//      so on the three drifted ladders the two cases were indistinguishable, and call
//      sites "fixed" it by staying silent on BOTH. That makes a genuine failure a
//      dead button: the player taps share on the finish screen, the canvas or the
//      clipboard is blocked, and absolutely nothing happens.
//
//  (2) **`URL.revokeObjectURL` fired synchronously on the line after `a.click()`.**
//      Chrome tolerates this; Firefox and older WebKit have not finished reading the
//      blob when the URL is torn down, so the download silently produces nothing. The
//      anchor was also never inserted into the document, which some engines require.
//      Both are textbook "works on the machine it was written on" defects.
//
// So the ladder lives here once, is total (never throws), and returns the full
// five-member outcome union every time. Adding a new share surface means calling
// `routeShare`, never re-deriving the sequence.
export type ShareOutcome = 'shared' | 'downloaded' | 'copied' | 'failed' | 'cancelled';

/** The slice of Navigator the ladder uses; the Web Share API is optional everywhere. */
export type ShareNav = Navigator & {
  share?: (d: { title?: string; text?: string; url?: string; files?: File[] }) => Promise<void>;
  canShare?: (d: { files?: File[] }) => boolean;
};

/**
 * Runtime presence check for the Web Share API.
 *
 * NOT `if (nav.share)`, which is what the five hand-rolled ladders all used:
 * lib.dom declares `Navigator.share` as a REQUIRED method, so intersecting it
 * with an optional `share?` still yields a non-optional property and TypeScript
 * narrows the truthiness test away as always-true. The guard therefore looked
 * like a capability check while asserting nothing the compiler could verify —
 * and the API really is absent on desktop Firefox and every non-secure context,
 * so the check has to survive as a runtime `typeof`.
 */
export function canNativeShare(nav: ShareNav): boolean {
  return typeof nav.share === 'function';
}

/**
 * True when a rejected `navigator.share()` means "the user backed out", not
 * "sharing broke". Both the DOMException name and the legacy WebKit message are
 * accepted — iOS Safari has shipped an `AbortError` whose name was preserved but
 * whose constructor differs across versions, so match on the NAME, never on
 * `instanceof DOMException`.
 */
export function isShareCancel(e: unknown): boolean {
  const name = (e as { name?: string } | null | undefined)?.name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/**
 * Invoke the native share sheet, mapping a dismissal to 'cancelled'.
 * Total: any rejection resolves, nothing throws.
 */
export async function nativeShare(
  nav: ShareNav,
  data: { title?: string; text?: string; url?: string; files?: File[] },
): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await nav.share!(data);
    return 'shared';
  } catch (e) {
    return isShareCancel(e) ? 'cancelled' : 'failed';
  }
}

/**
 * Save a blob to the user's device as `filename`.
 *
 * The object URL is revoked on a later task, NOT on the next line: a synchronous
 * revoke races the browser's own read of the blob and silently yields an empty or
 * absent file outside Chrome. The anchor is attached to the document for the same
 * class of reason — a detached anchor's click is ignored by some engines. Returns
 * false if the environment has no DOM to download into, so the caller can fall
 * through to the clipboard rather than reporting a success that never happened.
 */
export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Deferred teardown — see the doc comment. 60s is far longer than any engine
    // needs and costs nothing: the URL is revoked either way, so nothing leaks.
    setTimeout(() => {
      try { a.remove(); } catch { /* already gone */ }
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
    }, 60_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `text`, resolving 'copied' or 'failed' — never throwing.
 *
 * Takes the navigator rather than reaching for the global, so the ladder has ONE
 * injection point: every step of `routeShare` reads the same `nav`. A clipboard
 * step that quietly consulted the global while the share steps used the injected
 * one would make the last rung of the ladder the only untestable one.
 */
export async function copyText(text: string, nav: ShareNav = navigator as ShareNav): Promise<'copied' | 'failed'> {
  try {
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export interface RouteShareOptions {
  /** The rendered card. Null/undefined ⇒ skip straight to the text ladder. */
  blob: Blob | null | undefined;
  /** Download name AND the name given to the shared File. */
  filename: string;
  /** Caption sent with the native share and copied by the clipboard fallback. */
  text: string;
  /** Optional link shared alongside the file and appended to the copied text. */
  url?: string;
  /** Title for the text-only native share. */
  title?: string;
  /** Injectable for tests; defaults to the real navigator. */
  nav?: ShareNav;
}

/**
 * Route a rendered card through the full ladder, best channel first:
 *
 *   file share → download → text share → clipboard
 *
 * A cancellation at ANY native step ends the ladder as 'cancelled': the user said
 * no, and silently downloading the file anyway would be the app overriding them.
 * A genuine failure falls through to the next channel, so the content still lands
 * somewhere the player can reach it.
 */
export async function routeShare(opts: RouteShareOptions): Promise<ShareOutcome> {
  const nav = opts.nav ?? (navigator as ShareNav);
  const textWithUrl = opts.url ? `${opts.text} ${opts.url}`.trim() : opts.text;

  if (opts.blob) {
    const file = new File([opts.blob], opts.filename, { type: opts.blob.type || 'image/png' });
    if (canNativeShare(nav) && nav.canShare?.({ files: [file] })) {
      const r = await nativeShare(nav, { files: [file], text: opts.text, ...(opts.url ? { url: opts.url } : {}) });
      if (r !== 'failed') return r; // 'shared' or the user's 'cancelled'
      // A real file-share failure (not a dismissal) still deserves the file.
    }
    if (downloadBlob(opts.blob, opts.filename)) return 'downloaded';
  }

  if (canNativeShare(nav)) {
    const r = await nativeShare(nav, { title: opts.title ?? 'RushPoint', text: opts.text, ...(opts.url ? { url: opts.url } : {}) });
    if (r !== 'failed') return r;
  }

  return copyText(textWithUrl, nav);
}
