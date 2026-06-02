import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import type { AccessCodeStatus } from '@rushpoint/shared';
import { callable } from '../services/api';
import { db, APP_ID } from '../services/firebase';
import { useI18n } from '../i18n';

// Local row shape derived from the accessCodes Firestore docs (incl. legacy fields).
interface CodeRow {
  code: string;
  status: AccessCodeStatus;
  gameId: string | null;
  label: string | null;
  assignedTeamId: string | null;
  createdAt: string | null;
  usedAt: string | null;
  createdBy: string | null;
}

type FilterKey = 'all' | AccessCodeStatus;

const STATUS_BADGE: Record<AccessCodeStatus, string> = {
  unused:  'bg-neon-gold/10 text-neon-gold border border-neon-gold/30',
  used:    'bg-neon-green/10 text-neon-green border border-neon-green/30',
  revoked: 'bg-neon-red/10 text-neon-red border border-neon-red/30',
};

const createCodeFn = callable<
  { code?: string; label?: string; gameId?: string },
  { success: boolean; code: string; label: string | null }
>('adminCreateCode');
const bulkCreateFn = callable<
  { count: number; gameId?: string; label?: string },
  { success: boolean; count: number; codes: string[] }
>('adminBulkCreateCodes');
const revokeCodeFn = callable<
  { code: string; delete?: boolean },
  { success: boolean; code: string; deleted: boolean }
>('adminRevokeCode');

// Short display for a team id (anonymous uids are long).
function shortTeam(id: string | null): string {
  if (!id) return '—';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
}

