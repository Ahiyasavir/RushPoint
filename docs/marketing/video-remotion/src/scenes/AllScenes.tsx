import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../lib/theme';
import { DarkBackground } from '../ui/Background';
import { KineticLine, Eyebrow, CaptionStack } from '../ui/Kinetic';
import { LogoMark, Wordmark } from '../ui/Logo';
import { PhoneFrame } from '../ui/Phone';
import { BrowserChrome } from '../ui/mocks/Browser';
import { BuilderMock } from '../ui/mocks/BuilderMock';
import { JoinScreen } from '../ui/mocks/JoinScreen';
import { PlayMapScreen } from '../ui/mocks/PlayMapScreen';
import { LeaderboardPanel } from '../ui/mocks/LeaderboardPanel';
import { MapCanvas } from '../ui/mocks/MapCanvas';
import { Confetti } from '../ui/Confetti';

const center: React.CSSProperties = { justifyContent: 'center', alignItems: 'center' };

// Big concept card (emoji tile + title), used by the "imagine" scenes
const ConceptCard: React.FC<{ icon: string; title: string; sub?: string; delay: number; tilt?: number }> = ({ icon, title, sub, delay, tilt = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 110 } });
  const floatY = Math.sin((frame + delay * 3) / 26) * 7;
  return (
    <div
      dir="rtl"
      style={{
        transform: `scale(${s}) translateY(${interpolate(s, [0, 1], [44, 0]) + floatY}px) rotate(${tilt}deg)`,
        opacity: s,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 22,
        padding: '46px 54px',
        width: 440,
        borderRadius: 30,
        background: C.bg2,
        border: `1px solid ${C.border}`,
        boxShadow: '0 30px 70px -24px rgba(0,0,0,0.7)',
      }}
    >
      <div style={{ width: 130, height: 130, borderRadius: 32, background: FIRE_GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 68, boxShadow: '0 18px 44px -14px rgba(255,87,34,0.55)' }}>{icon}</div>
      <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 42, color: C.ink1, textAlign: 'center' }}>{title}</div>
      {sub && <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 24, color: C.ink2, textAlign: 'center' }}>{sub}</div>}
    </div>
  );
};

