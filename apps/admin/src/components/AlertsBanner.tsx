import React, { useEffect, useRef, useState } from 'react';
import { onSnapshot, collection } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';

// ─── Alert document ───────────────────────────────────────────────────────────
interface AlertDoc {
  id: string;
  type: string;
  kind?: 'emergency' | 'technical';
  teamName?: string;
  memberNames?: string[];
  captainPhone?: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  location?: { lat: number; lng: number };
}

// ─── Sound (Web Audio) ────────────────────────────────────────────────────────
// Emergency = loud repeating two-tone siren. Technical = one soft chime.
// A single shared AudioContext, resumed on first use (browsers gate autoplay).
let audioCtx: AudioContext | null = null;
function ctx(): AudioContext | null {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const Ctor = AC.AudioContext ?? AC.webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(c: AudioContext, freq: number, startAt: number, dur: number, gain: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur);
}

function playAlert(kind: 'emergency' | 'technical') {
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime;
  if (kind === 'emergency') {
    // Six urgent high/low beeps.
    for (let i = 0; i < 6; i++) {
      beep(c, i % 2 === 0 ? 880 : 620, t0 + i * 0.22, 0.18, 0.25);
    }
  } else {
    // One gentle chime.
    beep(c, 520, t0, 0.25, 0.12);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AlertsBanner — live SOS / "call staff" feed, shared across staff dashboards.
// Plays a sound when a NEW alert arrives (loud for emergency, soft for technical),
// shows team roster + captain phone + location, and lets staff acknowledge.
// ═══════════════════════════════════════════════════════════════════════════════
export default function AlertsBanner() {
  const { t } = useI18n();
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  // Track which alert ids we've already chimed for, so re-renders don't re-play.
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        collection(db, `artifacts/${APP_ID}/public/data/adminAlerts`),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as AlertDoc)
            .filter((a) => !a.acknowledged)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          // On first snapshot just record what's already there (don't blast a
          // siren for a backlog); after that, chime on each genuinely new alert.
          if (!primed.current) {
            list.forEach((a) => seen.current.add(a.id));
            primed.current = true;
          } else {
            for (const a of list) {
              if (!seen.current.has(a.id)) {
                seen.current.add(a.id);
                if (!muted) playAlert(a.kind ?? 'emergency');
              }
            }
          }
          setAlerts(list);
        },
        () => setAlerts([]),
      );
    });
    return () => unsub?.();
  }, [muted]);

  async function handleAck(alertId: string) {
    setAckingId(alertId);
    try {
      await ensureAuth();
      await httpsCallable(functions, 'acknowledgeAlert')({ alertId });
    } catch (e) {
      console.error('[alerts] acknowledgeAlert failed:', e);
    } finally {
      setAckingId(null);
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          {t('alerts.live', { n: alerts.length })}
        </p>
        <button
          onClick={() => setMuted((m) => !m)}
          className="text-xs text-zinc-500 hover:text-white px-2 py-1 rounded-lg border border-glass-border"
        >
          {muted ? t('alerts.unmute') : t('alerts.mute')}
        </button>
      </div>
      {alerts.map((a) => {
        const emergency = (a.kind ?? 'emergency') === 'emergency';
        const tone = emergency
          ? 'bg-neon-red/10 border-neon-red/50 text-neon-red'
          : 'bg-neon-orange/10 border-neon-orange/40 text-neon-orange';
        return (
          <div
            key={a.id}
            className={`flex items-start justify-between gap-4 rounded-2xl border px-5 py-4 ${tone} ${emergency ? 'animate-pulse' : ''}`}
            style={emergency ? { animationDuration: '2s' } : undefined}
          >
            <div className="flex items-start gap-3 min-w-0">
              <span className="text-2xl">{emergency ? '🆘' : '🛠️'}</span>
              <div className="min-w-0">
                <p className="font-bold">
                  {a.teamName ?? t('alerts.unknownTeam')}
                  <span className="ms-2 text-xs font-mono uppercase opacity-70">
                    {emergency ? t('alerts.emergency') : t('alerts.technical')}
                  </span>
                </p>
                <p className="text-sm text-zinc-300">{a.message}</p>
                {a.memberNames && a.memberNames.length > 0 && (
                  <p className="text-xs text-zinc-400 mt-1">
                    👥 {a.memberNames.join(', ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  {a.captainPhone && (
                    <a href={`tel:${a.captainPhone}`} className="text-xs text-neon-blue hover:underline font-mono">
                      📞 {a.captainPhone}
                    </a>
                  )}
                  {a.location && (
                    <a
                      href={`https://maps.google.com/?q=${a.location.lat},${a.location.lng}`}
                      target="_blank" rel="noreferrer"
                      className="text-xs text-neon-blue hover:underline font-mono"
                    >
                      📍 {a.location.lat.toFixed(5)}, {a.location.lng.toFixed(5)}
                    </a>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => void handleAck(a.id)}
              disabled={ackingId === a.id}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-40 transition-all whitespace-nowrap ${tone} hover:bg-white/5`}
            >
              {ackingId === a.id ? t('alerts.acking') : t('alerts.ack')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
