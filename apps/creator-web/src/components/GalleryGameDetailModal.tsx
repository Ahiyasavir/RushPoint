// Game detail modal (change: gallery-game-card-preview).
//
// Opened by pressing a public GAME card in the Gallery's games tab. It renders
// EXACTLY the view model it is handed (`buildGalleryGameDetail`) and knows nothing
// about `PublicGame` fields directly. It is the parallel of
// `GalleryTaskDetailModal` (missions) — deliberately a SEPARATE component so the
// mission modal's secrecy contract cannot regress by accident, and lighter: a game
// carries only a coarse location LABEL, so this modal imports NO map.
//
// Nothing is fetched on open: `searchGallery` already returned the whole sanitized
// game, so the detail is built from data the caller is holding.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, TagChips } from './ui';
import { useT } from './LanguageContext';
import { buildGalleryGameDetail } from '../lib/galleryGameDetail';

export default function GalleryGameDetailModal({ game, onClose, onCopy, copyBusy }: {
  /** The sanitized public game the caller already holds. */
  game: unknown;
  onClose: () => void;
  /** "Copy to my games" — the SAME action the card's Copy button runs. */
  onCopy: () => void;
  copyBusy?: boolean;
}) {
  const t = useT();
  const gl = t.gallery;
  const b = t.builder;
  const detail = buildGalleryGameDetail(game);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Escape closes, alongside the backdrop and the ✕ button. On open we lock body
  // scroll, pull focus into the panel, and restore focus to the opener on close —
  // the house modal pattern (GalleryTaskDetailModal).
  useEffect(() => {
    openerRef.current = document.activeElement;
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const MODE_LABEL: Record<string, string> = { individual: b.modeIndividual, team: b.modeTeam };
  const REQUIREMENT_LABEL: Record<'gps' | 'anywhere', string> = { gps: gl.reqGps, anywhere: gl.reqAnywhere };

  // Labelled meta rows, suppressed when they carry nothing to say. Values become
  // copy through the SAME i18n functions the cards already use, so a game reads
  // identically on its card and in its detail. Stages/tasks/plays are shown as the
  // card's own combined chips below; these rows label what the card cannot fit.
  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (detail.mode) rows.push({ key: 'mode', label: gl.detailMode, value: MODE_LABEL[detail.mode] ?? detail.mode });
  rows.push({ key: 'length', label: gl.detailLength, value: gl.valMinutes(detail.estimatedTotalMinutes) });
  if (detail.requirement) {
    rows.push({ key: 'requirement', label: gl.detailRequirement, value: REQUIREMENT_LABEL[detail.requirement] });
  }
  if (detail.locationLabel) rows.push({ key: 'location', label: gl.detailLocation, value: detail.locationLabel });

  const titleId = 'game-detail-title';

  // Portal to document.body: `fixed inset-0` must resolve against the viewport, but
  // the Gallery mounts this modal under an `animate-fade-up` ancestor whose
  // permanent transform becomes the containing block for `position: fixed`,
  // cutting the panel off. document.body carries no transform, fixing the anchoring.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-2xl max-h-[88dvh] flex flex-col overflow-hidden focus:outline-none
          rounded-2xl border border-[--rp-border] bg-[--surface-0] dark:bg-[--surface-1]
          shadow-[0_24px_64px_-12px_rgba(10,12,26,0.45)]"
      >
        <div className="flex flex-col min-h-0 flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 mb-3 shrink-0">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-[--ink-3] font-semibold">{gl.gameDetailTitle}</p>
              <h3 id={titleId} className="font-brand font-bold text-lg text-[--ink-1] leading-snug" dir="auto">
                {detail.title}
              </h3>
            </div>
            {detail.mode && <Badge color="cyan">{MODE_LABEL[detail.mode] ?? detail.mode}</Badge>}
            <button
              type="button"
              onClick={onClose}
              aria-label={gl.detailClose}
              title={gl.detailClose}
              className="shrink-0 text-[--ink-3] hover:text-[--ink-1] text-sm rounded
                focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
            >✕</button>
          </div>

          <div className="overflow-y-auto overscroll-contain min-h-0 flex-1 flex flex-col gap-3.5 pe-1">
            {/* Full description, never clamped. The clamp on the card is what sent
                the creator looking for a detail view in the first place. */}
            <p className="text-sm leading-relaxed text-[--ink-2] whitespace-pre-wrap" dir="auto">
              {detail.description ?? gl.detailNoDescription}
            </p>

            {/* The card's own combined meta chips, reused verbatim (change:
                gallery-game-card-preview) so the detail and the card read alike. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[--ink-3] font-medium">
              <span>{gl.stages(detail.stageCount)}</span>
              <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
              <span>{gl.tasks(detail.taskCount)}</span>
              <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
              <span>{gl.plays(detail.playCount)}</span>
            </div>

            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
              {rows.map((row) => (
                <div key={row.key} className="flex items-baseline justify-between gap-3 border-b border-[--rp-border] py-1.5">
                  <dt className="text-xs text-[--ink-3] shrink-0">{row.label}</dt>
                  <dd className="text-sm text-[--ink-1] font-medium text-end truncate" dir="auto">{row.value}</dd>
                </div>
              ))}
            </dl>

            {detail.tags.length > 0 && <TagChips tags={detail.tags} max={12} more={gl.moreTags} />}
          </div>

          <div className="mt-3 pt-3 border-t border-[--rp-border] flex items-center gap-3 shrink-0">
            <Button loading={copyBusy} onClick={onCopy} className="!py-2 !text-xs !font-semibold">{gl.copyBtn}</Button>
            <Button variant="ghost" onClick={onClose} className="ms-auto !py-2 !text-xs">{gl.detailClose}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
