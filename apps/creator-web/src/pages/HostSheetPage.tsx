// The printable host sheet (change: host-sheet).
//
// One paper the host holds on the day. Everything it says comes from the pure
// model in lib/hostSheet.ts (scripts/test-host-sheet.ts); this file only words it
// through t.hostSheet and lays it out for A4.
//
// Printed with the browser (print, or save as PDF), like the station QR cards, so
// Hebrew shapes correctly and nothing new is installed. The print CSS below hides
// the app header and the toolbar, forces a white page whatever the app theme, and
// keeps every mission card whole. Every state is said with a word, never colour
// alone, so a black and white printer loses nothing.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { CANONICAL_PLAY_URL, FIRESTORE_PATHS, resolvePlayOrigin, type Game } from '@rushpoint/shared';
import { getGame } from '../services/calls';
import { db } from '../services/firebase';
import { useAuth } from '../components/AuthGate';
import { useLanguage, useT } from '../components/LanguageContext';
import { Button, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { buildHostSheet, DEFAULT_HOST_SHEET_OPTIONS, pageFooterCss, stepAnswerSummary, type HostAnswer, type HostSheetOptions, type HostTaskCard } from '../lib/hostSheet';
import { buildStaffCodeRows, type StaffCodeDocLike, type StaffGrantDocLike } from '../lib/staffCodes';

const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? CANONICAL_PLAY_URL);

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  header, .hs-toolbar, .rp-mesh-layer { display: none !important; }
  html, body { background: #fff !important; }
  main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .hs-sheet { box-shadow: none !important; border: 0 !important; padding: 0 !important; }
  .hs-break { break-before: page; }
  .hs-keep { break-inside: avoid; }
  .hs-footer { display: block !important; }
}
`;

type T = ReturnType<typeof useT>['hostSheet'];

function useQr(urls: string[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = urls.join('|');
  useEffect(() => {
    let alive = true;
    void Promise.all(urls.map(async (u) => {
      try { return [u, await QRCode.toDataURL(u, { margin: 1, width: 160 })] as const; } catch { return [u, ''] as const; }
    })).then((pairs) => { if (alive) setMap(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

function AnswerBox({ answer, h }: { answer: HostAnswer; h: T }) {
  const body = (() => {
    switch (answer.kind) {
      case 'choices':
        return (
          <ul className="space-y-0.5">
            {answer.choices.map((c, i) => (
              <li key={i} dir="auto" className={c.correct ? 'font-bold' : ''}>
                {c.correct && <Icon name="check" className="inline w-4 h-4 me-1" aria-hidden />}
                {c.text}{c.correct ? ` (${h.correct})` : ''}
              </li>
            ))}
          </ul>
        );
      case 'texts': return <p dir="auto">{h.accepted} {answer.accepted.join(' / ')}</p>;
      case 'number': return <p dir="ltr" className="font-bold text-start">{answer.tolerance ? `${answer.value} (±${answer.tolerance})` : String(answer.value)}</p>;
      case 'steps':
        return (
          <ol className="space-y-0.5">
            {answer.steps.map((s, i) => (
              <li key={i} dir="auto">{h.step(i + 1)}: {s.prompt} <b>{s.answer}</b></li>
            ))}
          </ol>
        );
      case 'order': return <ol className="list-decimal ps-5">{answer.items.map((x, i) => <li key={i} dir="auto">{x}</li>)}</ol>;
      case 'code': return <p>{h.secretCode}: <b className="font-mono text-base">{answer.code}</b></p>;
      case 'outcomes':
        return (
          <ul className="space-y-0.5">
            {answer.outcomes.map((o, i) => (
              <li key={i} dir="auto">
                <b>{o.label || o.accepts.join(' / ') || (o.range ? h.range(o.range.min, o.range.max) : '')}</b>
                {o.label && o.accepts.length > 0 ? ` (${o.accepts.join(' / ')})` : ''}
                {o.range && o.label ? ` (${h.range(o.range.min, o.range.max)})` : ''}
                {' · '}{h.outcomePoints(o.points)}
              </li>
            ))}
            {answer.unmatchedPoints !== null && <li>{h.unmatched(answer.unmatchedPoints)}</li>}
          </ul>
        );
      case 'noRightAnswer': return <p>{h.noRightAnswer}</p>;
      case 'missing': return <p className="font-bold">{h.missing}</p>;
    }
  })();
  return (
    <div className="mt-2 rounded-lg border-2 border-[#1c1917] bg-[#fff7ed] px-3 py-2 text-[13px]">
      <p className="text-[11px] font-bold uppercase tracking-wide">{h.answerTitle}</p>
      {body}
    </div>
  );
}

function shortAnswer(a: HostAnswer, h: T): string {
  switch (a.kind) {
    case 'choices': return a.choices.filter((c) => c.correct).map((c) => c.text).join(' / ') || h.missing;
    case 'texts': return a.accepted.join(' / ');
    case 'number': return a.tolerance ? `${a.value} (±${a.tolerance})` : String(a.value);
    case 'steps': return stepAnswerSummary(a) || h.completion.steps;
    case 'order': return a.items.join(' · ');
    case 'code': return a.code;
    case 'outcomes': return a.outcomes.map((o) => `${o.label || o.accepts.join('/')} ${o.points}`).join(' · ');
    case 'noRightAnswer': return h.noRightAnswer;
    case 'missing': return h.missing;
  }
}

export default function HostSheetPage() {
  const t = useT();
  const h = t.hostSheet;
  const { lang } = useLanguage();
  const { user } = useAuth();
  const { gameId } = useParams<{ gameId: string }>();
  const [params] = useSearchParams();
  const runId = params.get('run') ?? '';
  const ownerUid = user?.uid ?? '';

  const [game, setGame] = useState<Game | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState<{ id: string; accessCode?: string; autoApproveAllMedia?: boolean } | null>(null);
  const [codes, setCodes] = useState<StaffCodeDocLike[]>([]);
  const [grants, setGrants] = useState<StaffGrantDocLike[]>([]);
  const [options, setOptions] = useState<HostSheetOptions>(DEFAULT_HOST_SHEET_OPTIONS);

  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    getGame({ gameId }).then((r) => { if (alive) setGame(r.game); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [gameId]);

  // The run version: the join code, the run's approval switch and its staff codes,
  // read the way the Run Console reads them (the owner may read their own run).
  useEffect(() => {
    if (!runId || !gameId || !ownerUid) return undefined;
    const runPath = FIRESTORE_PATHS.run(ownerUid, gameId, runId);
    const un0 = onSnapshot(doc(db, runPath), (snap) => {
      if (snap.exists()) setRun({ ...(snap.data() as { accessCode?: string; autoApproveAllMedia?: boolean }), id: runId });
    }, () => undefined);
    const un1 = onSnapshot(collection(db, `${runPath}/staffInvites`),
      (snap) => setCodes(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), () => undefined);
    const un2 = onSnapshot(collection(db, FIRESTORE_PATHS.staffGrantsCol(ownerUid, gameId, runId)),
      (snap) => setGrants(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), () => undefined);
    return () => { un0(); un1(); un2(); };
  }, [runId, gameId, ownerUid]);

  const sheet = useMemo(() => (game ? buildHostSheet(game, {
    run,
    staffCodes: buildStaffCodeRows(codes, grants),
    options,
    ownerUid,
    playUrl: PLAY_URL,
    lang,
  }) : null), [game, run, codes, grants, options, ownerUid, lang]);

  const cards = useMemo(() => (sheet ? sheet.stages.flatMap((s) => s.cards) : []), [sheet]);
  const qrUrls = useMemo(() => {
    if (!sheet) return [];
    const urls = cards.flatMap((c) => (c.location.kind === 'point' ? [c.location.navUrl] : []));
    if (sheet.cover.joinLink) urls.push(sheet.cover.joinLink);
    if (sheet.staffPage) urls.push(sheet.staffPage.codes[0].staffLink);
    return [...new Set(urls)];
  }, [sheet, cards]);
  const qr = useQr(qrUrls);

  if (failed) return <p className="text-center text-[--ink-2] py-10">{h.loadFailed}</p>;
  if (!sheet || !game) return <Spinner label={h.loading} />;

  const printed = new Date().toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB');
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  };
  const scoring = (t.builder.presetLabels as Record<string, { name: string; desc: string }>)[sheet.cover.scoringPreset];
  const backTo = runId ? `/run/${gameId}/${runId}` : `/build/${gameId}`;
  const footer = (
    <p className="hs-footer hidden mt-6 text-[10px] text-[#57534e] text-center" dir="auto">{h.printedOn(sheet.cover.title, printed)}</p>
  );

  const toggle = (key: keyof HostSheetOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  const completionWords = (completion: HostTaskCard['completion'], mediaKind: HostTaskCard['mediaKind']) =>
    (completion === 'media' ? h.completion[mediaKind ?? 'photo'] : h.completion[completion]);

  const card = (c: HostTaskCard) => {
    const how = completionWords(c.completion, c.mediaKind);
    const approval = c.approval.mode === 'manual' ? h.approvalManual
      : c.approval.mode === 'auto' ? h.approvalAuto
      : c.approval.mode === 'automaticCheck' ? h.approvalCheck : h.approvalNone;
    const source = c.approval.source === 'run' ? h.approvalSourceRun : c.approval.source === 'game' ? h.approvalSourceGame : '';
    const L = c.limits;
    const limits = [
      L.timeLimitMinutes ? h.limitTime(L.timeLimitMinutes) : '',
      L.maxConcurrentTeams ? h.limitQueue(L.maxConcurrentTeams) : '',
      L.unlockAfter.length ? h.limitUnlock(L.unlockAfter.join(', ')) : '',
      L.releaseAfterMinutes ? h.limitReleaseAfter(L.releaseAfterMinutes) : '',
      L.releaseAt ? h.limitReleaseAt(when(L.releaseAt)) : '',
      L.expiresAfterMinutes ? h.limitExpiresAfter(L.expiresAfterMinutes) : '',
      L.expiresAt ? h.limitExpiresAt(when(L.expiresAt)) : '',
      L.pausesTimer ? h.limitPauses : '',
      L.requiredContributors ? h.limitContributors(L.requiredContributors) : '',
      L.requirePresence ? h.limitPresence : '',
    ].filter(Boolean);
    return (
      <article key={c.id} className={`hs-keep rounded-xl border border-[#d6d3d1] p-3 mb-3 ${options.cardPerPage ? 'hs-break' : ''}`}>
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1c1917] text-white font-bold text-sm">{c.number}</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-[15px] leading-snug break-words" dir="auto">{c.title}</h3>
            <p className="text-[12px] text-[#44403c]">{how} · {h.outcomePoints(c.points)}{c.estimatedMinutes ? ` · ${h.minutes(c.estimatedMinutes)}` : ''}</p>
          </div>
          {c.location.kind === 'point' && qr[c.location.navUrl] && (
            <figure className="shrink-0 text-center">
              <img src={qr[c.location.navUrl]} alt="" className="h-16 w-16" />
              <figcaption className="text-[9px] text-[#57534e]">{h.navScan}</figcaption>
            </figure>
          )}
        </div>
        {c.description && <p className="mt-2 text-[13px] whitespace-pre-line break-words" dir="auto">{c.description}</p>}
        {c.instructions && (
          <p className="mt-1 text-[12px] whitespace-pre-line break-words" dir="auto"><b>{h.instructions}:</b> {c.instructions}</p>
        )}
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
          <div><dt className="inline font-semibold">{h.colWhere}: </dt><dd className="inline">
            {c.location.kind === 'anywhere' ? h.anywhere : c.location.kind === 'unplaced' ? h.unplaced
              : <span dir="ltr">{c.location.lat.toFixed(5)}, {c.location.lng.toFixed(5)}{c.location.radiusMeters ? ` (${h.radius(c.location.radiusMeters)})` : ''}</span>}
          </dd></div>
          <div><dt className="inline font-semibold">{h.colApproval}: </dt><dd className="inline">{approval}{source ? ` (${source})` : ''}</dd></div>
          {c.hiddenFromPlayers && (
            <div className="sm:col-span-2"><dt className="inline font-semibold">{h.hiddenSpot}. </dt>
              {c.clue && <dd className="inline" dir="auto">{h.clue}: {c.clue}</dd>}</div>
          )}
          {c.hint && (
            <div className="sm:col-span-2"><dt className="inline font-semibold">{h.hint(c.hint.penalty)}</dt>
              <dd className="inline" dir="auto">
                {[c.hint.autoRevealMinutes ? h.hintAutoMinutes(c.hint.autoRevealMinutes) : '', c.hint.autoRevealAttempts ? h.hintAutoAttempts(c.hint.autoRevealAttempts) : '']
                  .filter(Boolean).map((x) => `, ${x}`).join('')}
                {c.hint.text ? `: ${c.hint.text}` : ''}
              </dd></div>
          )}
        </dl>
        {c.approval.videoLengthCaveat && <p className="mt-1 text-[12px]">{h.videoCaveat}</p>}
        {limits.length > 0 && <ul className="mt-1 text-[12px] list-disc ps-5">{limits.map((x) => <li key={x}>{x}</li>)}</ul>}
        {c.mediaCount > 0 && <p className="mt-1 text-[12px]">{h.media(c.mediaCount)}</p>}
        {c.operatorNotes && <p className="mt-1 text-[12px] whitespace-pre-line" dir="auto"><b>{h.notes}:</b> {c.operatorNotes}</p>}
        {c.answer && <AnswerBox answer={c.answer} h={h} />}
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <style>{PRINT_CSS}</style>
      {/* Every printed page says what it is and when it was printed (lib/hostSheet.ts). */}
      <style>{pageFooterCss(h.printedOn(sheet.cover.title, printed))}</style>

      {/* Toolbar: never printed. */}
      <div className="hs-toolbar sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[--rp-border] bg-[--surface-1] p-3">
        <Link to={backTo} className="inline-flex min-h-[44px] items-center px-2 text-sm text-[--ink-2] hover:text-[--ink-1]">{h.back}</Link>
        <h1 className="font-brand font-semibold text-[--ink-1] me-auto">{h.title}</h1>
        {([['includeAnswers', h.optAnswers], ['includeMap', h.optMap], ['cardPerPage', h.optCardPerPage]] as const).map(([key, label]) => (
          <label key={key} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[--ink-2]">
            <input type="checkbox" checked={options[key]} onChange={() => toggle(key)} className="h-4 w-4" />
            {label}
          </label>
        ))}
        <Button onClick={() => window.print()} className="min-h-[44px]">
          <span className="inline-flex items-center gap-2"><Icon name="printer" className="w-4 h-4" aria-hidden />{h.print}</span>
        </Button>
      </div>

      <div className="hs-sheet rounded-2xl border border-[--rp-border] bg-white p-5 text-[#1c1917] shadow-sm sm:p-8">
        {/* ── Cover ── */}
        <section className="hs-keep">
          <p className={`mb-4 rounded-lg border-2 px-3 py-2 text-sm font-bold ${options.includeAnswers ? 'border-[#b91c1c] text-[#b91c1c]' : 'border-[#1c1917]'}`}>
            <Icon name={options.includeAnswers ? 'lock' : 'eye'} className="inline w-4 h-4 me-2" aria-hidden />
            {options.includeAnswers ? h.hostOnly : h.noAnswers}
          </p>
          <h2 className="font-brand text-2xl font-bold break-words" dir="auto">{sheet.cover.title}</h2>
          {sheet.cover.description && <p className="mt-1 text-sm whitespace-pre-line" dir="auto">{sheet.cover.description}</p>}
          <p className="mt-3 text-sm text-[#44403c]">
            {[h.stages(sheet.cover.stageCount), h.tasks(sheet.cover.taskCount),
              sheet.cover.totalMinutes ? h.minutes(sheet.cover.totalMinutes) : '',
              sheet.cover.mode === 'team' ? h.modeTeam : sheet.cover.mode === 'individual' ? h.modeIndividual : '',
              sheet.cover.minAge ? h.minAge(sheet.cover.minAge) : ''].filter(Boolean).join(' · ')}
          </p>
          {scoring && (
            <div className="mt-4">
              <h3 className="font-bold">{h.howToWin}</h3>
              <p className="text-sm">{scoring.desc}</p>
              {sheet.cover.hintsCost && <p className="text-sm">{h.hintsCost}</p>}
              {sheet.cover.wrongAnswerPenalty && sheet.cover.wrongAnswerPenalty !== 'off' && <p className="text-sm">{h.wrongCosts}</p>}
            </div>
          )}
          <div className="mt-4 flex items-center gap-4 rounded-xl border border-[#d6d3d1] p-3">
            {sheet.cover.joinLink && qr[sheet.cover.joinLink] && <img src={qr[sheet.cover.joinLink]} alt="" className="h-24 w-24" />}
            <div>
              <h3 className="font-bold">{h.joinTitle}</h3>
              {sheet.cover.joinCode
                ? <p className="font-mono text-2xl font-bold tracking-widest" dir="ltr">{sheet.cover.joinCode}</p>
                : <p className="text-sm">{h.joinPending}</p>}
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {[h.fillDate, h.fillMeet, h.fillEmergency, h.fillStaff].map((label) => (
              <p key={label} className="border-b border-[#a8a29e] pb-4">{label}</p>
            ))}
          </div>
        </section>

        {/* ── Map ── */}
        {options.includeMap && (
          <section className="hs-break hs-keep mt-8">
            <h2 className="font-brand text-xl font-bold mb-2">{h.mapTitle}</h2>
            {sheet.plot.length === 0 ? <p className="text-sm">{h.mapEmpty}</p> : (
              <>
                <svg viewBox="-0.08 -0.08 1.16 1.16" className="w-full max-w-[520px] mx-auto aspect-square rounded-xl border border-[#d6d3d1]" role="img" aria-label={h.mapTitle}>
                  {sheet.plot.map((p) => (
                    <g key={p.number}>
                      <circle cx={p.x} cy={p.y} r={0.032} fill={p.stage % 2 ? '#1c1917' : '#fff'} stroke="#1c1917" strokeWidth={0.006} />
                      <text x={p.x} y={p.y + 0.012} textAnchor="middle" fontSize={0.034} fontWeight={700} fill={p.stage % 2 ? '#fff' : '#1c1917'}>{p.number}</text>
                    </g>
                  ))}
                </svg>
                <ol className="mt-3 grid gap-x-4 text-[12px] sm:grid-cols-2">
                  {sheet.stages.flatMap((s) => s.cards.filter((c) => c.location.kind === 'point').map((c) => (
                    <li key={c.id} dir="auto"><b>{c.number}</b> · {c.title} · {h.stageHeading(s.number, '')}</li>
                  )))}
                </ol>
              </>
            )}
          </section>
        )}

        {/* ── Route ── */}
        <section className="hs-break mt-8">
          <h2 className="font-brand text-xl font-bold mb-3">{h.routeTitle}</h2>
          {sheet.stages.map((s) => (
            <div key={s.id} className="mb-6">
              <div className="hs-keep mb-2 border-b-2 border-[#1c1917] pb-1">
                <h3 className="text-lg font-bold" dir="auto">{h.stageHeading(s.number, s.title)}</h3>
                <ul className="text-[13px]">
                  <li>{s.rule.kind === 'all' ? h.ruleAll : h.ruleSome(s.rule.required, s.rule.total)}</li>
                  {s.exclusive.map((g, i) => <li key={i} dir="auto">{h.ruleOnlyOne(g.join(' / '))}</li>)}
                  {s.releaseAfterMinutes ? <li>{h.ruleReleaseAfter(s.releaseAfterMinutes)}</li> : null}
                  {s.releaseAt ? <li>{h.ruleReleaseAt(when(s.releaseAt))}</li> : null}
                  {s.isFinal && <li className="font-bold">{h.ruleFinal}</li>}
                </ul>
              </div>
              {s.cards.length === 0 ? <p className="text-sm">{h.noTasks}</p> : s.cards.map(card)}
            </div>
          ))}
        </section>

        {/* ── Answer key ── */}
        {sheet.answerRows.length > 0 && (
          <section className="hs-break mt-8">
            <h2 className="font-brand text-xl font-bold mb-2">{h.answersTitle}</h2>
            <table className="w-full text-[13px] border-collapse">
              <thead><tr className="border-b-2 border-[#1c1917] text-start">
                <th className="py-1 text-start w-8">#</th>{/* i18n-ignore: a column of numbers */}
                <th className="py-1 text-start">{h.colTask}</th>
                <th className="py-1 text-start">{h.colAnswer}</th>
              </tr></thead>
              <tbody>
                {sheet.answerRows.map((r) => (
                  <tr key={r.number} className="border-b border-[#d6d3d1] hs-keep">
                    <td className="py-1 font-bold">{r.number}</td>
                    <td className="py-1" dir="auto">{r.title}</td>
                    <td className="py-1 font-semibold" dir="auto">
                      {r.answer ? shortAnswer(r.answer, h) : <span className="font-normal">{completionWords(r.completion, null)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── On the day ── */}
        <section className="hs-break hs-keep mt-8">
          <h2 className="font-brand text-xl font-bold mb-2">{h.dayTitle}</h2>
          <div className="grid gap-3 text-sm">
            {[h.dayMeet, h.dayBrief, h.dayStart, h.dayEnd].map((label) => (
              <p key={label} className="border-b border-[#a8a29e] pb-4">{label}</p>
            ))}
          </div>
          <h3 className="mt-5 font-bold">{h.stuckTitle}</h3>
          <p className="text-sm">{h.stuckBody}</p>
          <h3 className="mt-5 font-bold">{h.notesTitle}</h3>
          <div className="mt-1 h-40 rounded-xl border border-[#a8a29e]" />
          {footer}
        </section>

        {/* ── Staff codes: the tear-off last page ── */}
        {sheet.staffPage && (
          <section className="hs-break mt-8">
            <h2 className="font-brand text-xl font-bold mb-3">{h.staffTitle}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {sheet.staffPage.codes.map((s, i) => (
                <div key={i} className="hs-keep flex items-center gap-3 rounded-xl border-2 border-dashed border-[#1c1917] p-3">
                  {qr[s.staffLink] && <img src={qr[s.staffLink]} alt="" className="h-20 w-20" />}
                  <div className="min-w-0">
                    <p className="font-bold break-words" dir="auto">{s.label}</p>
                    <p className="text-[12px]">{s.capabilities.map((c) => (t.runConsole.staffCaps as Record<string, { name: string }>)[c]?.name).filter(Boolean).join(', ')}</p>
                    <p className="text-[12px]">{h.staffCode}: <b className="font-mono text-base" dir="ltr">{s.pin}</b></p>
                    <p className="text-[10px] text-[#57534e]">{h.staffScan}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
