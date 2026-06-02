import React, { useCallback, useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { TeamSummary as TeamRow } from '@rushpoint/shared';
import { db, ensureAuth, APP_ID } from '../services/firebase';
import { callable } from '../services/api';
import { useI18n } from '../i18n';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Station {
  id: string;
  title: string;
  type?: string;
  status?: 'active' | 'paused' | 'closed';
  currentTeamCount?: number;
  maxConcurrentTeams?: number;
}
interface Announcement {
  id: string;
  message: string;
  messageHe?: string;
  level: 'info' | 'warning' | 'critical';
}
interface AuditLog {
  id: string;
  timestamp: string;
  teamId: string;
  teamName?: string;
  actionType: string;
  previousValue?: number | string | null;
  newValue?: number | string | null;
  reason?: string;
}
const setStationStatus  = callable<{ taskId: string; status: 'active' | 'paused' | 'closed' }>('setStationStatus');
const evacuateStation   = callable<{ taskId: string }, { evacuatedCount: number }>('evacuateStation');
const pushAnnouncement  = callable<{ message: string; messageHe?: string; level: string }>('pushAnnouncement');
const deactivateAnn     = callable<{ id: string }>('deactivateAnnouncement');
const listAuditLogs     = callable<Record<string, never>, { logs: AuditLog[] }>('listAuditLogs');
const listTeams         = callable<Record<string, never>, { teams: TeamRow[] }>('listTeams');
const adjustTeamScore   = callable<
  { teamId: string; kind: string; delta?: number; setTo?: number; reason: string },
  { previousScore: number; newScore: number }
>('adjustTeamScore');

// ═══════════════════════════════════════════════════════════════════════════════
export default function ManagerPage() {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const flash = (msg: string) => { setError(msg); window.setTimeout(() => setError(''), 4000); };

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-10">
      <div>
        <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('mgr.title')}</h1>
        <p className="text-zinc-500 text-sm">{t('mgr.subtitle')}</p>
      </div>
      {error && (
        <div className="rounded-xl bg-red-950/50 border border-red-500/30 px-4 py-3 text-red-300 text-sm">{error}</div>
      )}
      <StationsPanel onError={flash} />
      <BroadcastPanel onError={flash} />
      <AuditPanel onError={flash} />
    </div>
  );
}

