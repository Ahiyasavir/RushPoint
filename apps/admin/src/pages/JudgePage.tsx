import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
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
    taskScore: number;
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
  const { t } = useI18n();
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
      setError(t('judge.loadError'));
      console.error('[judge] listPendingArrivals failed:', err);
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      setError(t('judge.checkInError'));
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
      setError(t('judge.finalizeError'));
      console.error('[judge] finalizeJudgeEvaluation failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-brand text-2xl font-bold text-white">{t('judge.title')}</h1>
        {!active && !result && (
          <button
            onClick={() => void loadArrivals()}
            className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-glass-border hover:bg-white/5 transition-all"
          >
            ↻ {t('common.refresh')}
          </button>
        )}
      </div>
      <p className="text-zinc-500 text-sm mb-8">
        {t('judge.subtitle')}
      </p>

      {error && (
        <div className="mb-6 rounded-xl bg-red-950/50 border border-red-500/30 px-4 py-3 text-red-300 text-sm">
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
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-500">
        {t('judge.loadingTeams')}
      </div>
    );
  }
  if (arrivals.length === 0) {
    return (
      <div className="rounded-2xl bg-app-card border border-glass-border p-12 text-center text-zinc-500">
        {t('judge.noTeams')}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {arrivals.map((a) => (
        <div
          key={a.checkInId}
          className="flex items-center justify-between rounded-2xl bg-app-card border border-glass-border px-5 py-4 hover:border-neon-green/20 transition-all"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{a.teamName}</span>
              {a.teamCode && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-app-raised text-zinc-400">
                  {a.teamCode}
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">{a.taskTitle}</p>
          </div>
          <button
            onClick={() => onCheckIn(a)}
            disabled={checkingInId !== null}
            className="px-4 py-2 rounded-xl bg-neon-green/10 border border-neon-green/30 hover:bg-neon-green/20 disabled:opacity-50 disabled:cursor-not-allowed text-neon-green text-sm font-semibold transition-all"
          >
            {checkingInId === a.checkInId ? t('judge.checkingIn') : t('judge.approve')}
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
  const { t } = useI18n();
  return (
    <div>
      {/* Frozen banner */}
      <div className="rounded-2xl bg-neon-blue/5 border border-neon-blue/30 px-5 py-4 mb-6 flex items-center justify-between backdrop-blur-sm">
        <div>
          <p className="text-neon-blue font-semibold">{t('judge.checkedInBanner', { team: arrival.teamName })}</p>
          <p className="text-neon-blue/60 text-sm">{t('judge.clockFrozen')}</p>
        </div>
        <button onClick={onCancel} className="text-neon-blue/70 hover:text-neon-blue text-sm transition-colors">
          ← {t('common.back')}
        </button>
      </div>

      {/* A. Tene product checklist */}
      <Section title={t('judge.sectionChecklist')} hint={t('judge.sectionChecklistHint')}>
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
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-all ${
                        on
                          ? 'bg-neon-green/10 border-neon-green/30 text-neon-green shadow-glow-green'
                          : 'bg-app-card border-glass-border text-zinc-300 hover:border-white/20'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`inline-block w-4 h-4 rounded border ${
                          on ? 'bg-neon-green border-neon-green' : 'border-zinc-600'
                        }`}>
                          {on && <span className="block text-black text-xs leading-4 text-center">✓</span>}
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
        <div className="mt-3 text-end text-sm text-zinc-400">
          {t('judge.productScore')} <span className="font-bold text-white">{productScore}</span>
        </div>
      </Section>

      {/* B. Visual design */}
      <Section title={t('judge.sectionDesign')} hint={t('judge.sectionDesignHint', { max: MAX_DESIGN_SCORE })}>
        <ScoreSlider value={design} max={MAX_DESIGN_SCORE} onChange={onDesign} />
      </Section>

      {/* C. Presentation */}
      <Section title={t('judge.sectionPresentation')} hint={t('judge.sectionPresentationHint', { max: MAX_PRESENTATION_SCORE })}>
        <ScoreSlider value={presentation} max={MAX_PRESENTATION_SCORE} onChange={onPresentation} />
      </Section>

      {/* Note */}
      <Section title={t('judge.note')} hint={t('judge.noteHint')}>
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={2}
          placeholder={t('judge.notePlaceholder')}
          className="w-full px-4 py-2.5 rounded-xl bg-app-card border border-glass-border text-white placeholder-zinc-600 focus:outline-none focus:border-neon-green/40 focus:ring-1 focus:ring-neon-green/20 resize-none text-sm transition-all"
        />
      </Section>

      {/* Live total + finalize */}
      <div className="sticky bottom-0 mt-8 rounded-2xl bg-app-surface/90 border border-glass-border p-5 backdrop-blur-xl">
        <div className="flex items-end justify-between mb-4">
          <div className="text-sm text-zinc-400 space-y-0.5">
            <div>{t('judge.labelProducts')} <span className="text-zinc-500">{productScore}</span></div>
            <div>{t('judge.labelDesign')} <span className="text-zinc-500">{design}</span></div>
            <div>{t('judge.labelPresentation')} <span className="text-zinc-500">{presentation}</span></div>
          </div>
          <div className="text-end">
            <p className="text-xs uppercase tracking-widest text-zinc-500">{t('judge.totalCalculated')}</p>
            <p className="text-4xl font-black text-neon-green tabular-nums font-mono">{total}</p>
          </div>
        </div>
        <button
          onClick={onFinalize}
          disabled={submitting}
          className="w-full py-3.5 rounded-xl bg-neon-green text-black font-bold hover:opacity-90 disabled:opacity-50 transition-all text-sm tracking-wide shadow-glow-cta"
        >
          {submitting ? t('judge.releasing') : t('judge.finalize')}
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
  const { t } = useI18n();
  const b = result.breakdown;
  return (
    <div className="rounded-2xl bg-neon-green/5 border border-neon-green/30 p-6">
      <p className="text-neon-green font-bold text-lg mb-1">
        {result.allDone
          ? t('judge.releasedComplete', { team: result.teamName })
          : t('judge.released', { team: result.teamName })}
      </p>
      <p className="text-zinc-400 text-sm mb-5">{t('judge.clockResumed')}</p>

      <div className="rounded-xl bg-app-card border border-glass-border divide-y divide-glass-border text-sm">
        <Row label={t('judge.rowTaskCompletion')} value={b.taskScore} />
        <Row label={t('judge.rowProductScore')}   value={b.productScore} />
        <Row label={t('judge.rowVisualDesign')}    value={b.designScore} />
        <Row label={t('judge.rowPresentation')}    value={b.presentationScore} />
        <Row label={t('judge.rowBasketTotal')}     value={b.total} strong />
        <Row label={t('judge.rowNewScore')}        value={result.newScore} strong accent />
      </div>

      <button
        onClick={onNext}
        className="mt-5 text-sm text-zinc-400 hover:text-white transition-colors"
      >
        ← {t('judge.judgeAnother')}
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
        className="flex-1 accent-[#00ffaa]"
      />
      <span className="w-12 text-right font-mono text-lg text-white tabular-nums">{value}</span>
    </div>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: number; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className={strong ? 'text-white font-semibold' : 'text-zinc-400'}>{label}</span>
      <span className={`font-mono tabular-nums ${accent ? 'text-neon-green font-bold' : strong ? 'text-white font-semibold' : 'text-zinc-300'}`}>
        {value}
      </span>
    </div>
  );
}