export default function AccessCodesPage() {
  const { t } = useI18n();
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  // Create-one form.
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newGame, setNewGame] = useState('');
  const [creating, setCreating] = useState(false);

  // Bulk-create form.
  const [showBulk, setShowBulk] = useState(false);
  const [bulkCount, setBulkCount] = useState('10');
  const [bulkLabel, setBulkLabel] = useState('');
  const [bulkGame, setBulkGame] = useState('');
  const [bulkCreating, setBulkCreating] = useState(false);

  // Two-step armed revoke/delete (per row + action).
  const [armed, setArmed] = useState<{ code: string; action: 'revoke' | 'delete' } | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  // Auto-dismiss transient banners after ~4s.
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((kind: 'notice' | 'error', msg: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    if (kind === 'notice') { setNotice(msg); setError(null); }
    else { setError(msg); setNotice(null); }
    bannerTimer.current = setTimeout(() => { setNotice(null); setError(null); }, 4000);
  }, []);
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  // Live table via onSnapshot on the client-readable accessCodes collection.
  useEffect(() => {
    const ref = collection(db, 'artifacts', APP_ID, 'accessCodes');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows: CodeRow[] = snap.docs.map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          const status = (data.status as AccessCodeStatus | undefined)
            ?? ((data.claimed as boolean | undefined) ? 'used' : 'unused');
          return {
            code: (data.code as string | undefined) ?? doc.id,
            status,
            gameId: (data.gameId as string | null | undefined) ?? null,
            label: (data.label as string | null | undefined) ?? null,
            assignedTeamId:
              (data.assignedTeamId as string | null | undefined)
              ?? (data.teamId as string | null | undefined)
              ?? null,
            createdAt: (data.createdAt as string | null | undefined) ?? null,
            usedAt: (data.usedAt as string | null | undefined) ?? null,
            createdBy: (data.createdBy as string | null | undefined) ?? null,
          };
        });
        rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        setCodes(rows);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err instanceof Error ? err.message : t('codes.loadError'));
        setLoading(false);
      },
    );
    return unsub;
  }, [t]);

  const counts = useMemo(() => {
    const c = { all: codes.length, unused: 0, used: 0, revoked: 0 };
    for (const row of codes) c[row.status] += 1;
    return c;
  }, [codes]);

  const visible = useMemo(
    () => (filter === 'all' ? codes : codes.filter((r) => r.status === filter)),
    [codes, filter],
  );

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await createCodeFn({
        code: newCode.trim() || undefined,
        label: newLabel.trim() || undefined,
        gameId: newGame.trim() || undefined,
      });
      flash('notice', t('codes.created', { code: res.code }));
      setNewCode(''); setNewLabel(''); setNewGame(''); setShowAdd(false);
    } catch (err: unknown) {
      flash('error', err instanceof Error ? err.message : t('codes.createError'));
    } finally {
      setCreating(false);
    }
  }, [newCode, newLabel, newGame, t, flash]);

  const handleBulk = useCallback(async () => {
    const count = Math.max(1, Math.min(200, Math.floor(Number(bulkCount) || 0)));
    setBulkCreating(true);
    try {
      const res = await bulkCreateFn({
        count,
        label: bulkLabel.trim() || undefined,
        gameId: bulkGame.trim() || undefined,
      });
      flash('notice', t('codes.bulkCreated', { n: res.count }));
      setBulkCount('10'); setBulkLabel(''); setBulkGame(''); setShowBulk(false);
    } catch (err: unknown) {
      flash('error', err instanceof Error ? err.message : t('codes.bulkError'));
    } finally {
      setBulkCreating(false);
    }
  }, [bulkCount, bulkLabel, bulkGame, t, flash]);

  const handleRevoke = useCallback(async (code: string, del: boolean) => {
    setBusyCode(code);
    setArmed(null);
    try {
      await revokeCodeFn({ code, delete: del });
      flash('notice', del ? t('codes.deleted', { code }) : t('codes.revoked', { code }));
    } catch (err: unknown) {
      flash('error', err instanceof Error ? err.message : t('codes.revokeError'));
    } finally {
      setBusyCode(null);
    }
  }, [t, flash]);

  const FILTERS: FilterKey[] = ['all', 'unused', 'used', 'revoked'];

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('codes.title')}</h1>
          <p className="text-zinc-500 text-sm">
            {loading ? t('common.loading') : t('codes.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowAdd((v) => !v); setShowBulk(false); }}
            className="px-3 py-1.5 text-sm rounded-xl border border-neon-green/40 text-neon-green hover:bg-neon-green/10 transition-all backdrop-blur-sm"
          >
            {showAdd ? t('codes.cancel') : `+ ${t('codes.createOne')}`}
          </button>
          <button
            onClick={() => { setShowBulk((v) => !v); setShowAdd(false); }}
            className="px-3 py-1.5 text-sm rounded-xl border border-neon-blue/40 text-neon-blue hover:bg-neon-blue/10 transition-all backdrop-blur-sm"
          >
            {showBulk ? t('codes.cancel') : t('codes.createBulk')}
          </button>
          <button
            onClick={() => window.print()}
            disabled={visible.length === 0}
            className="px-3 py-1.5 text-sm rounded-xl border border-glass-border text-zinc-300 hover:text-white hover:bg-white/5 disabled:opacity-40 transition-all backdrop-blur-sm"
          >
            {t('codes.printSheet')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 rounded-2xl border border-neon-green/30 bg-neon-green/5 backdrop-blur-sm">
          <p className="text-xs text-zinc-400 mb-3">{t('codes.createOneHint')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('codes.fieldCode')}</label>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder={t('codes.fieldCodePlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm font-mono focus:border-neon-green/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('codes.fieldLabel')}</label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('codes.fieldLabelPlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm focus:border-neon-green/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('codes.fieldGame')}</label>
              <input
                value={newGame}
                onChange={(e) => setNewGame(e.target.value)}
                placeholder={t('codes.fieldGamePlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm focus:border-neon-green/50 outline-none"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="px-4 py-2 text-sm rounded-xl bg-neon-green/10 border border-neon-green/40 text-neon-green hover:bg-neon-green/20 disabled:opacity-40 transition-all"
            >
              {creating ? t('codes.creating') : t('codes.createOneBtn')}
            </button>
          </div>
        </div>
      )}

      {showBulk && (
        <div className="mb-4 p-4 rounded-2xl border border-neon-blue/30 bg-neon-blue/5 backdrop-blur-sm">
          <p className="text-xs text-zinc-400 mb-3">{t('codes.createBulkHint')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('codes.fieldCount')}</label>
              <input
                type="number"
                min={1}
                max={200}
                value={bulkCount}
                onChange={(e) => setBulkCount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm font-mono focus:border-neon-blue/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('codes.fieldGame')}</label>
              <input
                value={bulkGame}
                onChange={(e) => setBulkGame(e.target.value)}
                placeholder={t('codes.fieldGamePlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm focus:border-neon-blue/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('codes.fieldLabel')}</label>
              <input
                value={bulkLabel}
                onChange={(e) => setBulkLabel(e.target.value)}
                placeholder={t('codes.fieldLabelPlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-app-surface border border-glass-border text-white text-sm focus:border-neon-blue/50 outline-none"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void handleBulk()}
              disabled={bulkCreating}
              className="px-4 py-2 text-sm rounded-xl bg-neon-blue/10 border border-neon-blue/40 text-neon-blue hover:bg-neon-blue/20 disabled:opacity-40 transition-all"
            >
              {bulkCreating ? t('codes.creating') : t('codes.createBulkBtn')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-950/50 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-neon-green/5 border border-neon-green/30 text-neon-green text-sm">
          {notice}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        {FILTERS.map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-xl border transition-all ${
              filter === key
                ? 'bg-white/10 border-glass-border text-white'
                : 'border-glass-border text-zinc-500 hover:text-white hover:bg-white/5'
            }`}
          >
            {t(`codes.filter.${key}`)}{' '}
            <span className="tabular-nums text-zinc-500">({counts[key]})</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-glass-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-zinc-500 text-xs uppercase tracking-widest">
            <tr>
              <th className="text-start px-4 py-3">{t('codes.colCode')}</th>
              <th className="text-start px-4 py-3">{t('codes.colGame')}</th>
              <th className="text-start px-4 py-3">{t('codes.colStatus')}</th>
              <th className="text-start px-4 py-3">{t('codes.colTeam')}</th>
              <th className="text-start px-4 py-3">{t('codes.colCreated')}</th>
              <th className="text-start px-4 py-3">{t('codes.colUsed')}</th>
              <th className="text-end px-4 py-3">{t('codes.colAction')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && codes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-600">
                  {t('common.loading')}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-600">
                  {t('codes.empty')}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const used = row.status === 'used';
                const isBusy = busyCode === row.code;
                const armedRevoke = armed?.code === row.code && armed.action === 'revoke';
                const armedDelete = armed?.code === row.code && armed.action === 'delete';
                return (
                  <tr key={row.code} className="bg-app-card hover:bg-app-raised transition-colors border-b border-glass-border">
                    <td className="px-4 py-3 font-mono text-white font-semibold">{row.code}</td>
                    <td className="px-4 py-3 text-zinc-400">{row.gameId ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[row.status]}`}>
                        {t(`codes.status.${row.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-400">{shortTeam(row.assignedTeamId)}</td>
                    <td className="px-4 py-3 text-zinc-500 tabular-nums">{fmtTime(row.createdAt)}</td>
                    <td className="px-4 py-3 text-zinc-500 tabular-nums">{fmtTime(row.usedAt)}</td>
                    <td className="px-4 py-3 text-end">
                      {used ? (
                        <span className="text-xs text-zinc-600">{t('codes.lockedUsed')}</span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() =>
                              armedRevoke ? void handleRevoke(row.code, false) : setArmed({ code: row.code, action: 'revoke' })
                            }
                            onBlur={() => armedRevoke && setArmed(null)}
                            disabled={isBusy}
                            className={`px-3 py-1 text-xs border rounded-lg transition-all disabled:opacity-40 ${
                              armedRevoke
                                ? 'bg-neon-orange/10 border-neon-orange/30 text-neon-orange hover:bg-neon-orange/20'
                                : 'border-glass-border text-zinc-500 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {isBusy && armed === null
                              ? t('codes.working')
                              : armedRevoke
                                ? t('codes.confirmRevoke')
                                : t('codes.revoke')}
                          </button>
                          <button
                            onClick={() =>
                              armedDelete ? void handleRevoke(row.code, true) : setArmed({ code: row.code, action: 'delete' })
                            }
                            onBlur={() => armedDelete && setArmed(null)}
                            disabled={isBusy}
                            className={`px-3 py-1 text-xs border rounded-lg transition-all disabled:opacity-40 ${
                              armedDelete
                                ? 'bg-red-500/15 border-red-500/40 text-red-300 hover:bg-red-500/25'
                                : 'border-glass-border text-zinc-500 hover:text-red-300 hover:border-red-500/30'
                            }`}
                          >
                            {armedDelete ? t('codes.confirmDelete') : t('codes.delete')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Print-only QR sheet — renders the currently-filtered codes. Hidden on
          screen via .print-sheet; the @media print rules in index.css hide the
          app chrome and reveal only this high-contrast grid. */}
      <div className="print-sheet">
        <div className="print-sheet-header">
          <h2>{t('codes.printHeading')}</h2>
          <span>{t(`codes.filter.${filter}`)} · {visible.length}</span>
        </div>
        <div className="print-grid">
          {visible.map((row) => {
            const meta = [row.label, row.gameId].filter(Boolean).join(' · ');
            return (
              <div key={row.code} className="print-cell">
                <QRCodeSVG value={row.code} size={120} level="M" />
                <div className="print-code">{row.code}</div>
                {meta && <div className="print-meta">{meta}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
