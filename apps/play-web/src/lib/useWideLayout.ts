// One answer to "is this a computer?" for play-web (change: desktop-layouts-play-staff).
//
// Ahiya, 2026-10-05: the staff app and the player's game screen were phone layouts centred in a wide
// window. From this width up they lay out for a computer; below it nothing changes. Decided in JS,
// not with Tailwind `lg:` classes: the same components also render inside narrow containers, and a
// breakpoint asks about the window, not the box (CLAUDE.md).
import { useEffect, useState } from 'react';

export const WIDE_LAYOUT_QUERY = '(min-width: 1024px)';

export function useWideLayout(): boolean {
  const [wide, setWide] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_LAYOUT_QUERY).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(WIDE_LAYOUT_QUERY);
    const onChange = () => setWide(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    // Also on resize: a cheap fallback for an engine that changes the width without
    // firing the query's change event (a real window resize fires both).
    window.addEventListener('resize', onChange);
    return () => { mql.removeEventListener('change', onChange); window.removeEventListener('resize', onChange); };
  }, []);
  return wide;
}
