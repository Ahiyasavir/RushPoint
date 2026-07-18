import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from './lib/theme';
import { DarkBackground } from './ui/Background';
import { LogoMark, Wordmark } from './ui/Logo';
import { PhoneFrame } from './ui/Phone';
import { JoinScreen } from './ui/mocks/JoinScreen';
import { PlayMapScreen } from './ui/mocks/PlayMapScreen';
import { FinalScreen } from './ui/mocks/FinalScreen';
import { KineticLine } from './ui/Kinetic';
import { Confetti } from './ui/Confetti';

export const SOCIAL_DURATION = 600; // 20s @ 30fps

const TopCaption: React.FC<{ text: string; accent?: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 15 } });
  return (
    <div
      dir="rtl"
      style={{
        position: 'absolute',
        top: 150,
        left: 60,
        right: 60,
        textAlign: 'center',
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [-30, 0])}px)`,
        fontFamily: FONT.display,
        fontWeight: 900,
        fontSize: 82,
        lineHeight: 1.08,
        color: C.ink1,
        textShadow: '0 6px 30px rgba(0,0,0,0.5)',
        zIndex: 30,
      }}
    >
      {text}
    </div>
  );
};

const PhoneStage: React.FC<{ children: React.ReactNode; scale?: number }> = ({ children, scale = 1.32 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 70 }}>
      <div style={{ transform: `scale(${scale * interpolate(s, [0, 1], [0.94, 1])})`, opacity: s }}>
        <PhoneFrame>{children}</PhoneFrame>
      </div>
    </AbsoluteFill>
  );
};

export const SocialCut: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg0 }}>
      {/* S1: brand hook 0-96 */}
      <Sequence from={0} durationInFrames={96}>
        <DarkBackground>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 30 }}>
            <BrandBurst />
            <div style={{ width: '100%', textAlign: 'center' }}>
              <KineticLine text="*משחק שדה* — תוך דקות" startAt={24} size={72} />
            </div>
          </AbsoluteFill>
        </DarkBackground>
      </Sequence>

      {/* S2: join 96-252 */}
      <Sequence from={96} durationInFrames={156}>
        <DarkBackground>
          <TopCaption text="קוד אחד. כולם בפנים." />
          <PhoneStage><JoinScreen /></PhoneStage>
        </DarkBackground>
      </Sequence>

      {/* S3: play 252-444 */}
      <Sequence from={252} durationInFrames={192}>
        <DarkBackground>
          <TopCaption text="GPS מנתב · הטבלה חיה" />
          <PhoneStage><PlayMapScreen /></PhoneStage>
        </DarkBackground>
      </Sequence>

      {/* S4: final 444-540 */}
      <Sequence from={444} durationInFrames={96}>
        <DarkBackground>
          <TopCaption text="ניקוד אוטומטי. בלי שופטים." />
          <PhoneStage><FinalScreen /></PhoneStage>
        </DarkBackground>
      </Sequence>

      {/* S5: CTA 540-600 */}
      <Sequence from={540} durationInFrames={60}>
        <DarkBackground>
          <Confetti count={50} startAt={0} width={1080} height={1920} />
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 28 }}>
            <LogoMark size={150} />
            <Wordmark size={78} />
            <div style={{ padding: '20px 44px', borderRadius: 18, background: FIRE_GRAD, boxShadow: '0 20px 50px -14px rgba(255,87,34,0.7)' }}>
              <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 46, color: '#fff' }}>rushpoint.app</span>
            </div>
          </AbsoluteFill>
        </DarkBackground>
      </Sequence>
    </AbsoluteFill>
  );
};

const BrandBurst: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 11, stiffness: 110 } });
  const spin = interpolate(frame, [0, 50], [-160, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ transform: `scale(${s})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <LogoMark size={200} spin={spin} />
      <Wordmark size={96} />
    </div>
  );
};
