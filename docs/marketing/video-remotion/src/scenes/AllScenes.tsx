import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Sequence } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../lib/theme';
import { DarkBackground, WarmBackground } from '../ui/Background';
import { KineticLine, Eyebrow, CaptionStack } from '../ui/Kinetic';
import { Lockup, LogoMark, Wordmark } from '../ui/Logo';
import { PhoneFrame } from '../ui/Phone';
import { BrowserChrome } from '../ui/mocks/Browser';
import { BuilderMock } from '../ui/mocks/BuilderMock';
import { JoinScreen } from '../ui/mocks/JoinScreen';
import { PlayMapScreen } from '../ui/mocks/PlayMapScreen';
import { LeaderboardPanel } from '../ui/mocks/LeaderboardPanel';
import { FinalScreen } from '../ui/mocks/FinalScreen';
import { Confetti } from '../ui/Confetti';

const center: React.CSSProperties = { justifyContent: 'center', alignItems: 'center' };

// Floating "old way" chip
const OldChip: React.FC<{ icon: string; label: string; x: number; y: number; delay: number; rot: number }> = ({ icon, label, x, y, delay, rot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  const drift = Math.sin((frame + delay) / 22) * 8;
  return (
    <div
      dir="rtl"
      style={{
        position: 'absolute',
        left: x,
        top: y + drift,
        transform: `rotate(${rot}deg) scale(${s})`,
        opacity: s * 0.9,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '16px 24px',
        borderRadius: 16,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        filter: 'grayscale(0.5)',
      }}
    >
      <span style={{ fontSize: 40 }}>{icon}</span>
      <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 26, color: C.ink2 }}>{label}</span>
    </div>
  );
};

