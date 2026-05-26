import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, ensureAuth } from '../services/firebase';
import {
  TENE_PRODUCTS,
  TIER_LABEL,
  TIER_ACCENT,
  MAX_DESIGN_SCORE,
  MAX_PRESENTATION_SCORE,
  type ProductTier,
} from '../data/teneProducts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Arrival {
  checkInId: string;
  teamId:    string;
  teamName:  string;
  teamCode:  string;
  taskId:    string;
  taskTitle: string;
  timestamp: string | null;
  arrivedAt: string | null;
}

interface FinalizeResult {
  newScore: number;
  total:    number;
  breakdown: {
    products: string[];
    productScore: number;
    designScore: number;
    presentationScore: number;
    total: number;
  };
  allDone: boolean;
}

const TIER_ORDER: ProductTier[] = ['basic', 'medium', 'hard'];

// ─── Callables ────────────────────────────────────────────────────────────────

const listPendingArrivals    = httpsCallable(functions, 'listPendingArrivals');
const checkInArrival         = httpsCallable(functions, 'checkInArrival');
const finalizeJudgeEvaluation = httpsCallable(functions, 'finalizeJudgeEvaluation');

// ═══════════════════════════════════════════════════════════════════════════════
// Judge Page
// ═══════════════════════════════════════════════════════════════════════════════

