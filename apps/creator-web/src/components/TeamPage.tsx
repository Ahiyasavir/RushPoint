import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './LanguageContext';
import { Badge, Button } from './ui';
import type { TeamDossier } from '../lib/teamDossier';
import { toTelHref, toWhatsAppHref } from '@rushpoint/shared';
import ClipTile from './ClipTile';

// The team page (change: team-dossier-and-search, D3/D5).
//
// Field report 2026-09-25: "I can't click a team and see everything about it: its information,
// add points, the photos and videos it sent, send it a message." Everything here is rendered from
// the pure view-model `buildTeamDossier`; this component decides nothing about data. Every action
// is a callback into the console, which runs the SAME handler its own panels use, so there is one
// code path per action.
//
// A side drawer on desktop, a full-screen sheet on a phone. Esc and the close button close it; the
// open team lives in the URL (`?team=`), so the browser's back button closes it too.

export default function TeamPage({
  dossier, onClose, onAdjust, onSkip, onSendBack, onReview, reviewBusy,
}: {
  dossier: TeamDossier;
  onClose: () => void;
  onAdjust: () => void;
  onSkip?: () => void;
  onSendBack?: () => void;
  onReview: (taskId: string, approved: boolean) => void;
  reviewBusy: (taskId: string) => boolean;
}) {
  const t = useT();
  const tp = t.runConsole.teamPage;
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = dossier;
  const statusLabel = d.status === 'finished' ? t.runConsole.teamStatusFinished
    : d.status === 'waiting' ? t.runConsole.teamStatusWaiting : tp.statusPlaying;

  // Portalled to <body>: the console renders inside an animated (transformed)
  // ancestor, which traps a `fixed` child in its stacking context, and the site
  // header was drawn over the drawer's own header. z-[90] keeps it under the
  // confirm dialogs (z-[110]) that its actions open.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex" role="dialog" aria-modal="true" aria-label={tp.dialogLabel({ team: d.name })}>
      {/* Desktop: the console stays visible beside the drawer; a click outside closes it. */}
      <button type="button" aria-label={tp.close} onClick={onClose} className="hidden lg:block flex-1 bg-black/30 cursor-default" tabIndex={-1} />
      <div className="w-full lg:w-[480px] h-full overflow-y-auto bg-[--surface-0] lg:border-s border-[--rp-border] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-[--surface-0] border-b border-[--rp-border]">
          <button ref={closeRef} type="button" onClick={onClose} aria-label={tp.close}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[--surface-2] text-xl text-[--ink-2]">✕</button>
          <div className="min-w-0 flex-1">
            <h2 dir="auto" className="text-lg font-bold text-[--ink-1] truncate">{d.name}</h2>
            <p className="text-[13px] text-[--ink-3]">
              {statusLabel}{' · '}{tp.score({ score: d.score })}{d.rank !== null ? ` · ${tp.rank({ rank: d.rank })}` : ''}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {d.current && (
            <section className="rounded-xl border border-[--rp-border] bg-[--surface-2] p-3">
              <div className="text-[12px] font-semibold text-[--ink-3]">{tp.currentMission}</div>
              <div dir="auto" className="text-sm font-semibold text-[--ink-1] mt-0.5">{d.current.title}</div>
              {d.current.minutes !== null && <div className="text-[13px] text-[--ink-3]">{tp.onItFor({ minutes: d.current.minutes })}</div>}
            </section>
          )}

          <section className="flex flex-wrap gap-2" aria-label={tp.actions}>
            <Button onClick={onAdjust}>{t.runConsole.adjustScore}</Button>
            {onSkip && <Button variant="ghost" onClick={onSkip}>{t.runConsole.skipTask}</Button>}
            {onSendBack && <Button variant="ghost" onClick={onSendBack}>{t.runConsole.sendBack}</Button>}
          </section>

          {/* quick-dial-and-actions D3: call or WhatsApp the team, from the numbers the
              game's registration asked for. Never a number typed into another field. */}
          <section aria-label={tp.callTeam}>
            {d.callTargets.length > 0 ? (
              <div className="space-y-1.5">
                {d.callTargets.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span dir="auto" className="text-sm text-[--ink-2] flex-1 min-w-0 truncate">{c.label}: <span dir="ltr">{c.phone}</span></span>
                    <a href={toTelHref(c.phone)!} className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-[--rp-border] text-sm font-semibold text-ink-fire">📞 {tp.call}</a>
                    <a href={toWhatsAppHref(c.phone)!} target="_blank" rel="noreferrer" className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-[--rp-border] text-sm font-semibold text-ink-fire">💬 {tp.whatsapp}</a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[--ink-3]">{d.gameAsksForPhone ? tp.noPhoneGiven : tp.noPhoneField}</p>
            )}
          </section>

          {(d.members.length > 0 || d.phones.length > 0) && (
            <section>
              <h3 className="text-sm font-semibold text-[--ink-1] mb-2">{tp.people}</h3>
              {d.members.length > 0 && <p dir="auto" className="text-sm text-[--ink-2]">{d.members.join(', ')}</p>}
              {d.phones.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {d.phones.map((p) => (
                    <li key={p.uid} className="flex items-center gap-2 text-sm text-[--ink-2]">
                      <span aria-hidden="true">📱</span>
                      <span dir="auto">{p.name || tp.phoneFallback}</span>
                      {p.sending && <Badge color="green">{tp.sending}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-[--ink-1] mb-2">{tp.media({ n: d.media.length })}</h3>
            {d.media.length === 0 ? (
              <p className="text-sm text-[--ink-3]">{tp.noMedia}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {d.media.map((m) => (
                  <div key={m.taskId} className="rounded-lg bg-[--surface-2] p-2">
                    {m.kind === 'video'
                      ? <ClipTile src={m.url} posterUrl={m.posterUrl} durationSec={m.durationSec} className="w-full rounded bg-black" />
                      : m.kind === 'audio'
                        ? <audio src={m.url} controls className="w-full" />
                        : <img src={m.url} alt={tp.mediaAlt({ task: m.title })} loading="lazy" className="w-full aspect-square object-cover rounded" />}
                    <div dir="auto" className="text-[13px] text-[--ink-2] truncate mt-1">{m.title}</div>
                    {m.senderName && <div dir="auto" className="text-[12px] text-[--ink-3] truncate">{t.runConsole.mediaSentBy({ name: m.senderName })}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge color={m.status === 'approved' ? 'green' : m.status === 'rejected' ? 'red' : 'gold'}>{tp.mediaStatus[m.status]}</Badge>
                    </div>
                    <div className="mt-1.5 flex gap-1">
                      {m.status !== 'approved' && (
                        <Button variant="ghost" disabled={reviewBusy(m.taskId)} onClick={() => onReview(m.taskId, true)}>{tp.approve}</Button>
                      )}
                      {m.status !== 'rejected' && (
                        <Button variant="ghost" disabled={reviewBusy(m.taskId)} onClick={() => onReview(m.taskId, false)}>
                          {m.status === 'approved' ? tp.undoApproval : tp.reject}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-[--ink-1] mb-2">{tp.ledger}</h3>
            {d.ledger.length === 0 ? (
              <p className="text-sm text-[--ink-3]">{tp.noLedger}</p>
            ) : (
              <ul className="space-y-1.5">
                {d.ledger.map((l, i) => (
                  <li key={`${l.at}-${i}`} className="flex items-start gap-2 text-sm">
                    <span className={`font-mono font-semibold shrink-0 ${l.delta > 0 ? 'text-ink-go' : 'text-ink-alert'}`} dir="ltr">
                      {l.delta > 0 ? `+${l.delta}` : l.delta}
                    </span>
                    <span className="min-w-0 text-[--ink-2]">
                      <span>{tp.ledgerKind[l.kind as keyof typeof tp.ledgerKind] ?? l.kind}</span>
                      {l.taskTitle && <span dir="auto"> · {l.taskTitle}</span>}
                      {l.reason && <span dir="auto" className="block text-[13px] text-[--ink-3]">{l.reason}</span>}
                      {l.by && <span dir="auto" className="block text-[12px] text-[--ink-4]">{tp.by({ name: l.by === 'organizer' ? tp.organizer : l.by })}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-[--ink-1] mb-2">{tp.timeline}</h3>
            {d.timeline.length === 0 ? (
              <p className="text-sm text-[--ink-3]">{tp.noTimeline}</p>
            ) : (
              <ol className="space-y-3">
                {d.timeline.map((s, si) => (
                  <li key={si}>
                    <div dir="auto" className="text-[13px] font-semibold text-[--ink-2]">{s.title}</div>
                    <ul className="mt-1 space-y-1.5">
                      {s.tasks.map((task) => (
                        <li key={task.taskId} className="rounded-lg bg-[--surface-2] px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span dir="auto" className="text-sm text-[--ink-1] truncate">{task.title}</span>
                            <span className="shrink-0 text-[12px] text-[--ink-3]">
                              {tp.taskStatus[task.status as keyof typeof tp.taskStatus] ?? task.status}
                              {task.outcome ? ` · ${tp.outcome({ label: task.outcome.id === 'unmatched' ? tp.outcomeOther : (task.outcome.label || task.outcome.id) })}` : ''}
                              {task.earnedScore !== undefined ? ` · ${tp.points({ n: task.earnedScore })}` : ''}
                              {task.minutes !== undefined ? ` · ${tp.minutes({ n: task.minutes })}` : ''}
                            </span>
                          </div>
                          {task.answers.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {task.answers.map((a, ai) => (
                                <li key={ai} className="text-[13px] text-[--ink-3]">
                                  <span aria-hidden="true">{a.correct === true ? '✓' : a.correct === false ? '✗' : '·'}</span>{' '}
                                  <span className="sr-only">{a.correct === true ? tp.answerRight : a.correct === false ? tp.answerWrong : ''}</span>
                                  <span dir="auto">{a.answer}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