// ─── Stations ──────────────────────────────────────────────────────────────────
function StationsPanel({ onError }: { onError: (m: string) => void }) {
  const { t } = useI18n();
  const [stations, setStations] = useState<Station[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [armedEvac, setArmedEvac] = useState<string | null>(null);

  useEffect(() => {
    let unsub = () => {};
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        collection(db, `artifacts/${APP_ID}/public/data/tasks`),
        (snap) => setStations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Station, 'id'>) }))
          .sort((a, b) => a.id.localeCompare(b.id))),
        () => onError(t('mgr.loadError')),
      );
    });
    return () => unsub();
  }, [t, onError]);

  async function setStatus(taskId: string, status: 'active' | 'paused' | 'closed') {
    setBusy(taskId);
    try { await setStationStatus({ taskId, status }); }
    catch { onError(t('mgr.actionError')); }
    finally { setBusy(null); }
  }

  // Two-click arm so a destructive evacuation isn't a single misclick.
  async function evacuate(taskId: string) {
    if (armedEvac !== taskId) { setArmedEvac(taskId); return; }
    setArmedEvac(null);
    setBusy(taskId);
    try {
      const { evacuatedCount } = await evacuateStation({ taskId });
      onError(t('mgr.evacuated', { n: evacuatedCount, station: taskId }));
    } catch { onError(t('mgr.actionError')); }
    finally { setBusy(null); }
  }

  const STATUS_KEYS = [
    { v: 'active' as const, label: 'mgr.statusActive', cls: 'text-neon-green border-neon-green/40 bg-neon-green/10' },
    { v: 'paused' as const, label: 'mgr.statusPaused', cls: 'text-neon-gold border-neon-gold/40 bg-neon-gold/10' },
    { v: 'closed' as const, label: 'mgr.statusClosed', cls: 'text-neon-red border-neon-red/40 bg-neon-red/10' },
  ];

  return (
    <Section title={t('mgr.stations')} hint={t('mgr.stationsHint')}>
      <div className="space-y-2">
        {stations.map((s) => {
          const status = s.status ?? 'active';
          return (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl bg-app-card border border-glass-border px-4 py-3">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{s.title || s.id}</p>
                <p className="text-zinc-500 text-xs">{s.type} · {s.currentTeamCount ?? 0}/{s.maxConcurrentTeams ?? 3}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {STATUS_KEYS.map(({ v, label, cls }) => (
                  <button
                    key={v}
                    disabled={busy === s.id}
                    onClick={() => void setStatus(s.id, v)}
                    className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all disabled:opacity-50 ${
                      status === v ? cls : 'text-zinc-500 border-glass-border hover:text-white'
                    }`}
                  >{t(label)}</button>
                ))}
                <button
                  disabled={busy === s.id}
                  onClick={() => void evacuate(s.id)}
                  onBlur={() => armedEvac === s.id && setArmedEvac(null)}
                  className={`ms-1 px-2.5 py-1 rounded-lg border text-xs font-semibold disabled:opacity-50 ${
                    armedEvac === s.id
                      ? 'border-neon-red bg-neon-red/20 text-neon-red'
                      : 'border-neon-red/40 text-neon-red hover:bg-neon-red/10'
                  }`}
                >{armedEvac === s.id ? t('mgr.evacuateConfirm') : t('mgr.evacuate')}</button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Broadcast ───────────────────────────────────────────────────────────────
function BroadcastPanel({ onError }: { onError: (m: string) => void }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState('');
  const [msgHe, setMsgHe] = useState('');
  const [level, setLevel] = useState<'info' | 'warning' | 'critical'>('info');
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState<Announcement[]>([]);

  useEffect(() => {
    let unsub = () => {};
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        query(collection(db, `artifacts/${APP_ID}/public/data/announcements`), where('active', '==', true)),
        (snap) => setActive(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Announcement, 'id'>) }))),
        () => onError(t('mgr.loadError')),
      );
    });
    return () => unsub();
  }, [t, onError]);

  async function send() {
    if (!msg.trim()) return;
    setSending(true);
    try {
      await pushAnnouncement({ message: msg.trim(), messageHe: msgHe.trim() || undefined, level });
      setMsg(''); setMsgHe('');
    } catch { onError(t('mgr.actionError')); }
    finally { setSending(false); }
  }

  async function deactivate(id: string) {
    try { await deactivateAnn({ id }); }
    catch { onError(t('mgr.actionError')); }
  }

  return (
    <Section title={t('mgr.broadcast')} hint={t('mgr.broadcastHint')}>
      <div className="space-y-3">
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('mgr.msgEn')}
          className="w-full px-4 py-2.5 rounded-xl bg-app-card border border-glass-border text-white placeholder-zinc-600 focus:outline-none focus:border-neon-green/40 text-sm" />
        <input value={msgHe} onChange={(e) => setMsgHe(e.target.value)} placeholder={t('mgr.msgHe')} dir="rtl"
          className="w-full px-4 py-2.5 rounded-xl bg-app-card border border-glass-border text-white placeholder-zinc-600 focus:outline-none focus:border-neon-green/40 text-sm" />
        <div className="flex items-center gap-3">
          <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}
            className="px-3 py-2 rounded-xl bg-app-card border border-glass-border text-white text-sm">
            <option value="info">{t('mgr.levelInfo')}</option>
            <option value="warning">{t('mgr.levelWarning')}</option>
            <option value="critical">{t('mgr.levelCritical')}</option>
          </select>
          <button onClick={() => void send()} disabled={sending || !msg.trim()}
            className="px-4 py-2 rounded-xl bg-neon-green text-black font-bold text-sm hover:opacity-90 disabled:opacity-50">
            {t('mgr.send')}
          </button>
        </div>
      </div>

      <p className="text-zinc-400 text-xs mt-5 mb-2">{t('mgr.activeAnnouncements')}</p>
      {active.length === 0 ? (
        <p className="text-zinc-600 text-sm">{t('mgr.noAnnouncements')}</p>
      ) : (
        <div className="space-y-2">
          {active.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-app-card border border-glass-border px-4 py-2.5">
              <span className="text-sm text-zinc-200 truncate">[{a.level}] {a.message}</span>
              <button onClick={() => void deactivate(a.id)}
                className="shrink-0 px-2.5 py-1 rounded-lg border border-glass-border text-zinc-400 text-xs hover:text-white">
                {t('mgr.deactivate')}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Audit log + score adjustment ──────────────────────────────────────────────
function AuditPanel({ onError }: { onError: (m: string) => void }) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamId, setTeamId] = useState('');
  const [kind, setKind] = useState<'fine' | 'score_override'>('fine');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [logRes, teamRes] = await Promise.all([listAuditLogs({}), listTeams({})]);
      setLogs(logRes.logs ?? []);
      setTeams(teamRes.teams ?? []);
    } catch { onError(t('mgr.loadError')); }
  }, [t, onError]);

  useEffect(() => { void load(); }, [load]);

  async function apply() {
    if (!teamId) return;
    setBusy(true);
    try {
      const payload = kind === 'fine'
        ? { teamId, kind, delta: Number(value) || 0, reason: reason.trim() }
        : { teamId, kind, setTo: Number(value) || 0, reason: reason.trim() };
      const { previousScore, newScore } = await adjustTeamScore(payload);
      onError(t('mgr.adjustDone', { prev: previousScore, next: newScore }));
      setValue(''); setReason('');
      await load();
    } catch { onError(t('mgr.actionError')); }
    finally { setBusy(false); }
  }

  return (
    <Section title={t('mgr.audit')} hint={t('mgr.auditHint')}>
      {/* Adjust-score form */}
      <div className="rounded-xl bg-app-card border border-glass-border p-4 mb-5">
        <p className="text-white text-sm font-medium mb-1">{t('mgr.adjust')}</p>
        <p className="text-zinc-500 text-xs mb-3">{t('mgr.adjustHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
            className="px-3 py-2 rounded-xl bg-app-surface border border-glass-border text-white text-sm">
            <option value="">{t('mgr.team')}…</option>
            {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name} ({tm.score})</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
            className="px-3 py-2 rounded-xl bg-app-surface border border-glass-border text-white text-sm">
            <option value="fine">{t('mgr.fine')}</option>
            <option value="score_override">{t('mgr.override')}</option>
          </select>
          <input value={value} onChange={(e) => setValue(e.target.value)} type="number" placeholder="0"
            className="w-24 px-3 py-2 rounded-xl bg-app-surface border border-glass-border text-white text-sm" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('mgr.colReason')}
            className="flex-1 min-w-[8rem] px-3 py-2 rounded-xl bg-app-surface border border-glass-border text-white text-sm" />
          <button onClick={() => void apply()} disabled={busy || !teamId}
            className="px-4 py-2 rounded-xl bg-neon-green text-black font-bold text-sm hover:opacity-90 disabled:opacity-50">
            {t('mgr.apply')}
          </button>
        </div>
      </div>

      {/* Terminal-style audit feed — a cascading mono log (premium amber prompt) */}
      {logs.length === 0 ? (
        <p className="text-zinc-600 text-sm">{t('mgr.auditEmpty')}</p>
      ) : (
        <div className="rounded-xl border border-glass-border bg-black/40 p-4 font-mono text-xs leading-relaxed max-h-80 overflow-y-auto shadow-inner">
          {logs.map((l) => {
            const hasChange = l.previousValue != null || l.newValue != null;
            return (
              <div key={l.id} className="flex flex-wrap items-baseline gap-x-2 py-1 border-b border-white/5 last:border-0">
                <span className="text-zinc-600">{new Date(l.timestamp).toLocaleTimeString()}</span>
                <span className="text-neon-gold">›</span>
                <span className="text-neon-green font-semibold uppercase">{l.actionType}</span>
                <span className="text-neon-cyan">{l.teamName ?? l.teamId.slice(0, 6)}</span>
                {hasChange && (
                  <span className="text-zinc-300">{l.previousValue ?? '—'} → {l.newValue ?? '—'}</span>
                )}
                {l.reason && <span className="text-zinc-500 flex-1 min-w-0">— {l.reason}</span>}
              </div>
            );
          })}
          {/* blinking terminal cursor */}
          <div className="text-neon-green mt-1">_<span className="animate-pulse-neon">█</span></div>
        </div>
      )}
    </Section>
  );
}

// ─── Shared section wrapper ─────────────────────────────────────────────────────
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-white font-semibold text-lg">{title}</h2>
      {hint && <p className="text-zinc-500 text-sm mb-4">{hint}</p>}
      {children}
    </section>
  );
}
