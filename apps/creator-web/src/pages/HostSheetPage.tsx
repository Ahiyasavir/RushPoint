// The prints (change: host-sheet; redesigned for issues 40 to 44, 2026-10-06).
//
// ONE page for everything an organizer prints before the day, chosen with a switch at the top:
// the host sheet, the station QR cards and a join sign for the start point. It used to be a host
// sheet behind a ⋯ menu and a station-QR button in the last card of the run console (issue 44,
// "אני רוצה שהאפשרות להוציא דף מארח תהיה יותר בולטת ולא מוחבאת כל כך, כנל גם להוציא QR קודים"),
// so both are now reached from a "הדפסות" button in the Builder header and the console's top bar.
//
// The host sheet is laid out for A4 and for density (issue 40: 8 pages for 10 missions, "המקום לא
// מנוצל בצורה טובה בכלל"): page one says everything about the day, then the missions run in two
// columns with no forced page break between sections (issue 41: the only breaks are the map, the
// route start and the tear-off staff codes; "every mission on its own page" really is the only
// thing that puts a mission on its own page). Its blanks are fields (issue 42): typed on the
// computer, saved on the game (updateGame → cleanHostSheetFields), printed filled; an empty one
// prints as a line to fill by hand. An optional schedule prints ten "time | what" rows (issue 43).
//
// Everything it SAYS about the game comes from the pure model in lib/hostSheet.ts
// (scripts/test-host-sheet.ts); this file only words it through t.hostSheet and lays it out.
// Printed with the browser (print, or save as PDF), so Hebrew shapes correctly. Every state is
// said with a word, never colour alone, so a black and white printer loses nothing.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import {
  CANONICAL_PLAY_URL, FIRESTORE_PATHS, resolvePlayOrigin, buildStationQrPayload,
  cleanHostSheetFields, hostSheetScheduleRows, type Game, type HostSheetFields, type HostSheetTextKey,
} from '@rushpoint/shared';
import { getGame, updateGame } from '../services/calls';
import { db } from '../services/firebase';
import { useAuth } from '../components/AuthGate';
import { useLanguage, useT } from '../components/LanguageContext';
import { Button, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { buildHostSheet, DEFAULT_HOST_SHEET_OPTIONS, pageFooterCss, stepAnswerSummary, type HostAnswer, type HostSheetOptions, type HostTaskCard } from '../lib/hostSheet';
import { buildStaffCodeRows, type StaffCodeDocLike, type StaffGrantDocLike } from '../lib/staffCodes';
import { mergeMarkers, printTileUrl } from '../lib/printMap';
import { stationQrCards } from '../lib/stationQrSheet';
import { printDocFromParam, type PrintDoc } from '../lib/printDocs';

const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? '';
// The map sources' required credit: names, not copy, so the same in both languages.
const MAP_CREDIT = MAPTILER_KEY.trim() !== '' ? '© MapTiler © OpenStreetMap' : '© OpenTopoMap © OpenStreetMap'; // i18n-ignore: provider names

/**
 * Print once the street map has loaded (change: host-sheet-street-map). A tile
 * still in flight prints as a hole, so wait for every map image to load or fail,
 * at most 8 s, then open the print dialog anyway.
 */
async function printWhenMapReady(): Promise<void> {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.hs-map img, .hs-overview img'));
  const pending = imgs.filter((img) => !img.complete).map((img) => new Promise<void>((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  }));
  await Promise.race([Promise.all(pending), new Promise<void>((resolve) => { setTimeout(resolve, 8000); })]);
  window.print();
}

const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? CANONICAL_PLAY_URL);

// Print rules. Breaks are explicit and few (issue 41): `.hs-break` starts a page, `.hs-keep` keeps a
// card whole, `.hs-with-next` keeps a heading with what follows it. A field prints as its value on
// a rule (`.hs-fill`), a notes box as its text (`.hs-print-only`), never as a form control.
const PRINT_CSS = `
@page { size: A4 portrait; margin: 11mm 11mm 13mm; }
.hs-print-only { display: none; }
@media print {
  header, .hs-toolbar, .rp-mesh-layer, .hs-screen-only { display: none !important; }
  .hs-print-only { display: block !important; }
  html, body { background: #fff !important; }
  /* The app shell's own surfaces printed as a grey block under a short sheet. */
  #root *:not(.hs-sheet):not(.hs-sheet *) { background: transparent !important; box-shadow: none !important; }
  main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .hs-sheet { box-shadow: none !important; border: 0 !important; padding: 0 !important; border-radius: 0 !important; }
  .hs-break { break-before: page; }
  .hs-keep { break-inside: avoid; }
  .hs-with-next { break-after: avoid; }
  .hs-fill { border-color: #78716c !important; background: transparent !important; }
  .hs-fill::placeholder { color: transparent !important; }
  .hs-cols { display: grid !important; grid-template-columns: 1fr 1fr !important; }
  .hs-footer { display: block !important; }
  .hs-qr-grid { grid-template-columns: 1fr 1fr !important; }
}
`;