// ── S1 HOOK ────────────────────────────────────────────────────────────────
export const S1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const redPulse = interpolate(Math.sin(frame / 8), [-1, 1], [0.05, 0.14]);
  return (
    <DarkBackground>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 50% 50%, rgba(239,68,68,${redPulse}) 0%, transparent 70%)` }} />
      <OldChip icon="📋" label="רשימה על נייר" x={180} y={210} delay={4} rot={-7} />
      <OldChip icon="🗺️" label="מפה מודפסת" x={1360} y={250} delay={10} rot={6} />
      <OldChip icon="⏱️" label="שיפוט ידני" x={220} y={760} delay={16} rot={5} />
      <OldChip icon="📟" label="ווקי-טוקי" x={1380} y={740} delay={22} rot={-6} />
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 20 }}>
        <Eyebrow text="הדרך הישנה" startAt={0} color={C.alert} />
        <KineticLine text="עדיין מנהלים אירוע עם *דף ועט?*" startAt={3} size={104} align="center" />
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S2 PROBLEM ───────────────────────────────────────────────────────────────
export const S2Problem: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <DarkBackground>
      {/* scattered fragments */}
      <OldChip icon="😰" label="קבוצה שהלכה לאיבוד" x={150} y={200} delay={0} rot={-6} />
      <OldChip icon="🧮" label="חישוב ניקוד ידני" x={1330} y={220} delay={6} rot={5} />
      <OldChip icon="📝" label="דף תשובות" x={1360} y={780} delay={14} rot={-4} />
      <OldChip icon="🤷" label="מי ניצח בעצם?" x={170} y={800} delay={20} rot={6} />
      <AbsoluteFill style={{ ...center, flexDirection: 'column' }}>
        <CaptionStack
          size={78}
          items={[
            { text: 'ניקוד ידני. קבוצות אבודות.', at: 8, dur: 58 },
            { text: 'שעות הכנה. שיפוט סובייקטיבי.', at: 74, dur: 62 },
          ]}
        />
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S3 REVEAL ────────────────────────────────────────────────────────────────
export const S3Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoS = spring({ frame, fps, config: { damping: 12, stiffness: 110 } });
  const spin = interpolate(frame, [0, 60], [-180, 0], { extrapolateRight: 'clamp' });
  const ring = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 36 }}>
        <div style={{ transform: `scale(${logoS})`, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: -60, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,87,34,0.35) 0%, transparent 70%)', opacity: ring, filter: 'blur(20px)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, direction: 'ltr' }}>
            <LogoMark size={130} spin={spin} />
            <Wordmark size={80} />
          </div>
        </div>
        <div style={{ width: '100%', opacity: interpolate(frame, [40, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <KineticLine text="בונים *משחק שדה* — תוך דקות." startAt={44} size={58} weight={800} color={C.ink1} />
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S4 BUILD ─────────────────────────────────────────────────────────────────
export const S4Build: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18 } });
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center }}>
        <div style={{ transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px) scale(${interpolate(enter, [0, 1], [0.92, 1])})`, opacity: enter }}>
          <BrowserChrome url="rushpoint.app/build" width={1560} height={840}>
            <BuilderMock />
          </BrowserChrome>
        </div>
      </AbsoluteFill>
      {/* caption lower band */}
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 40 }}>
        <div style={{ padding: '10px 40px', borderRadius: 18, background: 'rgba(7,8,15,0.72)', border: `1px solid ${C.border}`, backdropFilter: 'blur(8px)' }}>
          <CaptionStack
            size={46}
            width={1080}
            items={[
              { text: 'מוסיפים שלבים.', at: 10, dur: 100 },
              { text: 'משבצים משימות על המפה.', at: 116, dur: 96 },
              { text: 'תמונות · חידונים · קודים סודיים · סריקות', at: 218, dur: 138 },
            ]}
          />
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S5 LAUNCH + JOIN ───────────────────────────────────────────────────────
export const S5Launch: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // code card appears then phone joins
  const codeS = spring({ frame: frame - 6, fps, config: { damping: 13 } });
  const phoneS = spring({ frame: frame - 40, fps, config: { damping: 16 } });
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, gap: 90, flexDirection: 'row' }}>
        {/* code card */}
        <div style={{ transform: `scale(${codeS})`, opacity: codeS, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          <div dir="rtl" style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 28, color: C.ink2 }}>קוד הצטרפות</div>
          <div style={{ padding: '30px 56px', borderRadius: 26, background: FIRE_GRAD, boxShadow: '0 26px 70px -20px rgba(255,87,34,0.7)' }}>
            <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 96, color: '#fff', letterSpacing: 8 }}>RUSH42</span>
          </div>
          <div dir="rtl" style={{ fontFamily: FONT.body, fontSize: 22, color: C.ink3 }}>שתפו בוואטסאפ · QR · קישור</div>
        </div>
        {/* phone joining */}
        <div style={{ transform: `scale(${interpolate(phoneS, [0, 1], [0.7, 0.62])})`, opacity: phoneS }}>
          <PhoneFrame>
            <JoinScreen />
          </PhoneFrame>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 60 }}>
        <CaptionStack
          size={54}
          items={[
            { text: 'משתפים קוד אחד.', at: 6, dur: 70 },
            { text: 'הקבוצות מצטרפות מיד.', at: 84, dur: 90 },
          ]}
        />
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S6 PLAY ──────────────────────────────────────────────────────────────────
export const S6Play: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phoneS = spring({ frame, fps, config: { damping: 16 } });
  // phone slides left, leaderboard slides in from right around frame 180
  const split = interpolate(frame, [170, 210], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const phoneX = interpolate(split, [0, 1], [0, -430]);
  const boardX = interpolate(split, [0, 1], [700, 0]);
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center }}>
        <div style={{ transform: `translateX(${phoneX}px) scale(${interpolate(phoneS, [0, 1], [0.7, 0.66])})`, opacity: phoneS }}>
          <PhoneFrame>
            <PlayMapScreen />
          </PhoneFrame>
        </div>
      </AbsoluteFill>
      {/* leaderboard panel enters */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 980, transform: `translateX(${boardX}px)`, opacity: split }}>
          <LeaderboardPanel width={780} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 44 }}>
        <CaptionStack
          size={50}
          items={[
            { text: 'GPS מנתב כל קבוצה.', at: 10, dur: 66 },
            { text: 'מצלמים תמונה. סורקים. עונים.', at: 82, dur: 82 },
            { text: 'צופים בטבלה משתנה — בשידור חי.', at: 208, dur: 205 },
          ]}
        />
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S7 PROOF (no judges) ─────────────────────────────────────────────────────
export const S7Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b1 = spring({ frame: frame - 6, fps, config: { damping: 14 } });
  const b2 = spring({ frame: frame - 18, fps, config: { damping: 14 } });
  const gear = interpolate(frame, [0, 300], [0, 360]);
  const line2 = interpolate(frame, [150, 175], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 40 }}>
        {/* struck-through old chips */}
        <div style={{ display: 'flex', gap: 34 }}>
          {[
            { i: '⏱️', l: 'סטופר', d: 6 },
            { i: '🧑‍⚖️', l: 'שופטים', d: 16 },
            { i: '🧮', l: 'חישובים', d: 26 },
          ].map((c, k) => {
            const s = spring({ frame: frame - c.d, fps, config: { damping: 13 } });
            return (
              <div key={k} dir="rtl" style={{ position: 'relative', transform: `scale(${s})`, opacity: s, display: 'flex', alignItems: 'center', gap: 12, padding: '18px 30px', borderRadius: 18, background: C.bg2, border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 40, filter: 'grayscale(1)', opacity: 0.6 }}>{c.i}</span>
                <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 30, color: C.ink3, textDecoration: 'line-through' }}>{c.l}</span>
              </div>
            );
          })}
        </div>
        <KineticLine text="בלי סטופר. *בלי שופטים.*" startAt={4} size={92} />
        <div dir="rtl" style={{ opacity: line2, transform: `scale(${interpolate(line2, [0, 1], [0.9, 1])})`, display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ fontSize: 56, transform: `rotate(${gear}deg)` }}>⚙️</div>
          <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 58, color: C.go }}>ניקוד אוטומטי. בכל פעם.</span>
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S8 AUDIENCE ──────────────────────────────────────────────────────────────
const AUD = [
  { icon: '🎒', label: 'תנועות נוער' },
  { icon: '🏢', label: 'גיבוש לחברות' },
  { icon: '🎉', label: 'בר וברת מצווה' },
  { icon: '📍', label: 'כל אירוע, בכל מקום' },
];
export const S8Audience: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 30 }}>
        <Eyebrow text="מושלם עבור" startAt={2} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26 }}>
          {AUD.map((a, i) => {
            const s = spring({ frame: frame - 10 - i * 12, fps, config: { damping: 13, stiffness: 120 } });
            return (
              <div
                key={i}
                dir="rtl"
                style={{
                  transform: `scale(${s}) translateY(${interpolate(s, [0, 1], [30, 0])}px)`,
                  opacity: s,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 22,
                  padding: '30px 46px',
                  width: 620,
                  borderRadius: 22,
                  background: C.bg2,
                  border: `1px solid ${C.border}`,
                  boxShadow: '0 18px 44px -18px rgba(0,0,0,0.6)',
                }}
              >
                <div style={{ width: 76, height: 76, borderRadius: 18, background: FIRE_GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>{a.icon}</div>
                <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 40, color: C.ink1 }}>{a.label}</span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S9 CTA ───────────────────────────────────────────────────────────────────
export const S9CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoS = spring({ frame: frame - 4, fps, config: { damping: 12 } });
  const line = spring({ frame: frame - 30, fps, config: { damping: 15 } });
  const btn = spring({ frame: frame - 60, fps, config: { damping: 12, stiffness: 120 } });
  const url = spring({ frame: frame - 84, fps, config: { damping: 16 } });
  const glow = interpolate(Math.sin(frame / 10), [-1, 1], [0.4, 0.8]);
  return (
    <DarkBackground>
      <Confetti count={70} startAt={2} />
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 34 }}>
        <div style={{ transform: `scale(${logoS})`, display: 'flex', alignItems: 'center', gap: 22, direction: 'ltr' }}>
          <LogoMark size={110} />
          <Wordmark size={72} />
        </div>
        <div dir="rtl" style={{ opacity: line, transform: `translateY(${interpolate(line, [0, 1], [24, 0])}px)`, fontFamily: FONT.display, fontWeight: 900, fontSize: 74, color: C.ink1, textAlign: 'center' }}>
          בנו את משחק השדה
          <br />
          הראשון שלכם — <span style={{ color: C.fire }}>חינם</span>
        </div>
        <div dir="rtl" style={{ opacity: line, fontFamily: FONT.body, fontWeight: 600, fontSize: 30, color: C.ink2 }}>המשחק יוצא החוצה.</div>
        <div
          style={{
            transform: `scale(${btn})`,
            marginTop: 10,
            padding: '24px 60px',
            borderRadius: 20,
            background: FIRE_GRAD,
            boxShadow: `0 20px ${40 + glow * 30}px -12px rgba(255,87,34,${glow})`,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 44, color: '#fff', letterSpacing: 1 }}>rushpoint.app</span>
          <span style={{ fontSize: 40, opacity: url }}>→</span>
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};
