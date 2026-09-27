// The poster frame a video submission carries (change: video-upload-speed, D7).
//
// A console showing many clips should load many small pictures, not many videos. So at send the
// phone draws one frame of the clip into a 480 px JPEG (~20 to 40 KB) and uploads it beside the
// clip. EVERYTHING here fails open: no frame, a timeout or an error means "no poster", never a
// blocked or slower submission. The sizing is pure (scripts/test-poster-frame.ts); the capture
// itself needs a real <video>, so it is verified in the browser.

export const POSTER_MAX_WIDTH = 480;
export const POSTER_JPEG_QUALITY = 0.7;
export const POSTER_TIMEOUT_MS = 3000;
/** Seek a little in: frame 0 of a recording is often black while the camera settles. */
export const POSTER_SEEK_SECONDS = 0.5;

export function posterSize(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, POSTER_MAX_WIDTH / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The poster uploads under the same mission's folder with its own name. */
export function posterTaskId(taskId: string): string {
  return `${taskId}-poster`;
}

/** One JPEG frame of the clip, or null. Never throws, never takes longer than the timeout. */
export function capturePosterFrame(clip: Blob, timeoutMs = POSTER_TIMEOUT_MS): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    let done = false;
    let url = '';
    let video: HTMLVideoElement | null = null;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (video) { video.removeAttribute('src'); video.load(); } } catch { /* best effort */ }
      try { if (url) URL.revokeObjectURL(url); } catch { /* best effort */ }
      resolve(b);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      url = URL.createObjectURL(clip);
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const draw = () => {
        try {
          const size = video ? posterSize(video.videoWidth, video.videoHeight) : null;
          if (!video || !size) { finish(null); return; }
          const canvas = document.createElement('canvas');
          canvas.width = size.width;
          canvas.height = size.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { finish(null); return; }
          ctx.drawImage(video, 0, 0, size.width, size.height);
          canvas.toBlob((b) => finish(b && b.size > 0 ? b : null), 'image/jpeg', POSTER_JPEG_QUALITY);
        } catch { finish(null); }
      };
      video.addEventListener('seeked', draw, { once: true });
      video.addEventListener('loadeddata', () => {
        try {
          // A MediaRecorder WebM often reports duration Infinity until played through; seeking a
          // short way in still works, and if it does not, the timeout answers.
          const d = video!.duration;
          const target = Number.isFinite(d) && d > 0 ? Math.min(POSTER_SEEK_SECONDS, d / 2) : POSTER_SEEK_SECONDS;
          video!.currentTime = target;
        } catch { draw(); }
      }, { once: true });
      video.addEventListener('error', () => finish(null), { once: true });
      video.src = url;
    } catch {
      finish(null);
    }
  });
}