type T = ReturnType<typeof useT>['hostSheet'];

function useQr(urls: string[], width = 160): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = urls.join('|');
  useEffect(() => {
    let alive = true;
    void Promise.all(urls.map(async (u) => {
      try { return [u, await QRCode.toDataURL(u, { margin: 1, width })] as const; } catch { return [u, ''] as const; }
    })).then((pairs) => { if (alive) setMap(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width]);
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
                {c.correct && <Icon name="check" className="inline w-3.5 h-3.5 me-1" aria-hidden />}
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
      case 'code': return <p>{h.secretCode}: <b className="font-mono text-[13px]">{answer.code}</b></p>;
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
    <div className="mt-1.5 rounded-md border-s-4 border-[#1c1917] bg-[#fff7ed] px-2 py-1 text-[11.5px] leading-snug">
      <span className="font-bold">{h.answerTitle}: </span>
      <div className="inline-block align-top">{body}</div>
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

/** A blank that is a field: an underline to type on, printed as its value (or an empty line). */
function Fill({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className={`flex items-end gap-2 text-[12.5px] ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="shrink-0 font-semibold text-[#44403c]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="auto"
        className="hs-fill min-w-0 flex-1 border-0 border-b border-dashed border-[#a8a29e] bg-[#fafaf9] px-1 pb-0.5 pt-1 text-[13px] text-[#1c1917] outline-none focus:border-solid focus:border-[#c2410c] focus:bg-[#fff7ed]"
      />
    </label>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="hs-with-next font-brand text-[15px] font-bold uppercase tracking-wide text-[#1c1917] border-b-2 border-[#1c1917] pb-0.5 mb-2">{children}</h2>;
}

export default function HostSheetPage() {
  const t = useT();
  const h = t.hostSheet;
  const { lang } = useLanguage();
  const { user } = useAuth();
  const { gameId } = useParams<{ gameId: string }>();
  const [params, setParams] = useSearchParams();
  const runId = params.get('run') ?? '';
  const docKind: PrintDoc = printDocFromParam(params.get('doc'));
  const ownerUid = user?.uid ?? '';

  const [game, setGame] = useState<Game | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState<{ id: string; accessCode?: string; autoApproveAllMedia?: boolean } | null>(null);
  const [codes, setCodes] = useState<StaffCodeDocLike[]>([]);
  const [grants, setGrants] = useState<StaffGrantDocLike[]>([]);
  const [options, setOptions] = useState<HostSheetOptions>(DEFAULT_HOST_SHEET_OPTIONS);
  const [fields, setFields] = useState<HostSheetFields>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    getGame({ gameId }).then((r) => {
      if (!alive) return;
      setGame(r.game);
      setFields(r.game.hostSheetFields ?? {});
    }).catch(() => { if (alive) setFailed(true); });
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

  // Typed fill-ins save themselves (issue 42), 800 ms after the last keystroke, through the one
  // cleaner the server also runs. A failure keeps what was typed and says so.
  function patchFields(patch: Partial<HostSheetFields>) {
    setFields((cur) => {
      const next = { ...cur, ...patch };
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      setSaveState('saving');
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        if (!gameId) return;
        updateGame({ gameId, hostSheetFields: cleanHostSheetFields(next) ?? {} })
          .then(() => setSaveState('saved'))
          .catch(() => setSaveState('failed'));
      }, 800);
      return next;
    });
  }
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);
  const setText = (k: HostSheetTextKey) => (v: string) => patchFields({ [k]: v });

  const sheet = useMemo(() => (game ? buildHostSheet(game, {
    run,
    staffCodes: buildStaffCodeRows(codes, grants),
    options,
    ownerUid,
    playUrl: PLAY_URL,
    lang,
  }) : null), [game, run, codes, grants, options, ownerUid, lang]);

  const cards = useMemo(() => (sheet ? sheet.stages.flatMap((s) => s.cards) : []), [sheet]);
  const stations = useMemo(() => stationQrCards(game?.stages ?? []), [game]);
  const qrUrls = useMemo(() => {
    if (!sheet) return [];
    const urls = cards.flatMap((c) => (c.location.kind === 'point' ? [c.location.navUrl] : []));
    if (sheet.cover.joinLink) urls.push(sheet.cover.joinLink);
    if (sheet.staffPage) urls.push(sheet.staffPage.codes[0].staffLink);
    return [...new Set(urls)];
  }, [sheet, cards]);
  const qr = useQr(qrUrls);
  const stationQr = useQr(useMemo(() => stations.map((s) => buildStationQrPayload(s.code)), [stations]), 300);
  const joinQr = useQr(useMemo(() => (sheet?.cover.joinLink ? [sheet.cover.joinLink] : []), [sheet]), 520);

  if (failed) return <p className="text-center text-[--ink-2] py-10">{h.loadFailed}</p>;
  if (!sheet || !game) return <Spinner label={h.loading} />;

  const printed = new Date().toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB');
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  };
  const scoring = (t.builder.presetLabels as Record<string, { name: string; desc: string }>)[sheet.cover.scoringPreset];
  const backTo = runId ? `/run/${gameId}/${runId}` : `/build/${gameId}`;
  const docTitle = docKind === 'stations' ? h.docStations : docKind === 'join' ? h.docJoin : h.docHost;

  const toggle = (key: keyof HostSheetOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));
  const pickDoc = (d: PrintDoc) => {
    const next = new URLSearchParams(params);
    if (d === 'host') next.delete('doc'); else next.set('doc', d);
    setParams(next, { replace: true });
  };

  const completionWords = (completion: HostTaskCard['completion'], mediaKind: HostTaskCard['mediaKind']) =>
    (completion === 'media' ? h.completion[mediaKind ?? 'photo'] : h.completion[completion]);

  // One mission, compact (issue 40): number, title and a single facts line on top; the authored
  // text; then a dense list of what the host must know. The answer is a slim inline box.
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
    const where = c.location.kind === 'anywhere' ? h.anywhere : c.location.kind === 'unplaced' ? h.unplaced
      : null;
    return (
      <article key={c.id} className={`hs-keep rounded-lg border border-[#d6d3d1] px-2.5 py-2 ${options.cardPerPage ? 'hs-break' : ''}`}>
        <div className="flex items-start gap-2">
          <span className="grid h-6 min-w-[24px] shrink-0 place-items-center rounded-full bg-[#1c1917] px-1 text-white font-bold text-[12px]">{c.number}</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-[13.5px] leading-snug break-words" dir="auto">{c.title}</h3>
            <p className="text-[11.5px] text-[#44403c] leading-snug">{how} · {h.outcomePoints(c.points)}{c.estimatedMinutes ? ` · ${h.minutes(c.estimatedMinutes)}` : ''}</p>
          </div>
          {c.location.kind === 'point' && qr[c.location.navUrl] && (
            <figure className="shrink-0 text-center">
              <img src={qr[c.location.navUrl]} alt="" className="h-12 w-12" />
              <figcaption className="text-[8px] text-[#57534e]">{h.navScan}</figcaption>
            </figure>
          )}
        </div>
        {c.description && <p className="mt-1 text-[12px] leading-snug whitespace-pre-line break-words" dir="auto">{c.description}</p>}
        {c.instructions && (
          <p className="mt-0.5 text-[11.5px] leading-snug whitespace-pre-line break-words" dir="auto"><b>{h.instructions}:</b> {c.instructions}</p>
        )}
        <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-[#292524]">
          <li><b>{h.colWhere}:</b> {where ?? (c.location.kind === 'point'
            ? <span dir="ltr">{c.location.lat.toFixed(5)}, {c.location.lng.toFixed(5)}{c.location.radiusMeters ? ` (${h.radius(c.location.radiusMeters)})` : ''}</span>
            : null)}</li>
          <li><b>{h.colApproval}:</b> {approval}{source ? ` (${source})` : ''}</li>
          {c.hiddenFromPlayers && <li><b>{h.hiddenSpot}.</b>{c.clue && <span dir="auto"> {h.clue}: {c.clue}</span>}</li>}
          {c.hint && (
            <li dir="auto"><b>{h.hint(c.hint.penalty)}</b>
              {[c.hint.autoRevealMinutes ? h.hintAutoMinutes(c.hint.autoRevealMinutes) : '', c.hint.autoRevealAttempts ? h.hintAutoAttempts(c.hint.autoRevealAttempts) : '']
                .filter(Boolean).map((x) => `, ${x}`).join('')}
              {c.hint.text ? `: ${c.hint.text}` : ''}</li>
          )}
          {c.approval.videoLengthCaveat && <li>{h.videoCaveat}</li>}
          {limits.map((x) => <li key={x}>{x}</li>)}
          {c.mediaCount > 0 && <li>{h.media(c.mediaCount)}</li>}
          {c.operatorNotes && <li className="whitespace-pre-line" dir="auto"><b>{h.notes}:</b> {c.operatorNotes}</li>}
        </ul>
        {c.answer && <AnswerBox answer={c.answer} h={h} />}
      </article>
    );
  };

  const scheduleRows = hostSheetScheduleRows(fields);
  const setScheduleCell = (i: number, key: 'time' | 'what', v: string) => {
    const rows = hostSheetScheduleRows(fields).map((r, j) => (j === i ? { ...r, [key]: v } : r));
    patchFields({ schedule: rows });
  };

  // ── The host sheet ──────────────────────────────────────────────────────────
  const hostDoc = (
    <>
      {/* ── Page one: everything about the day ── */}
      <section className="hs-keep">
        <div className="flex flex-col gap-2 border-b-[3px] border-[#1c1917] pb-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#c2410c]">{h.title}</p>
            <h1 className="font-brand text-[24px] font-bold leading-tight break-words" dir="auto">{sheet.cover.title}</h1>
            <p className="mt-0.5 text-[12px] text-[#44403c]">
              {[h.stages(sheet.cover.stageCount), h.tasks(sheet.cover.taskCount),
                sheet.cover.totalMinutes ? h.minutes(sheet.cover.totalMinutes) : '',
                sheet.cover.mode === 'team' ? h.modeTeam : sheet.cover.mode === 'individual' ? h.modeIndividual : '',
                sheet.cover.minAge ? h.minAge(sheet.cover.minAge) : ''].filter(Boolean).join(' · ')}
            </p>
          </div>
          <p className={`shrink-0 self-start rounded-md border-2 px-2 py-1 text-[11px] font-bold ${options.includeAnswers ? 'border-[#b91c1c] text-[#b91c1c]' : 'border-[#1c1917]'}`}>
            <Icon name={options.includeAnswers ? 'lock' : 'eye'} className="inline w-3.5 h-3.5 me-1" aria-hidden />
            {options.includeAnswers ? h.hostOnly : h.noAnswers}
          </p>
        </div>
        {sheet.cover.description && <p className="mt-2 text-[12.5px] leading-snug whitespace-pre-line" dir="auto">{sheet.cover.description}</p>}

        <div className="hs-cols mt-3 grid gap-4 sm:grid-cols-[1.35fr_1fr]">
          <div>
            <SectionTitle>{h.dayDetails}</SectionTitle>
            <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
              <Fill label={h.fillDate} value={fields.date ?? ''} onChange={setText('date')} />
              <Fill label={h.fillMeet} value={fields.meet ?? ''} onChange={setText('meet')} />
              <Fill label={h.fillEmergency} value={fields.emergency ?? ''} onChange={setText('emergency')} />
              <Fill label={h.dayBrief} value={fields.dayBrief ?? ''} onChange={setText('dayBrief')} />
              <Fill label={h.dayStart} value={fields.dayStart ?? ''} onChange={setText('dayStart')} />
              <Fill label={h.dayEnd} value={fields.dayEnd ?? ''} onChange={setText('dayEnd')} />
              <Fill label={h.fillStaff} value={fields.staff ?? ''} onChange={setText('staff')} wide />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border-2 border-[#1c1917] p-2.5">
              {sheet.cover.joinLink && qr[sheet.cover.joinLink] && <img src={qr[sheet.cover.joinLink]} alt="" className="h-20 w-20" />}
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide">{h.joinTitle}</p>
                {sheet.cover.joinCode
                  ? <p className="font-mono text-[26px] font-bold tracking-[0.2em] leading-tight" dir="ltr">{sheet.cover.joinCode}</p>
                  : <p className="text-[12px]">{h.joinPending}</p>}
              </div>
            </div>
            {scoring && (
              <div>
                <p className="text-[12px] font-bold">{h.howToWin}</p>
                <p className="text-[11.5px] leading-snug">{scoring.desc}</p>
                {sheet.cover.hintsCost && <p className="text-[11.5px]">{h.hintsCost}</p>}
                {sheet.cover.wrongAnswerPenalty && sheet.cover.wrongAnswerPenalty !== 'off' && <p className="text-[11.5px]">{h.wrongCosts}</p>}
              </div>
            )}
            <div>
              <p className="text-[12px] font-bold">{h.stuckTitle}</p>
              <p className="text-[11.5px] leading-snug">{h.stuckBody}</p>
            </div>
          </div>
        </div>

        {fields.scheduleOn && (
          <div className="mt-4 hs-keep">
            <SectionTitle>{h.scheduleTitle}</SectionTitle>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-start text-[11px] text-[#57534e]">
                  <th className="w-24 py-0.5 text-start font-semibold">{h.scheduleTime}</th>
                  <th className="py-0.5 text-start font-semibold">{h.scheduleWhat}</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((row, i) => (
                  <tr key={i}>
                    <td className="pe-3 py-0.5 align-bottom">
                      <input value={row.time} onChange={(e) => setScheduleCell(i, 'time', e.target.value)} dir="ltr" aria-label={`${h.scheduleTime} ${i + 1}`}
                        className="hs-fill w-full border-0 border-b border-dashed border-[#a8a29e] bg-[#fafaf9] px-1 py-1 text-center font-mono text-[13px] outline-none focus:border-solid focus:border-[#c2410c] focus:bg-[#fff7ed]" />
                    </td>
                    <td className="py-0.5 align-bottom">
                      <input value={row.what} onChange={(e) => setScheduleCell(i, 'what', e.target.value)} dir="auto" aria-label={`${h.scheduleWhat} ${i + 1}`}
                        className="hs-fill w-full border-0 border-b border-dashed border-[#a8a29e] bg-[#fafaf9] px-1 py-1 text-[13px] outline-none focus:border-solid focus:border-[#c2410c] focus:bg-[#fff7ed]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          <SectionTitle>{h.notesTitle}</SectionTitle>
          <textarea
            value={fields.notes ?? ''}
            onChange={(e) => patchFields({ notes: e.target.value })}
            rows={Math.max(4, (fields.notes ?? '').split('\n').length + 1)}
            placeholder={h.notesPlaceholder}
            dir="auto"
            className="hs-screen-only w-full resize-y rounded-md border border-dashed border-[#a8a29e] bg-[#fafaf9] px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-solid focus:border-[#c2410c] focus:bg-[#fff7ed]"
          />
          {/* On paper: what was typed, then ruled lines to write more by hand. */}
          <div className="hs-print-only">
            {fields.notes && <p className="whitespace-pre-line text-[12.5px] leading-relaxed" dir="auto">{fields.notes}</p>}
            {Array.from({ length: fields.notes ? 3 : 6 }, (_, i) => <div key={i} className="h-6 border-b border-[#a8a29e]" />)}
          </div>
        </div>
      </section>

      {/* ── Map: its own page, it fills one. No located mission ⇒ no map page at all (issue 41: a
          whole page that said "no missions on the map" was one of the eight). ── */}
      {options.includeMap && sheet.map !== null && (
        <section className="hs-break hs-keep mt-8">
          <SectionTitle>{h.mapTitle}</SectionTitle>
          {(
            <>
              <div
                className="hs-map relative mx-auto w-full overflow-hidden rounded-lg border border-[#d6d3d1] bg-[#f5f5f4]"
                style={{ maxWidth: sheet.map.widthPx, aspectRatio: `${sheet.map.widthPx} / ${sheet.map.heightPx}` }}
                role="img"
                aria-label={h.mapTitle}
              >
                {sheet.map.tiles.map((tl) => (
                  <img
                    key={`${tl.z}/${tl.x}/${tl.y}/${tl.left}`}
                    src={printTileUrl(tl.z, tl.x, tl.y, MAPTILER_KEY)}
                    alt=""
                    loading="eager"
                    decoding="async"
                    draggable={false}
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    className="absolute max-w-none select-none"
                    style={{ left: `${tl.left * 100}%`, top: `${tl.top * 100}%`, width: `${tl.w * 100}%`, height: `${tl.h * 100}%` }}
                  />
                ))}
                {mergeMarkers(sheet.map.markers, sheet.map.widthPx, sheet.map.heightPx).map((g) => (
                  <span
                    key={g.numbers.join('-')}
                    dir="ltr"
                    className={`absolute flex h-7 min-w-[28px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-[#1c1917] px-1.5 text-[14px] font-bold leading-none ${g.stage % 2 ? 'bg-[#1c1917] text-white' : 'bg-white text-[#1c1917]'}`}
                    style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%` }}
                  >
                    {g.numbers.join('·')}
                  </span>
                ))}
                <p className="absolute bottom-0 end-0 bg-white/85 px-1.5 text-[9px] text-[#44403c]" dir="ltr">{MAP_CREDIT}</p>
              </div>
              {sheet.overview && (
                <figure className="hs-keep mx-auto mt-2 w-full" style={{ maxWidth: sheet.overview.widthPx }}>
                  <figcaption className="mb-1 text-[11px] font-semibold text-[#44403c]">{h.mapOverview}</figcaption>
                  <div className="hs-overview relative w-full overflow-hidden rounded-lg border border-[#d6d3d1] bg-[#f5f5f4]"
                    style={{ aspectRatio: `${sheet.overview.widthPx} / ${sheet.overview.heightPx}` }} role="img" aria-label={h.mapOverview}>
                    {sheet.overview.tiles.map((tl) => (
                      <img
                        key={`o${tl.z}/${tl.x}/${tl.y}/${tl.left}`}
                        src={printTileUrl(tl.z, tl.x, tl.y, MAPTILER_KEY)}
                        alt=""
                        loading="eager"
                        decoding="async"
                        draggable={false}
                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        className="absolute max-w-none select-none"
                        style={{ left: `${tl.left * 100}%`, top: `${tl.top * 100}%`, width: `${tl.w * 100}%`, height: `${tl.h * 100}%` }}
                      />
                    ))}
                    <span className="absolute rounded-sm border-2 border-[#c2410c] bg-[#c2410c]/10"
                      style={{ left: `${sheet.overview.detailRect.left * 100}%`, top: `${sheet.overview.detailRect.top * 100}%`, width: `${sheet.overview.detailRect.w * 100}%`, height: `${sheet.overview.detailRect.h * 100}%` }} />
                    <p className="absolute bottom-0 end-0 bg-white/85 px-1.5 text-[9px] text-[#44403c]" dir="ltr">{MAP_CREDIT}</p>
                  </div>
                </figure>
              )}
              <ol className="mt-2 grid gap-x-4 text-[11px] sm:grid-cols-2">
                {sheet.stages.flatMap((s) => s.cards.filter((c) => c.location.kind === 'point').map((c) => (
                  <li key={c.id} dir="auto"><b>{c.number}</b> · {c.title} · {h.stageHeading(s.number, '')}</li>
                )))}
              </ol>
            </>
          )}
        </section>
      )}

      {/* ── Route: two dense columns, stage headings kept with their first missions ── */}
      <section className={`mt-6 ${options.includeMap && sheet.map !== null ? 'hs-break' : ''}`}>
        <SectionTitle>{h.routeTitle}</SectionTitle>
        {sheet.stages.map((s) => (
          <div key={s.id} className="mb-4">
            <div className="hs-with-next mb-1.5 flex flex-wrap items-baseline gap-x-3 rounded-md bg-[#f5f5f4] px-2 py-1">
              <h3 className="text-[14px] font-bold" dir="auto">{h.stageHeading(s.number, s.title)}</h3>
              <p className="text-[11.5px] text-[#44403c]">
                {[s.rule.kind === 'all' ? h.ruleAll : h.ruleSome(s.rule.required, s.rule.total),
                  ...s.exclusive.map((g) => h.ruleOnlyOne(g.join(' / '))),
                  s.releaseAfterMinutes ? h.ruleReleaseAfter(s.releaseAfterMinutes) : '',
                  s.releaseAt ? h.ruleReleaseAt(when(s.releaseAt)) : '',
                  s.isFinal ? h.ruleFinal : ''].filter(Boolean).join(' · ')}
              </p>
            </div>
            {s.cards.length === 0 ? <p className="text-sm">{h.noTasks}</p> : (
              <div className={`hs-cols grid gap-2 ${options.cardPerPage ? '' : 'sm:grid-cols-2'}`}>{s.cards.map(card)}</div>
            )}
          </div>
        ))}
      </section>

      {/* ── Answer key: right after the route, no page of its own ── */}
      {sheet.answerRows.length > 0 && (
        <section className="mt-5">
          <SectionTitle>{h.answersTitle}</SectionTitle>
          <table className="w-full text-[12px] border-collapse">
            <thead className="hs-with-next"><tr className="border-b border-[#1c1917] text-start">
              <th className="py-0.5 text-start w-8">#</th>{/* i18n-ignore: a column of numbers */}
              <th className="py-0.5 text-start">{h.colTask}</th>
              <th className="py-0.5 text-start">{h.colAnswer}</th>
            </tr></thead>
            <tbody>
              {sheet.answerRows.map((r) => (
                <tr key={r.number} className="border-b border-[#e7e5e4] hs-keep">
                  <td className="py-0.5 font-bold">{r.number}</td>
                  <td className="py-0.5 pe-2" dir="auto">{r.title}</td>
                  <td className="py-0.5 font-semibold">
                    {/* <bdi>, not dir on the cell: a number answer must not swing the cell to the far edge. */}
                    {r.answer ? <bdi>{shortAnswer(r.answer, h)}</bdi> : <span className="font-normal">{completionWords(r.completion, r.mediaKind)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Staff codes: the tear-off last page ── */}
      {sheet.staffPage && (
        <section className="hs-break mt-8">
          <SectionTitle>{h.staffTitle}</SectionTitle>
          <div className="hs-qr-grid grid gap-3 sm:grid-cols-2">
            {sheet.staffPage.codes.map((s, i) => (
              <div key={i} className="hs-keep flex items-center gap-3 rounded-lg border-2 border-dashed border-[#1c1917] p-3">
                {qr[s.staffLink] && <img src={qr[s.staffLink]} alt="" className="h-20 w-20" />}
                <div className="min-w-0">
                  <p className="font-bold break-words" dir="auto">{s.label}</p>
                  <p className="text-[12px]">{s.capabilities.map((c) => (t.runConsole.staffCaps as Record<string, { name: string }>)[c]?.name).filter(Boolean).join(', ')}</p>
                  <p className="text-[12px]">{h.staffCode}: <b className="font-mono text-base" dir="ltr">{s.pin}</b></p>
                  <p className="text-[11px] text-[#57534e]">{h.staffNoScan}</p>
                  <p className="text-[10px] text-[#57534e]">{h.staffScan}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );

  // ── Station QR cards (issue 44): two per row, a cut line around each ──────────
  const stationsDoc = stations.length === 0 ? <p className="py-10 text-center text-sm">{h.stationsEmpty}</p> : (
    <>
      <div className="hs-screen-only mb-4">
        <p className="text-[13px] text-[#44403c]">{h.stationsIntro}</p>
      </div>
      <div className="hs-qr-grid grid gap-4 sm:grid-cols-2">
        {stations.map((st) => {
          const img = stationQr[buildStationQrPayload(st.code)];
          return (
            <section key={st.key} className="hs-keep flex flex-col items-center rounded-xl border-2 border-dashed border-[#1c1917] px-4 py-5 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#c2410c]">{t.runConsole.printQrHeading}</p>
              <h2 className="mt-1 font-brand text-[20px] font-bold leading-tight break-words" dir="auto">{st.title}</h2>
              {st.points !== undefined && <p className="mt-0.5 text-[13px]" dir="auto">{t.runConsole.printQrWorth({ code: st.code, n: st.points })}</p>}
              {img && <img src={img} alt="" className="mt-3 h-48 w-48" />}
              <p className="mt-2 text-[10px] uppercase tracking-[0.15em] text-[#57534e]">{t.runConsole.printQrCodeFallback}</p>
              <p className="font-mono text-[22px] font-bold tracking-[0.15em]" dir="ltr">{st.code}</p>
            </section>
          );
        })}
      </div>
    </>
  );

  // ── Join sign (issue 44): one A4 for the start point ─────────────────────────
  const joinDoc = !sheet.cover.joinCode || !sheet.cover.joinLink
    ? <p className="py-10 text-center text-sm">{h.joinSignNoRun}</p>
    : (
      <section className="hs-keep flex min-h-[250mm] flex-col items-center justify-center gap-5 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.25em] text-[#c2410c]">{h.joinSignHeading}</p>
        <h1 className="font-brand text-[44px] font-bold leading-tight break-words" dir="auto">{sheet.cover.title}</h1>
        {joinQr[sheet.cover.joinLink] && <img src={joinQr[sheet.cover.joinLink]} alt="" className="h-[95mm] w-[95mm]" />}
        <p className="text-[18px] font-semibold">{h.joinSignScan}</p>
        <div>
          <p className="text-[14px] text-[#44403c]">{h.joinSignOr}</p>
          <p className="mt-1 text-[18px] font-semibold" dir="ltr">{PLAY_URL.replace(/^https?:\/\//, '')}</p>
        </div>
        <p className="rounded-2xl border-[3px] border-[#1c1917] px-8 py-3 font-mono text-[56px] font-bold tracking-[0.25em]" dir="ltr">{sheet.cover.joinCode}</p>
      </section>
    );

  return (
    <div className="mx-auto max-w-4xl">
      <style>{PRINT_CSS}</style>
      {/* Every printed page says what it is and when it was printed (lib/hostSheet.ts). */}
      <style>{pageFooterCss(h.printedOn(`${sheet.cover.title} · ${docTitle}`, printed))}</style>

      {/* Toolbar: never printed. Which document, its options, the save state, print. */}
      <div className="hs-toolbar sm:sticky top-0 z-10 mb-4 rounded-xl border border-[--rp-border] bg-[--surface-1] p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={backTo} className="inline-flex min-h-[44px] items-center px-2 text-sm text-[--ink-2] hover:text-[--ink-1]">{h.back}</Link>
          <h1 className="font-brand font-semibold text-[--ink-1] me-auto inline-flex items-center gap-2">
            <Icon name="printer" className="w-4 h-4" aria-hidden />{h.printsTitle}
          </h1>
          <div role="tablist" aria-label={h.docsLabel} className="inline-flex rounded-lg border border-[--rp-border] bg-[--surface-2] p-0.5">
            {([['host', h.docHost], ['stations', h.docStations], ['join', h.docJoin]] as const).map(([d, label]) => (
              <button key={d} type="button" role="tab" aria-selected={docKind === d} data-testid={`print-doc-${d}`} onClick={() => pickDoc(d)}
                className={`min-h-[40px] rounded-md px-3 text-sm font-medium ${docKind === d ? 'bg-[--surface-0] text-[--ink-1] shadow-sm' : 'text-[--ink-3] hover:text-[--ink-1]'}`}>
                {label}
              </button>
            ))}
          </div>
          <Button onClick={() => { void printWhenMapReady(); }} className="min-h-[44px]">
            <span className="inline-flex items-center gap-2"><Icon name="printer" className="w-4 h-4" aria-hidden />{h.print}</span>
          </Button>
        </div>
        {docKind === 'host' && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[--rp-border] pt-2">
            {([['includeAnswers', h.optAnswers], ['includeMap', h.optMap], ['cardPerPage', h.optCardPerPage]] as const).map(([key, label]) => (
              <label key={key} className="inline-flex min-h-[40px] items-center gap-2 text-sm text-[--ink-2]">
                <input type="checkbox" checked={options[key]} onChange={() => toggle(key)} className="h-4 w-4" />
                {label}
              </label>
            ))}
            <label className="inline-flex min-h-[40px] items-center gap-2 text-sm text-[--ink-2]">
              <input type="checkbox" data-testid="hs-schedule-toggle" checked={fields.scheduleOn === true}
                onChange={() => patchFields({ scheduleOn: fields.scheduleOn !== true })} className="h-4 w-4" />
              {h.optSchedule}
            </label>
            <p className="ms-auto text-xs text-[--ink-3]" role="status" aria-live="polite">
              {saveState === 'saving' ? h.saving : saveState === 'saved' ? h.saved
                : saveState === 'failed' ? <span className="font-semibold text-ink-alert">{h.saveFailed}</span> : h.fillHint}
            </p>
          </div>
        )}
      </div>

      <div className="hs-sheet rounded-2xl border border-[--rp-border] bg-white px-5 py-6 text-[#1c1917] shadow-sm sm:px-10 sm:py-9">
        {docKind === 'stations' ? stationsDoc : docKind === 'join' ? joinDoc : hostDoc}
      </div>
    </div>
  );
}
