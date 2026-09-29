// The mission in a sheet over the map (change: play-screen-no-scroll).
//
// Field report 2026-09-27: "no scrolling at all". The map fills the game screen and the mission
// sits in a sheet at three heights (peek / half / full), the pattern every map app uses. The PAGE
// never scrolls; the sheet's own content scrolls inside it when a mission is longer than the phone.
// Snap decisions are pure (lib/sheetSnap.ts). Drag the handle, or tap it to step up (and from full
// back down to half). Reduced motion ⇒ no transition.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { snapHeights, nextSnap, fitSnap, boxSnapHeights, type SnapPoint, type SnapHeights } from '../lib/sheetSnap';
import { useT } from '../i18nContext';

export default function MissionSheet({ children, openKey, headerH = 56, onHeight, mapFirst = false }: {
  children: ReactNode;
  /** A sealed "walk to the point" mission: the map is the instruction, so open at half (fitSnap). */
  mapFirst?: boolean;
  /** The sheet's settled height, so the map can keep its subject ABOVE the sheet. */
  onHeight?: (px: number) => void;
  /** When this changes (a new mission), the sheet opens at the height that shows it (fitSnap). */
  openKey?: string | null;
  headerH?: number;
}) {
  const { t } = useT();
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 667));
  const [snap, setSnap] = useState<SnapPoint>('half');
  const [dragDy, setDragDy] = useState(0);
  const drag = useRef<{ startY: number; lastY: number; lastT: number; v: number } | null>(null);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The heights come from the sheet's own CONTAINER (the map area under the header), not the window:
  // measured on 375x667, "full" from the window rose over the header and covered the SOS button.
  const [boxH, setBoxH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return undefined;
    const measure = () => setBoxH(parent.clientHeight);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(parent);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // A new mission opens tall enough to show its action (fitSnap): half when it fits, full when it
  // does not (overnight 2026-09-29, played at 375x667).
  // A layout effect, not requestAnimationFrame: it runs right after the new mission is in the DOM
  // and before paint, so there is no flash of the wrong height, and it does not wait on a frame that a
  // backgrounded tab never draws.
  useLayoutEffect(() => {
    if (!openKey) return;
    const el = contentRef.current;
    const hNow: SnapHeights = boxSnapHeights(rootRef.current?.parentElement?.clientHeight ?? 0)
      ?? snapHeights(window.innerHeight, headerH);
    setSnap(el ? fitSnap(el.scrollHeight, hNow, { mapFirst }) : 'half');
  }, [openKey, headerH, mapFirst]);

  const h = (boxH != null ? boxSnapHeights(boxH) : null) ?? snapHeights(vh, headerH);
  const height = Math.max(h.peek, Math.min(h.full, h[snap] - dragDy));
  const settled = h[snap];
  useEffect(() => { onHeight?.(settled); }, [settled, onHeight]);

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: performance.now(), v: 0 };
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    d.v = (e.clientY - d.lastY) / Math.max(1, now - d.lastT);
    d.lastY = e.clientY;
    d.lastT = now;
    setDragDy(e.clientY - d.startY);
  }
  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = d.lastY - d.startY;
    setDragDy(0);
    if (Math.abs(dy) < 6) {
      // A tap: step up, and from the top back to half.
      setSnap((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'half'));
      return;
    }
    setSnap((s) => nextSnap(s, dy, d.v, h));
  }

  const label = snap === 'full' ? t.play.sheetCollapse : t.play.sheetExpand;
  return (
    <div
      ref={rootRef}
      data-testid="mission-sheet"
      data-snap={snap}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl bg-app-bg border-t border-glass-border shadow-task-card motion-safe:transition-[height] motion-safe:duration-200"
      style={{ height, transitionProperty: dragDy ? 'none' : undefined }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        title={label}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSnap((s) => (s === 'full' ? 'half' : s === 'half' ? 'full' : 'half')); } }}
        className="shrink-0 flex justify-center items-center min-h-[28px] cursor-grab touch-none select-none"
      >
        <span aria-hidden="true" className="block w-12 h-1.5 rounded-full bg-zinc-600" />
      </div>
      <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        {children}
      </div>
    </div>
  );
}
