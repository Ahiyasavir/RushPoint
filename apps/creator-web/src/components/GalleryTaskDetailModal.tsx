// Mission detail modal (change: gallery-mission-detail).
//
// Opened by pressing a public mission in the Gallery's mission library tab or in
// the Builder's mission picker. It renders EXACTLY the view model it is handed and
// knows nothing about `PublicTask` fields: it walks `detail.rows` and maps each
// `row.key` to a label. That is the point. All the field-level decisions (which
// rows exist, what is suppressed, and above all what is never copied out of the
// source document) live in lib/galleryTaskDetail, where they are unit tested,
// because creator-web has no component test runner.
//
// Nothing is fetched on open: `searchTaskLibrary` already returned the whole
// sanitized document, so the detail is built from data the caller is holding.
import { Suspense, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { Button, TagChips } from './ui';
import { useT } from './LanguageContext';
import {
  buildGalleryTaskDetail, type GalleryDetailRowKey, type GalleryTaskTypeKey,
} from '../lib/galleryTaskDetail';

// MapLibre (~500 KB) is pulled by OPENING a detail, not by importing this file,
// so the Builder's mission picker does not drag the map into its own path.
const GalleryMap = lazyWithRetry('galleryMapDetail', () => import('./GalleryMap'));

export default function GalleryTaskDetailModal({ task, onClose, onUse, useBusy }: {
  /** The sanitized public mission the caller already holds. */
  task: unknown;
  onClose: () => void;
  /**
   * "Use this mission". Present only where a target game exists (the Builder's
   * picker). The Gallery has no game to insert into, so it passes nothing and the
   * modal explains where the mission can be added instead of offering an action
   * that cannot complete.
   */
  onUse?: () => void;
  useBusy?: boolean;
}) {
  const t = useT();
  const gl = t.gallery;
  const b = t.builder;
  const detail = buildGalleryTaskDetail(task);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Escape closes, alongside the backdrop and the ✕ button. A modal that traps a
  // creator behind a mis-click is the thing that makes them stop opening details.
  // On open we also lock body scroll, pull focus into the panel, and restore focus
  // to the opener on close — the house modal pattern (ExclusiveGroupsModal).
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

  const ROW_LABEL: Record<GalleryDetailRowKey, string> = {
    type: gl.rowType, difficulty: gl.rowDifficulty, estimatedMinutes: gl.rowMinutes,
    points: gl.rowPoints, copies: gl.rowCopies, likes: gl.rowLikes,
    source: gl.rowSource, author: gl.rowAuthor, published: gl.rowPublished,
  };
  const TYPE_LABEL: Record<GalleryTaskTypeKey, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation,
    photo: b.typePhoto, quiz: b.typeQuiz, numeric: b.typeNumeric,
    geofence: b.typeGeofence, sequence: b.typeSequence, survey: b.typeSurvey,
    // NOT `gl.rowType` — that is the row's LABEL, so the row read "Mission type:
    // Mission type" for any type this build does not know.
    unknown: gl.rowTypeUnknown,
  };
  const TYPE_ABOUT: Record<GalleryTaskTypeKey, string> = {
    field: gl.typeAboutField, self_report: gl.typeAboutSelfReport, smart_station: gl.typeAboutStation,
    photo: gl.typeAboutPhoto, quiz: gl.typeAboutQuiz, numeric: gl.typeAboutNumeric,
    geofence: gl.typeAboutGeofence, sequence: gl.typeAboutSequence, survey: gl.typeAboutSurvey,
    unknown: gl.typeAboutUnknown,
  };

  // Numbers become copy through the SAME i18n functions the cards already use, so
  // a mission reads identically on its card and in its detail.
  function renderValue(key: GalleryDetailRowKey, value: string | number): string {
    switch (key) {
      case 'type': return TYPE_LABEL[value as GalleryTaskTypeKey] ?? gl.rowTypeUnknown;
      case 'difficulty': return gl.valDiff(value as number);
      case 'estimatedMinutes': return gl.valMinutes(value as number);
      case 'points': return gl.metaPts(value as number);
      case 'copies': return gl.metaCopies(value as number);
      case 'likes': return gl.likes(value as number);
      default: return String(value);
    }
  }

  const titleId = 'mission-detail-title';

  // Rendered through a portal to document.body: `fixed inset-0` must resolve
  // against the viewport, but the Gallery mounts this modal under an
  // `animate-fade-up` ancestor whose PERMANENT `transform: translateY(0)` becomes
  // the containing block for `position: fixed`, cutting the panel off at the
  // bottom. document.body carries no transform/filter/contain, so the portal fixes
  // the anchoring without touching layout.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* NOT the shared <Card>: it carries a hover lift, and a modal that rises
          when the pointer crosses it reads as a bug. The height cap only works if
          EVERY box between the cap and the scroll area is a flex item that may
          shrink — hence `flex-1 min-h-0` on the dialog and on the body. Without
          that the body grows to its content and the panel spills off-screen. */}
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
              <p className="text-[13px] uppercase tracking-wide text-[--ink-3] font-semibold">{gl.detailTitle}</p>
              <h3 id={titleId} className="font-brand font-bold text-lg text-[--ink-1] leading-snug" dir="auto">
                {detail.title}
              </h3>
            </div>
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

            <section>
              <h4 className="text-xs font-semibold text-[--ink-3] mb-1.5">{gl.detailAboutTitle}</h4>
              <p className="text-sm text-[--ink-2] leading-relaxed">{TYPE_ABOUT[detail.typeKey]}</p>
            </section>

            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
              {detail.rows.map((row) => (
                <div key={row.key} className="flex items-baseline justify-between gap-3 border-b border-[--rp-border] py-1.5">
                  <dt className="text-xs text-[--ink-3] shrink-0">{ROW_LABEL[row.key]}</dt>
                  <dd className="text-sm text-[--ink-1] font-medium text-end truncate" dir="auto">
                    {renderValue(row.key, row.value)}
                  </dd>
                </div>
              ))}
            </dl>

            {detail.tags.length > 0 && <TagChips tags={detail.tags} max={12} more={gl.moreTags} />}

            <section>
              {/* An ordinary task now publishes its EXACT authored point, so the
                  heading is a plain "location on the map" and there is NO
                  approximate disclaimer. Only a hidden-location (coarse) pin keeps
                  the "approximate area" heading and note (change:
                  gallery-precise-task-location). */}
              <h4 className="text-xs font-semibold text-[--ink-3] mb-1.5">
                {detail.areaApproximate ? gl.detailAreaTitle : gl.detailAreaTitlePrecise}
              </h4>
              {detail.area ? (
                <Suspense fallback={<div className="h-40 rounded-xl border border-[--rp-border] bg-[--surface-1]" />}>
                  <GalleryMap
                    points={[{ id: detail.id, lat: detail.area.lat, lng: detail.area.lng, title: detail.title }]}
                    onSelect={() => undefined}
                    emptyLabel={gl.noLocatedTasks}
                    notice={detail.areaApproximate ? gl.detailAreaApproxNote : undefined}
                    markerColor="#f59e0b"
                    className="h-40"
                  />
                </Suspense>
              ) : (
                // An empty map slot is read as a broken map. Say why there is none.
                <p className="text-xs text-[--ink-3] leading-relaxed">{gl.detailNoArea}</p>
              )}
            </section>

            {/* A creator evaluating a quiz mission will otherwise read the missing
                answer list as a bug in this view rather than as the contract. */}
            <p className="text-[13px] text-[--ink-3] leading-relaxed">{gl.detailSecretNote}</p>
          </div>

          <div className="mt-3 pt-3 border-t border-[--rp-border] flex items-center gap-3 shrink-0">
            {onUse ? (
              <Button loading={useBusy} onClick={onUse} className="!py-2 !text-xs !font-semibold">{gl.detailUse}</Button>
            ) : (
              <p className="text-[13px] text-[--ink-3] leading-relaxed">{gl.detailUseHint}</p>
            )}
            <Button variant="ghost" onClick={onClose} className="ms-auto !py-2 !text-xs">{gl.detailClose}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
