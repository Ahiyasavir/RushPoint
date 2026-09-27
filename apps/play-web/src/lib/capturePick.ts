// What should a camera `change` event do to the photo already in hand?
// (change: camera-capture-never-eats-a-photo)
//
// THE BUG THIS EXISTS FOR. `PhotoEntry.pickFile` opened with:
//
//     const f = e.target.files?.[0] ?? null;
//     if (!f) { setFile(null); setPreviewUrl(null); return; }
//
// An empty `change` is not a picture — it is the player CANCELLING the camera, which
// every mobile browser reports exactly this way. So backing out of the camera silently
// destroyed the photo they had already taken, with no error and no undo: the button
// flipped back from "retake" to "take a photo" and the submit button went dead.
// Reported from the field as "it does not save it ... it is as if it deletes it".
//
// The rule is one sentence: a capture that produced nothing must change nothing.
// Destroying work the player already did is never the right answer to an input that
// carried no information.
//
// Dependency-free and total — scripts/test-capture-pick.ts.

export type PickAction =
  /** Nothing arrived (cancelled camera). Keep whatever is already held. */
  | 'keep'
  /** A usable file arrived. It replaces whatever is held. */
  | 'replace'
  /** Something arrived and it is unusable. Say so, and keep what is held. */
  | 'reject';

export interface PickVerdict {
  action: PickAction;
  /** Why it was rejected, for the message. Empty unless `action === 'reject'`. */
  reason: '' | 'notAnImage' | 'tooLarge';
}

const KEEP: PickVerdict = { action: 'keep', reason: '' };

export interface PickedFile {
  type?: string;
  size?: number;
}

/**
 * Judge one `change` event from the camera input.
 *
 * `maxRawBytes` is the absurd-input ceiling, not the upload cap: the real limit is
 * enforced on the COMPRESSED result, so a legitimate high-megapixel capture is not
 * refused here for being big before anything has tried to shrink it.
 *
 * Total: any malformed file object is treated as "nothing arrived" rather than as a
 * rejection, because the failure direction that matters is never destroying a photo
 * the player already has.
 */
export function pickedFileVerdict(
  file: PickedFile | null | undefined,
  maxRawBytes: number,
): PickVerdict {
  if (!file || typeof file !== 'object') return KEEP;

  const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : null;
  const type = typeof file.type === 'string' ? file.type : '';

  // A zero-byte file is what several Android pickers hand back for a cancelled or
  // failed capture. It is not a picture, so it must not replace one.
  if (size === null || size <= 0) return KEEP;

  // An EMPTY type is not a refusal: some Android pickers omit it entirely, and the
  // same quirk is already handled for audio (AUDIO_EXT_TYPES). Only a type that is
  // present AND says "not an image" is a genuine wrong-file.
  if (type !== '' && !type.startsWith('image/')) {
    return { action: 'reject', reason: 'notAnImage' };
  }

  if (Number.isFinite(maxRawBytes) && maxRawBytes > 0 && size > maxRawBytes) {
    return { action: 'reject', reason: 'tooLarge' };
  }

  return { action: 'replace', reason: '' };
}
