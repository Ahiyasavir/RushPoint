import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseStationQrPayload } from '@rushpoint/shared';
import { useT } from '../i18nContext';
import { Button, Card } from './ui';

// Lazy loaded (React.lazy in TaskRunner) so jsQR + the camera code stay OUT of
// the main bundle — same rule as the MapLibre map chunk. This component owns a
// camera MediaStream + a requestAnimationFrame decode loop; every hit is gated
// through parseStationQrPayload (a foreign QR is silently ignored, never
// submitted), and the first RP1: payload fires onDecode once and stops. All
// media tracks are stopped and the RAF loop cancelled on every unmount path —
// a camera stream must never outlive the component.

// Native Barcode Detection API (Chromium on Android) — typed locally so we need
// no @types package. jsQR is the cross-browser canvas fallback.
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
}

export default function QrScanner({ onDecode, onClose }: {
  onDecode: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');

    const win = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
    const detector = win.BarcodeDetector ? new win.BarcodeDetector({ formats: ['qr_code'] }) : null;

    // A single decoded string → parse, and if it is one of ours, fire once.
    function handle(raw: string | null | undefined): boolean {
      const code = parseStationQrPayload(raw);
      if (code == null) return false;
      onDecode(code);
      return true;
    }

    async function tick() {
      if (cancelled || !video || video.readyState < 2) {
        raf = requestAnimationFrame(tick);
        return;
      }
      try {
        if (detector) {
          const hits = await detector.detect(video);
          for (const h of hits) {
            if (handle(h.rawValue)) return;
          }
        } else {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (w && h) {
            canvas.width = w;
            canvas.height = h;
            const g = canvas.getContext('2d', { willReadFrequently: true });
            if (g) {
              g.drawImage(video, 0, 0, w, h);
              const img = g.getImageData(0, 0, w, h);
              const found = jsQR(img.data, w, h);
              if (found && handle(found.data)) return;
            }
          }
        }
      } catch {
        // A transient decode error is not fatal — keep scanning.
      }
      if (!cancelled) raf = requestAnimationFrame(tick);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        raf = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setDenied(true);
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (video) video.srcObject = null;
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
    };
  }, [onDecode]);

  return (
    <Card className="space-y-3">
      {denied ? (
        <p className="text-sm text-zinc-500 text-center">{t.task.cameraDenied}</p>
      ) : (
        <>
          <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '1 / 1' }}>
            <video ref={videoRef} playsInline autoPlay muted
              className="absolute inset-0 w-full h-full object-cover" />
          </div>
          <p className="text-sm text-zinc-500 text-center">{t.task.scanQrHint}</p>
        </>
      )}
      <Button variant="ghost" onClick={onClose}>{t.task.scanClose}</Button>
    </Card>
  );
}
