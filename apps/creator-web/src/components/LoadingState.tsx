import { useEffect, useState } from 'react';

// Branded, in-game-flavoured loading indicator — a small glowing rp-fire ember
// (the same warm accent the play app uses while a run spins up) plus a short
// localized line that gently cycles through a few messages, so a wait feels like
// part of the field game instead of a bare spinner.
//
// Accessibility & motion:
//  • role="status" + a single stable sr-only line, so screen readers announce the
//    wait once (the cycling copy is aria-hidden decoration, never re-announced).
//  • Honours prefers-reduced-motion: the CSS pulses are disabled via
//    `motion-reduce:animate-none`, and the message stops cycling (it holds on the
//    first line) — the message itself always stays visible.
//  • RTL-safe: centred layout, logical spacing only, no physical ml-/mr-.
export function LoadingState({ messages, className = '' }: { messages: string[]; className?: string }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    // Don't animate the copy for users who asked for reduced motion; hold line 1.
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = window.setInterval(() => {
      setIndex((n) => (n + 1) % messages.length);
    }, 2400);
    return () => window.clearInterval(id);
  }, [messages.length]);

  const current = messages[index] ?? messages[0] ?? '';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-10 text-center ${className}`}
    >
      {/* The animated mark: a soft expanding halo behind a steady glowing ember. */}
      <span aria-hidden="true" className="relative flex h-9 w-9 items-center justify-center">
        <span className="absolute inline-flex h-full w-full rounded-full bg-rp-fire/25 animate-ping motion-reduce:animate-none" />
        <span className="relative inline-flex h-4 w-4 rounded-full bg-rp-fire shadow-glow-subtle animate-glow-pulse motion-reduce:animate-none" />
      </span>

      {/* Screen readers hear one stable line; sighted users see the copy cycle. */}
      <span className="sr-only">{messages[0]}</span>
      <p
        aria-hidden="true"
        className="min-h-[1.25rem] text-sm font-medium text-[--ink-2] transition-opacity duration-300"
      >
        {current}
      </p>
    </div>
  );
}

export default LoadingState;
