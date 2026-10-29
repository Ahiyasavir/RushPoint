// The first image in a drop or a paste (28.10: the setup walk's picture box takes a dragged or a
// pasted picture, not only a chosen file). Pure and total: anything that is not an image file is
// skipped, so pasting text or dropping a PDF never starts an upload.

export function firstImageFile(files: ArrayLike<File> | null | undefined): File | undefined {
  if (!files) return undefined;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f && typeof f.type === 'string' && f.type.startsWith('image/')) return f;
  }
  return undefined;
}
