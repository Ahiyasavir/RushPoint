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
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { COLLECTIONS, resolvePlayOrigin, CANONICAL_PLAY_URL } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { Badge, Button, TagChips } from './ui';
import { useT } from './LanguageContext';
import { buildGalleryGameDetail, buildGalleryGameMissions, type GalleryGameMission } from '../lib/galleryGameDetail';

/** Never render an unbounded public list inside a modal. */
const MISSION_LIST_CAP = 60;

// Same resolution AuthGate already uses for its demo link: in dev the participant
// app is a sibling port, in production it is the canonical play host. Duplicated
// deliberately rather than exported from AuthGate — a modal importing the auth
// module for a URL constant is a worse coupling than two lines of the same rule.
const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? CANONICAL_PLAY_URL);

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

  // ── The mission list (change: gallery-missions-quick-play) ──────────────────
  // The modal showed COUNTS and nothing else — "12 missions" with no way to see
  // what any of them were, which is what creators meant by "the preview didn't
  // work, I saw nothing". Every task is ALREADY published individually to
  // publicTasks/{gameId}_{taskId} carrying `sourceGameId`, and publicTasks is
  // world-readable, so this is a single-field equality query needing no composite
  // index, no new callable and no widening of what is public.
  //
  // Fetched on OPEN rather than with the game: `searchGallery` returns counts only,
  // and pre-fetching missions for every card in the grid would be N queries for
  // data almost none of them will show.
  const [missions, setMissions] = useState<GalleryGameMission[] | null>(null);
  const [missionsFailed, setMissionsFailed] = useState(false);
  useEffect(() => {
    if (!detail.id) { setMissions([]); return; }
    let live = true;
    void (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, COLLECTIONS.PUBLIC_TASKS),
          where('sourceGameId', '==', detail.id),
          limit(MISSION_LIST_CAP),
        ));
        if (!live) return;
        setMissions(buildGalleryGameMissions(snap.docs.map((d) => d.data())));
      } catch {
        // A failed read must degrade to "we couldn't list these", never to a blank
        // Gallery behind the ErrorBoundary. The rest of the detail still renders.
        if (live) { setMissions([]); setMissionsFailed(true); }
      }
    })();
    return () => { live = false; };
  }, [detail.id]);

  // Quick play (change: gallery-missions-quick-play): reuses the EXISTING
  // startInstantPlay path end to end — play-web's `?game=<id>` promo route already
  // calls it. Shown only when the game actually opted in, so the button can never
  // advertise a run the server would refuse.
  const playHref = `${PLAY_URL}/?game=${encodeURIComponent(detail.id)}`;

  const MODE_LABEL: Record<string, string> = { individual: b.modeIndividual, team: b.modeTeam };
  const MISSION_TYPE_LABEL: Record<string, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation,
    photo: b.typePhoto, quiz: b.typeQuiz, numeric: b.typeNumeric,
    geofence: b.typeGeofence, sequence: b.typeSequence, survey: b.typeSurvey,
    unknown: gl.rowTypeUnknown,
  };
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

            {/* The missions themselves — the whole point of opening a game. */}
            <section>
              <h4 className="text-[11px] uppercase tracking-wide text-[--ink-3] font-semibold mb-1.5">
                {gl.detailMissions}
              </h4>
              {missions === null ? (
                <p className="text-xs text-[--ink-3]">{gl.detailMissionsLoading}</p>
              ) : missions.length === 0 ? (
                <p className="text-xs text-[--ink-3]">
                  {missionsFailed ? gl.detailMissionsFailed : gl.detailMissionsEmpty}
                </p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {missions.map((m, i) => (
                    <li key={m.id || i}
                      className="flex items-baseline gap-2 rounded-lg bg-[--surface-2] px-2.5 py-1.5">
                      <span className="text-[11px] text-[--ink-3] tabular-nums shrink-0">{i + 1}</span>
                      <span className="text-sm text-[--ink-1] min-w-0 flex-1 truncate" dir="auto">
                        {m.title || gl.detailMissionUntitled}
                      </span>
                      <span className="text-[11px] text-[--ink-3] shrink-0">
                        {MISSION_TYPE_LABEL[m.type] ?? gl.rowTypeUnknown}
                      </span>
                      {m.estimatedMinutes !== null && (
                        <span className="text-[11px] text-[--ink-3] shrink-0">{gl.valMinutes(m.estimatedMinutes)}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="mt-3 pt-3 border-t border-[--rp-border] flex flex-wrap items-center gap-3 shrink-0">
            <Button loading={copyBusy} onClick={onCopy} className="!py-2 !text-xs !font-semibold">{gl.copyBtn}</Button>
            {/* A real anchor, not a scripted window.open: it survives a popup
                blocker and offers the normal open-in-new-tab affordances. */}
            {detail.allowInstantPlay && detail.id && (
              <a
                href={playHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-[--rp-border] px-3 py-2 text-xs font-semibold text-[--ink-1]
                  hover:bg-[--surface-2] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
              >{gl.detailPlay}</a>
            )}
            <Button variant="ghost" onClick={onClose} className="ms-auto !py-2 !text-xs">{gl.detailClose}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
