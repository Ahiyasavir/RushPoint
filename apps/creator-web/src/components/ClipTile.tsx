import { clipLengthLabel, clipPreload } from '../lib/clipTile';
import { useT } from './LanguageContext';

// One submitted clip in the console (change: video-upload-speed, D7). Every video surface uses
// this, so "show the poster, fetch nothing until play" is decided once: a console of 35 clips
// used to ask the server for 35 video byte ranges before anyone pressed play.
export default function ClipTile({ src, posterUrl, durationSec, className, ariaLabel }: {
  src: string;
  posterUrl?: string | null;
  durationSec?: number | null;
  className?: string;
  ariaLabel?: string;
}) {
  const t = useT();
  const length = clipLengthLabel(durationSec);
  return (
    <div className="relative">
      <video
        controls
        playsInline
        preload={clipPreload(posterUrl)}
        poster={posterUrl || undefined}
        src={src}
        aria-label={ariaLabel}
        className={className}
      />
      {length && (
        <span
          className="pointer-events-none absolute top-1 end-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-mono text-white"
          aria-label={t.runConsole.clipLength({ time: length })}
        >
          {length}
        </span>
      )}
    </div>
  );
}
