// A confetti burst — CSS-driven, no charting/animation dependency.
//
// Extracted from QuickSetup.tsx (change: smart-build-delight) so the smart
// build's reveal and the quick-setup celebration fire the SAME confetti rather
// than two copies that drift. The keyframes and the reduced-motion rule live in
// src/index.css (`.rp-confetti-field`, `@keyframes rp-confetti-fall`) — note the
// stylesheet already hides the whole field under `prefers-reduced-motion`, so no
// caller needs to guard for it.
import { useRef } from 'react';

/** One confetti piece: a randomized fall, deterministic only in its CSS shape. */
function ConfettiPiece({ index }: { index: number }) {
  const seed = useRef(Math.random());
  const left = (seed.current * 94 + (index * 37) % 94) % 96;
  const hue = [0, 32, 48, 200, 260][index % 5];
  const delay = (index % 10) * 0.06;
  const duration = 1.7 + (index % 5) * 0.22;
  const drift = ((index % 7) - 3) * 14;
  return (
    <span
      className="rp-confetti-piece"
      style={{
        left: `${left}%`,
        background: `hsl(${hue} 85% 60%)`,
        animationDelay: `${delay}s`,
        animationDuration: `${duration}s`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['--rp-confetti-drift' as any]: `${drift}px`,
      }}
    />
  );
}

export default function ConfettiBurst() {
  return (
    <div className="rp-confetti-field" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => <ConfettiPiece key={i} index={i} />)}
    </div>
  );
}
