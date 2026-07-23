import { useEffect, useRef, useState } from 'react';
import { hotZoneMultiplier, type HotZone } from '@rushpoint/shared';
import { useT } from '../i18nContext';
import { haptic } from '../lib/haptics';

// Live in-run banners (deferred UI for hot-zone-bonus + safe-zone-boundary):
//   • 🔥 Hot Zone — active multiplier + countdown to expiry
//   • ⚠️ Out of bounds — the team's last location is outside the safe zone
// Both read server-provided state (run.hotZone, team.outOfBounds) — never client
// assertions. The countdown ticks locally only for display.

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export default function InRunAlerts({ hotZone, outOfBounds }: { hotZone: HotZone | null; outOfBounds?: boolean }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second only while a hot zone could be live (cheap, self-stopping).
  useEffect(() => {
    if (!hotZone) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hotZone]);

  // A zone is "active" by the same server rule (multiplier resolves > 1 at the
  // centre within the window). We pass the centre so radius never excludes it.
  const active = !!hotZone && hotZoneMultiplier(hotZone, hotZone.center, now) > 1;
  const remainMs = hotZone ? Date.parse(hotZone.expiresAt) - now : 0;

  // Buzz once on the false→true transition (a zone opening), never on each tick.
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) haptic('warn');
    wasActive.current = active;
  }, [active]);

  if (!active && !outOfBounds) return null;

  return (
    <div className="space-y-2 mb-2">
      {active && hotZone && (
        <div className="flex items-center gap-2 rounded-xl border border-rp-fire/40 bg-rp-fire/15 px-3 py-2 text-sm font-semibold text-ink-fire animate-fade-up motion-reduce:animate-none">
          <span className="text-base leading-none">🔥</span>
          <span className="flex-1">{t.play.hotZoneActive({ mult: hotZone.multiplier })}</span>
          <span className="font-mono tabular-nums">{fmtCountdown(remainMs)}</span>
        </div>
      )}
      {outOfBounds && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/15 px-3 py-2 text-sm font-semibold text-amber-300">
          <span className="text-base leading-none">⚠️</span>
          <span className="flex-1">{t.play.outOfBounds}</span>
        </div>
      )}
    </div>
  );
}