// ── S1 HOOK (VO: "מה אם האירוע הבא שלכם היה משחק?") — 144f ──────────────────
export const S1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const glow = interpolate(Math.sin(frame / 14), [-1, 1], [0.10, 0.22]);
  return (
    <DarkBackground>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 50% at 50% 46%, rgba(255,87,34,${glow}) 0%, transparent 70%)` }} />
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 26 }}>
        <KineticLine text="מה אם האירוע הבא שלכם" startAt={4} size={104} />
        <KineticLine text="היה *משחק?*" startAt={26} size={128} />
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S2 IMAGINE (VO: "דמיינו. הקבוצות בחוץ, טלפון ביד, ומשימות מחכות בכל פינה") — 228f ──
export const S2Imagine: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const eyebrowS = spring({ frame, fps, config: { damping: 15 } });
  return (
    <DarkBackground>
      {/* faint city map backdrop */}
      <AbsoluteFill style={{ opacity: 0.16 }}>
        <MapCanvas theme="dark" pins={[]} />
      </AbsoluteFill>
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 52 }}>
        <div dir="rtl" style={{ opacity: eyebrowS, transform: `translateY(${interpolate(eyebrowS, [0, 1], [18, 0])}px)`, fontFamily: FONT.display, fontWeight: 900, fontSize: 88, color: C.ink1 }}>
          דמיינו…
        </div>
        <div style={{ display: 'flex', gap: 44 }}>
          <ConceptCard icon="🏃" title="הקבוצות בחוץ" delay={34} tilt={-2} />
          <ConceptCard icon="📱" title="טלפון ביד" delay={62} tilt={0} />
          <ConceptCard icon="📍" title="משימות בכל פינה" delay={92} tilt={2} />
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S3 MISSIONS (VO: "מצלמים, פותרים חידות, מגלים קודים סודיים. והעיר? הופכת למגרש משחקים") — 285f ──
const MISSION_PINS = [
  { p: { x: 200, y: 250 }, kind: 'done' as const },
  { p: { x: 470, y: 200 }, kind: 'active' as const },
  { p: { x: 700, y: 500 }, kind: 'default' as const },
  { p: { x: 330, y: 520 }, kind: 'active' as const },
  { p: { x: 820, y: 300 }, kind: 'done' as const },
];
export const S3Missions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // phase B: the map takes over (~frame 150)
  const mapIn = interpolate(frame, [140, 185], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cardsOut = interpolate(frame, [140, 175], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cityLine = spring({ frame: frame - 185, fps, config: { damping: 14 } });
  const pinPop = (i: number) => spring({ frame: frame - 175 - i * 9, fps, config: { damping: 11, stiffness: 130 } });
  return (
    <DarkBackground>
      {/* phase A — mission type cards */}
      <AbsoluteFill style={{ ...center, gap: 44, opacity: cardsOut, transform: `scale(${interpolate(cardsOut, [0, 1], [0.9, 1])})` }}>
        <ConceptCard icon="📸" title="מצלמים" delay={6} tilt={-2} />
        <ConceptCard icon="❓" title="פותרים חידות" delay={30} tilt={1} />
        <ConceptCard icon="🔑" title="קודים סודיים" delay={56} tilt={-1} />
      </AbsoluteFill>

      {/* phase B — the city becomes the playground */}
      <AbsoluteFill style={{ opacity: mapIn }}>
        <AbsoluteFill style={{ opacity: 0.85 }}>
          <MapCanvas theme="dark" pins={[]} />
        </AbsoluteFill>
        {/* pin pops rendered above map for scale animation */}
        {MISSION_PINS.map((pin, i) => {
          const s = pinPop(i);
          return (
            <div key={i} style={{ position: 'absolute', left: `${(pin.p.x / 960) * 100}%`, top: `${(pin.p.y / 720) * 100}%`, transform: `translate(-50%,-100%) scale(${s})` }}>
              <svg width="58" height="70" viewBox="0 0 52 64">
                <path d="M26 2 C12 2 4 14 4 25 C4 42 26 62 26 62 C26 62 48 42 48 25 C48 14 40 2 26 2 Z" fill={i % 2 ? C.plasma : C.fire} stroke="#fff" strokeWidth="3" />
                <circle cx="26" cy="24" r="9" fill="#fff" />
              </svg>
            </div>
          );
        })}
        <AbsoluteFill style={{ ...center }}>
          <div dir="rtl" style={{ opacity: cityLine, transform: `translateY(${interpolate(cityLine, [0, 1], [30, 0])}px)`, padding: '26px 60px', borderRadius: 24, background: 'rgba(7,8,15,0.78)', border: `1px solid ${C.border}`, backdropFilter: 'blur(10px)', fontFamily: FONT.display, fontWeight: 900, fontSize: 76, color: C.ink1 }}>
            העיר הופכת <span style={{ background: FIRE_GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>למגרש משחקים</span>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S4 FUN (VO: "תחרות אמיתית, צחוק, ואדרנלין. וכל נקודה נספרת, בזמן אמת") — 255f ──
const FLOATERS = ['😂', '🔥', '🏆', '💪', '⚡', '🎉'];
export const S4Fun: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const boardS = spring({ frame: frame - 6, fps, config: { damping: 16 } });
  const capS = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  return (
    <DarkBackground>
      <Confetti count={46} startAt={26} />
      <Confetti count={46} startAt={140} />
      {/* floating reaction emoji */}
      {FLOATERS.map((e, i) => {
        const t = frame - 20 - i * 16;
        if (t < 0) return null;
        const y = 1080 - (t * 4.2) % 1300;
        const x = 140 + ((i * 293) % 1640) + Math.sin((frame + i * 40) / 22) * 26;
        const op = interpolate(y, [-50, 200, 900, 1080], [0, 0.9, 0.9, 0]);
        return <div key={i} style={{ position: 'absolute', left: x, top: y, fontSize: 58, opacity: op }}>{e}</div>;
      })}
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 40 }}>
        <div dir="rtl" style={{ opacity: capS, transform: `translateY(${interpolate(capS, [0, 1], [24, 0])}px)`, fontFamily: FONT.display, fontWeight: 900, fontSize: 84, color: C.ink1 }}>
          תחרות. צחוק. <span style={{ background: FIRE_GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>אדרנלין.</span>
        </div>
        <div style={{ transform: `scale(${interpolate(boardS, [0, 1], [0.92, 1])})`, opacity: boardS }}>
          <LeaderboardPanel width={980} rowH={110} />
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S5 REVEAL (VO: "הכירו את ראשפוינט. הפלטפורמה שהופכת כל אירוע למשחק שדה") — 213f ──
export const S5Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoS = spring({ frame, fps, config: { damping: 12, stiffness: 110 } });
  const spin = interpolate(frame, [0, 60], [-180, 0], { extrapolateRight: 'clamp' });
  const ring = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 44 }}>
        <div style={{ transform: `scale(${logoS})`, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: -70, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,87,34,0.35) 0%, transparent 70%)', opacity: ring, filter: 'blur(22px)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 34, direction: 'ltr' }}>
            <LogoMark size={190} spin={spin} />
            <Wordmark size={116} />
          </div>
        </div>
        <div style={{ width: '100%', opacity: interpolate(frame, [46, 76], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <KineticLine text="הפלטפורמה שהופכת כל אירוע *למשחק שדה*" startAt={50} size={62} weight={800} color={C.ink1} />
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S6 BUILD (VO: "בוחרים משימות, מסמנים נקודות על המפה, והמשחק מוכן תוך דקות") — 207f ──
export const S6Build: React.FC = () => {
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
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 36 }}>
        <div style={{ padding: '10px 40px', borderRadius: 18, background: 'rgba(7,8,15,0.72)', border: `1px solid ${C.border}`, backdropFilter: 'blur(8px)' }}>
          <CaptionStack
            size={44}
            width={1080}
            items={[
              { text: 'בוחרים משימות.', at: 8, dur: 58 },
              { text: 'מסמנים נקודות על המפה.', at: 72, dur: 60 },
              { text: 'המשחק מוכן — תוך דקות.', at: 140, dur: 60 },
            ]}
          />
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S7 JOIN (VO: "משתפים קוד אחד, וכל הקבוצות בפנים") — 153f ─────────────────
const SHARE = [
  { icon: '💬', label: 'וואטסאפ' },
  { icon: '▦', label: 'QR' },
  { icon: '🔗', label: 'קישור' },
];
export const S7Join: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const codeS = spring({ frame: frame - 4, fps, config: { damping: 13 } });
  const phoneS = spring({ frame: frame - 22, fps, config: { damping: 16 } });
  const float = Math.sin(frame / 30) * 8;
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, gap: 120, flexDirection: 'row' }}>
        <div style={{ transform: `scale(${codeS})`, opacity: codeS, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
          <div dir="rtl" style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: 34, letterSpacing: 2, color: C.ink2 }}>קוד הצטרפות</div>
          <div style={{ padding: '46px 80px', borderRadius: 34, background: FIRE_GRAD, boxShadow: '0 40px 110px -24px rgba(255,87,34,0.75)' }}>
            <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 168, color: '#fff', letterSpacing: 10, lineHeight: 1 }}>RUSH42</span>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 6 }}>
            {SHARE.map((sh, i) => {
              const s = spring({ frame: frame - 30 - i * 7, fps, config: { damping: 14 } });
              return (
                <div key={i} dir="rtl" style={{ transform: `scale(${s}) translateY(${interpolate(s, [0, 1], [16, 0])}px)`, opacity: s, display: 'flex', alignItems: 'center', gap: 12, padding: '16px 26px', borderRadius: 16, background: C.bg2, border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 30 }}>{sh.icon}</span>
                  <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 28, color: C.ink1 }}>{sh.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ transform: `translateY(${float}px) scale(${interpolate(phoneS, [0, 1], [0.82, 0.94])})`, opacity: phoneS }}>
          <PhoneFrame>
            <JoinScreen />
          </PhoneFrame>
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S8 PLAY+AUTO (VO: "מכאן הכול אוטומטי. ניווט, ניקוד, וטבלת מובילים בשידור חי. בלי שופטים, ובלי ניירת") — 339f ──
export const S8PlayAuto: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phoneS = spring({ frame, fps, config: { damping: 16 } });
  const split = interpolate(frame, [56, 100], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const phoneX = interpolate(split, [0, 1], [0, -520]);
  const boardX = interpolate(split, [0, 1], [760, 0]);
  const float = Math.sin(frame / 32) * 8;
  // phase B — "no judges" overlay near the end (VO says it at ~frame 200-260)
  const proofIn = interpolate(frame, [200, 232], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dim = interpolate(proofIn, [0, 1], [1, 0.28]);
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, opacity: dim }}>
        <div style={{ transform: `translateX(${phoneX}px) translateY(${float}px) scale(${interpolate(phoneS, [0, 1], [0.82, 0.9])})`, opacity: phoneS }}>
          <PhoneFrame>
            <PlayMapScreen />
          </PhoneFrame>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: dim }}>
        <div style={{ position: 'absolute', left: 940, transform: `translateX(${boardX}px)`, opacity: split }}>
          <LeaderboardPanel width={920} rowH={112} />
        </div>
      </AbsoluteFill>
      {/* top captions synced to VO */}
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 40, opacity: dim }}>
        <CaptionStack
          size={50}
          items={[
            { text: 'ניווט GPS אוטומטי.', at: 14, dur: 78 },
            { text: 'טבלת מובילים — בשידור חי.', at: 104, dur: 112 },
          ]}
        />
      </AbsoluteFill>
      {/* phase B overlay — no judges, no paperwork */}
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 38, opacity: proofIn, transform: `scale(${interpolate(proofIn, [0, 1], [0.94, 1])})` }}>
        <div style={{ display: 'flex', gap: 30 }}>
          {[
            { i: '🧑‍⚖️', l: 'שופטים', d: 0 },
            { i: '📝', l: 'ניירת', d: 9 },
            { i: '🧮', l: 'חישובים', d: 18 },
          ].map((c, k) => {
            const s = spring({ frame: frame - 208 - c.d, fps, config: { damping: 13 } });
            return (
              <div key={k} dir="rtl" style={{ transform: `scale(${s})`, opacity: s, display: 'flex', alignItems: 'center', gap: 12, padding: '18px 30px', borderRadius: 18, background: C.bg2, border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 40, filter: 'grayscale(1)', opacity: 0.6 }}>{c.i}</span>
                <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 30, color: C.ink3, textDecoration: 'line-through' }}>{c.l}</span>
              </div>
            );
          })}
        </div>
        <KineticLine text="הכול *אוטומטי.*" startAt={222} size={110} />
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S9 AUDIENCE (VO: "מושלם לימי גיבוש, תנועות נוער, ובר או בת מצווה") — 189f ──
const AUD = [
  { icon: '🧭', label: 'מדריכים' },
  { icon: '🏢', label: 'ימי גיבוש' },
  { icon: '🎈', label: 'פעילות להורים' },
  { icon: '👨‍👩‍👧‍👦', label: 'המשפחה המורחבת' },
];
export const S9Audience: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <DarkBackground>
      <AbsoluteFill style={{ ...center, flexDirection: 'column', gap: 46 }}>
        <Eyebrow text="מושלם עבור" startAt={2} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36 }}>
          {AUD.map((a, i) => {
            // pop in as the VO names each audience (~2s apart, starting ~frame 22)
            const s = spring({ frame: frame - 22 - i * 55, fps, config: { damping: 13, stiffness: 120 } });
            return (
              <div
                key={i}
                dir="rtl"
                style={{
                  transform: `scale(${s}) translateY(${interpolate(s, [0, 1], [30, 0])}px)`,
                  opacity: s,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 30,
                  padding: '48px 60px',
                  width: 780,
                  borderRadius: 26,
                  background: C.bg2,
                  border: `1px solid ${C.border}`,
                  boxShadow: '0 24px 56px -20px rgba(0,0,0,0.65)',
                }}
              >
                <div style={{ width: 104, height: 104, borderRadius: 24, background: FIRE_GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, flexShrink: 0 }}>{a.icon}</div>
                <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 50, color: C.ink1 }}>{a.label}</span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </DarkBackground>
  );
};

// ── S10 CTA (VO: "בנו את המשחק הראשון שלכם, בחינם. ראשפוינט. המשחק יוצא החוצה") — 273f ──
export const S10CTA: React.FC = () => {
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
