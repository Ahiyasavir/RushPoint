// The shared top overlay stack (change: play-top-overlay-stack).
//
// Renders every status overlay pinned to the top of the participant screen into
// ONE fixed flex column, so overlapping is structurally impossible rather than a
// property of three hand-tuned offsets that happened to agree. See index.css
// (.rp-top-stack) for the geometry and lib/topOverlays.ts for the ordering.
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { TOP_OVERLAY_ORDER, slotFor, type TopOverlayKind } from '../lib/topOverlays';

interface Slots { banners: HTMLElement; toasts: HTMLElement }
let slots: Slots | null = null;

// Built on demand rather than by a host component mounting in an effect: React
// renders children BEFORE effects run, so an overlay committed in the same pass
// as its host would find no portal target and silently render nothing. Creating
// the node from the getter means the target exists the first time anyone asks.
function ensureSlots(): Slots {
  if (slots && slots.banners.isConnected) return slots;
  const root = document.createElement('div');
  root.className = 'rp-top-stack';
  // Presentational only; the live regions are on the overlays themselves, and a
  // second landmark here would announce an empty container on every page.
  root.setAttribute('aria-hidden', 'false');

  const banners = document.createElement('div');
  banners.className = 'rp-top-banners';
  const toasts = document.createElement('div');
  toasts.className = 'rp-top-toasts';
  root.append(banners, toasts);
  document.body.appendChild(root);

  // Only the BANNER slot reserves layout space. Measured rather than assumed: the
  // offline banner wraps to two lines in Hebrew on a narrow phone, and a
  // hardcoded height would put the header back under it exactly when the copy got
  // longer. ResizeObserver is supported everywhere this PWA runs; if it is ever
  // absent the variable simply stays 0px and we degrade to today's overlay.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const h = banners.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--rp-top-stack-h', h > 0 ? `${Math.round(h)}px` : '0px');
    });
    ro.observe(banners);
  }

  slots = { banners, toasts };
  return slots;
}

/** Place a status overlay in the shared top stack.
 *  Renders nothing when `show` is false, so callers keep their own visibility
 *  logic and no empty node is left behind to widen the stack's gap. */
export function TopOverlay({ kind, show = true, children }: {
  kind: TopOverlayKind; show?: boolean; children: ReactNode;
}) {
  if (!show) return null;
  const { banners, toasts } = ensureSlots();
  const target = slotFor(kind) === 'banner' ? banners : toasts;
  return createPortal(
    <div style={{ order: TOP_OVERLAY_ORDER[kind] }} className="w-full flex justify-center">
      {children}
    </div>,
    target,
  );
}
