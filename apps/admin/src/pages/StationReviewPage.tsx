import React, { useCallback, useState } from 'react';
import type { StationSubmission, StationSubmissionStatus, VerificationType } from '@rushpoint/shared';
import { callable } from '../services/api';
import { usePoll } from '../hooks/usePoll';
import { useI18n } from '../i18n';

const listStationReviews = callable<{ status?: string }, { reviews: StationSubmission[] }>('listStationReviews');
const reviewStationSubmission = callable<{ submissionId: string; approve: boolean; rejectionReason?: string }>('reviewStationSubmission');

const FILTERS: StationSubmissionStatus[] = ['pending', 'approved', 'rejected'];

const VERIFY_KEY: Record<VerificationType, string> = {
  manual_judge: 'review.verifyManual',
  code_verification: 'review.verifyCode',
  photo_upload: 'review.verifyPhoto',
};

function shortId(id: string): string {
  return id.length > 6 ? `${id.slice(0, 6)}…` : id;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// ─── Smart-station review queue ──────────────────────────────────────────────
// Live (10s poll) list of photo_upload / manual_judge submissions. Admins approve
// or reject (with an optional reason) each pending card. Approved/Rejected tabs are
// read-only history.
export default function StationReviewPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<StationSubmissionStatus>('pending');
  const [reviews, setReviews] = useState<StationSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await listStationReviews({ status: filter });
      setReviews(res.reviews ?? []);
    } catch (e) {
      setError(t('review.loadError'));
      console.error('[review] listStationReviews failed:', e);
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  // Re-fetch on mount and whenever the filter changes; keep it live with a 10s poll.
  usePoll(load, 10_000);

  const act = useCallback(async (s: StationSubmission, approve: boolean) => {
    setActingId(s.id);
    setError('');
    setNotice('');
    try {
      const rejectionReason = approve ? undefined : (reasons[s.id]?.trim() || undefined);
      await reviewStationSubmission({ submissionId: s.id, approve, rejectionReason });
      setReviews((prev) => prev.filter((x) => x.id !== s.id));
      setNotice(approve ? t('review.approved') : t('review.rejected'));
      window.setTimeout(() => setNotice(''), 3000);
    } catch (e) {
      setError(t('review.actionError'));
      console.error('[review] reviewStationSubmission failed:', e);
    } finally {
      setActingId(null);
    }
  }, [reasons, t]);

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8">
      <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('review.title')}</h1>
      <p className="text-zinc-500 text-sm mb-4">{t('review.subtitle')}</p>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setLoading(true); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              filter === f
                ? 'bg-neon-green text-black border-neon-green'
                : 'text-white border-glass-border hover:bg-white/5'
            }`}
          >
            {t(`review.filter.${f}`)}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-3 rounded-xl bg-neon-green/5 border border-neon-green/30 px-4 py-2.5 text-neon-green text-sm">{notice}</div>
      )}
      {error && (
        <div className="mb-3 rounded-xl bg-neon-red/5 border border-neon-red/30 px-4 py-2.5 text-neon-red text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">{t('review.loading')}</p>
      ) : reviews.length === 0 ? (
        <p className="text-zinc-500 text-sm">{t('review.empty')}</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((s) => (
            <ReviewCard
              key={s.id}
              s={s}
              acting={actingId === s.id}
              reason={reasons[s.id] ?? ''}
              onReason={(v) => setReasons((r) => ({ ...r, [s.id]: v }))}
              onApprove={() => void act(s, true)}
              onReject={() => void act(s, false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ s, acting, reason, onReason, onApprove, onReject }: {
  s: StationSubmission;
  acting: boolean;
  reason: string;
  onReason: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useI18n();
  const isPending = s.status === 'pending';
  const statusTone =
    s.status === 'approved' ? 'text-neon-green border-neon-green/40'
    : s.status === 'rejected' ? 'text-neon-red border-neon-red/40'
    : 'text-neon-gold border-neon-gold/40';

  return (
    <div className="rounded-2xl border border-glass-border bg-app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-white font-semibold">{s.teamName || t('review.unknownTeam')}</p>
          <p className="text-[11px] text-zinc-500 font-mono">{t('review.teamId')}: {shortId(s.teamId)}</p>
          <p className="text-zinc-400 text-sm mt-1">{s.taskTitle || s.taskId}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold border border-glass-border text-zinc-300">
            {t(VERIFY_KEY[s.verificationType])}
          </span>
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${statusTone}`}>
            {t(`review.filter.${s.status}`)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-zinc-500 mt-2">{t('review.submittedAt')}: {formatTime(s.submittedAt)}</p>

      {s.photoUrl && (
        <img
          src={s.photoUrl}
          alt={t('review.photoAlt')}
          className="mt-3 w-full max-h-72 object-contain rounded-xl border border-glass-border bg-app-surface"
        />
      )}

      {s.status === 'rejected' && s.rejectionReason && (
        <p className="text-[12px] text-neon-red mt-2">{t('review.rejectionReason')}: {s.rejectionReason}</p>
      )}

      {isPending && (
        <div className="mt-3 space-y-2">
          <input
            className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm"
            placeholder={t('review.reasonPlaceholder')}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onApprove}
              disabled={acting}
              className="flex-1 py-2.5 rounded-xl bg-neon-green text-black font-bold text-sm disabled:opacity-50"
            >
              {acting ? t('review.working') : t('review.approve')}
            </button>
            <button
              onClick={onReject}
              disabled={acting}
              className="flex-1 py-2.5 rounded-xl border border-neon-red/40 text-neon-red font-semibold text-sm hover:bg-neon-red/10 disabled:opacity-50"
            >
              {t('review.reject')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