export default function JudgePage() {
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  // The team currently being evaluated (already checked in), or null = list view.
  const [active, setActive]         = useState<Arrival | null>(null);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

  // Evaluation form state
  const [picked, setPicked]             = useState<Set<string>>(new Set());
  const [design, setDesign]             = useState(0);
  const [presentation, setPresentation] = useState(0);
  const [note, setNote]                 = useState('');
  const [submitting, setSubmitting]     = useState(false);

  const [result, setResult] = useState<(FinalizeResult & { teamName: string }) | null>(null);

  // ── Load pending arrivals ────────────────────────────────────────────────────
  const loadArrivals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await ensureAuth();
      const res = await listPendingArrivals();
      setArrivals((res.data as { arrivals: Arrival[] }).arrivals ?? []);
    } catch (err) {
      setError('Could not load pending teams. Is the emulator running?');
      console.error('[judge] listPendingArrivals failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadArrivals();
  }, [loadArrivals]);

  // ── Check-in (freezes the team's clock on mobile) ────────────────────────────
  async function handleCheckIn(arrival: Arrival) {
    setCheckingInId(arrival.checkInId);
    setError('');
    try {
      await ensureAuth();
      await checkInArrival({ teamId: arrival.teamId, checkInId: arrival.checkInId });
      // Move into evaluation; reset the grading sheet.
      setActive(arrival);
      setPicked(new Set());
      setDesign(0);
      setPresentation(0);
      setNote('');
    } catch (err) {
      setError('Check-in failed. Try again.');
      console.error('[judge] checkInArrival failed:', err);
    } finally {
      setCheckingInId(null);
    }
  }

  // ── Live total ───────────────────────────────────────────────────────────────
  const productScore = useMemo(
    () => TENE_PRODUCTS.filter((p) => picked.has(p.id)).reduce((s, p) => s + p.points, 0),
    [picked],
  );
  const total = productScore + design + presentation;

  function toggleProduct(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Finalize & release ───────────────────────────────────────────────────────
  async function handleFinalize() {
    if (!active) return;
    setSubmitting(true);
    setError('');
    try {
      await ensureAuth();
      const res = await finalizeJudgeEvaluation({
        teamId:            active.teamId,
        checkInId:         active.checkInId,
        products:          Array.from(picked),
        designScore:       design,
        presentationScore: presentation,
        judgeNote:         note.trim(),
      });
      const data = res.data as FinalizeResult;
      setResult({ ...data, teamName: active.teamName });
      setActive(null);
      void loadArrivals();
    } catch (err) {
      setError('Could not finalize the score. Try again.');
      console.error('[judge] finalizeJudgeEvaluation failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-white">Judge Station</h1>
        {!active && !result && (
          <button
            onClick={() => void loadArrivals()}
            className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            ↻ Refresh
          </button>
        )}
      </div>
      <p className="text-zinc-500 text-sm mb-8">
        Check teams in on arrival, then grade their Tene basket.
      </p>

      {error && (
        <div className="mb-6 rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {result ? (
        <ResultCard
          result={result}
          onNext={() => setResult(null)}
        />
      ) : active ? (
        <EvaluationForm
          arrival={active}
          picked={picked}
          onToggle={toggleProduct}
          design={design}
          presentation={presentation}
          onDesign={setDesign}
          onPresentation={setPresentation}
          note={note}
          onNote={setNote}
          productScore={productScore}
          total={total}
          submitting={submitting}
          onFinalize={() => void handleFinalize()}
          onCancel={() => setActive(null)}
        />
      ) : (
        <ArrivalList
          arrivals={arrivals}
          loading={loading}
          checkingInId={checkingInId}
          onCheckIn={(a) => void handleCheckIn(a)}
        />
      )}
    </div>
  );
}

// ─── Arrival list ─────────────────────────────────────────────────────────────

function ArrivalList({
  arrivals, loading, checkingInId, onCheckIn,
}: {
  arrivals: Arrival[];
  loading: boolean;
  checkingInId: string | null;
  onCheckIn: (a: Arrival) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-12 text-center text-zinc-500">
        Loading pending teams…
      </div>
    );
  }
  if (arrivals.length === 0) {
    return (
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-12 text-center text-zinc-600">
        No teams waiting. They’ll appear here when they check in at your station.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {arrivals.map((a) => (
        <div
          key={a.checkInId}
          className="flex items-center justify-between rounded-xl bg-zinc-900 border border-zinc-800 px-5 py-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{a.teamName}</span>
              {a.teamCode && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {a.teamCode}
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">{a.taskTitle}</p>
          </div>
          <button
            onClick={() => onCheckIn(a)}
            disabled={checkingInId !== null}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {checkingInId === a.checkInId ? 'Checking in…' : 'Approve Arrival / Check-In'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Evaluation form ──────────────────────────────────────────────────────────

function EvaluationForm({
  arrival, picked, onToggle,
  design, presentation, onDesign, onPresentation,
  note, onNote, productScore, total, submitting, onFinalize, onCancel,
}: {
  arrival: Arrival;
  picked: Set<string>;
  onToggle: (id: string) => void;
  design: number;
  presentation: number;
  onDesign: (v: number) => void;
  onPresentation: (v: number) => void;
  note: string;
  onNote: (v: string) => void;
  productScore: number;
  total: number;
  submitting: boolean;
  onFinalize: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      {/* Frozen banner */}
      <div className="rounded-xl bg-sky-950 border border-sky-800 px-5 py-3 mb-6 flex items-center justify-between">
        <div>
          <p className="text-sky-300 font-semibold">{arrival.teamName} checked in</p>
          <p className="text-sky-500/80 text-sm">Their race clock is frozen while you grade.</p>
        </div>
        <button onClick={onCancel} className="text-sky-400 hover:text-sky-200 text-sm">
          ← Back
        </button>
      </div>

      {/* A. Tene product checklist */}
      <Section title="A. Tene Checklist" hint="Tick everything the team actually brought.">
        <div className="space-y-5">
          {TIER_ORDER.map((tier) => (
            <div key={tier}>
              <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${TIER_ACCENT[tier]}`}>
                {TIER_LABEL[tier]}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {TENE_PRODUCTS.filter((p) => p.tier === tier).map((p) => {
                  const on = picked.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => onToggle(p.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                        on
                          ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`inline-block w-4 h-4 rounded border ${
                          on ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'
                        }`}>
                          {on && <span className="block text-white text-xs leading-4 text-center">✓</span>}
                        </span>
                        {p.label}
                      </span>
                      <span className="text-zinc-500 font-mono text-xs">+{p.points}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-right text-sm text-zinc-400">
          Product score: <span className="font-bold text-white">{productScore}</span>
        </div>
      </Section>

      {/* B. Visual design */}
      <Section title="B. Visual Design & Aesthetics" hint={`Decorations and effort (0–${MAX_DESIGN_SCORE}).`}>
        <ScoreSlider value={design} max={MAX_DESIGN_SCORE} onChange={onDesign} />
      </Section>

      {/* C. Presentation */}
      <Section title="C. Team Presentation & Synergy" hint={`Cohesion and delivery (0–${MAX_PRESENTATION_SCORE}).`}>
        <ScoreSlider value={presentation} max={MAX_PRESENTATION_SCORE} onChange={onPresentation} />
      </Section>

      {/* Note */}
      <Section title="Judge Note" hint="Optional — recorded with the score.">
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={2}
          placeholder="e.g. Beautiful olive arrangement, great teamwork."
          className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none text-sm"
        />
      </Section>

      {/* Live total + finalize */}
      <div className="sticky bottom-0 mt-8 rounded-xl bg-zinc-900 border border-zinc-700 p-5">
        <div className="flex items-end justify-between mb-4">
          <div className="text-sm text-zinc-400 space-y-0.5">
            <div>Products <span className="text-zinc-500">{productScore}</span></div>
            <div>Design <span className="text-zinc-500">{design}</span></div>
            <div>Presentation <span className="text-zinc-500">{presentation}</span></div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Total Calculated Score</p>
            <p className="text-4xl font-black text-emerald-400 tabular-nums">{total}</p>
          </div>
        </div>
        <button
          onClick={onFinalize}
          disabled={submitting}
          className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-colors"
        >
          {submitting ? 'Releasing…' : 'Finalize & Release Team'}
        </button>
      </div>
    </div>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({
  result, onNext,
}: {
  result: FinalizeResult & { teamName: string };
  onNext: () => void;
}) {
  const b = result.breakdown;
  return (
    <div className="rounded-xl bg-emerald-950/40 border border-emerald-800 p-6">
      <p className="text-emerald-400 font-bold text-lg mb-1">
        {result.teamName} released {result.allDone ? '— race complete! 🏁' : ''}
      </p>
      <p className="text-zinc-400 text-sm mb-5">Their clock has resumed for the next mission.</p>

      <div className="rounded-lg bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800 text-sm">
        <Row label="Product score"      value={b.productScore} />
        <Row label="Visual design"      value={b.designScore} />
        <Row label="Team presentation"  value={b.presentationScore} />
        <Row label="Basket total"       value={b.total} strong />
        <Row label="New team score"     value={result.newScore} strong accent />
      </div>

      <button
        onClick={onNext}
        className="mt-5 text-sm text-zinc-400 hover:text-white"
      >
        ← Judge another team
      </button>
    </div>
  );
}

// ─── Small building blocks ────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-white font-semibold">{title}</h2>
      {hint && <p className="text-zinc-500 text-sm mb-3">{hint}</p>}
      {children}
    </div>
  );
}

function ScoreSlider({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-emerald-500"
      />
      <span className="w-12 text-right font-mono text-lg text-white tabular-nums">{value}</span>
    </div>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: number; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className={strong ? 'text-white font-semibold' : 'text-zinc-400'}>{label}</span>
      <span className={`font-mono tabular-nums ${accent ? 'text-emerald-400 font-bold' : strong ? 'text-white font-semibold' : 'text-zinc-300'}`}>
        {value}
      </span>
    </div>
  );
}
