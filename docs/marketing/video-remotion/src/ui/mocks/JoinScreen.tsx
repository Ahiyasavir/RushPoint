import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../../lib/theme';
import { LogoMark } from '../Logo';

// play-web Join screen (light warm theme), inside a PhoneFrame.
export const JoinScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const code = 'RUSH42';
  const typed = Math.floor(interpolate(frame, [20, 74], [0, 6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const joined = frame > 92;
  const btn = spring({ frame: frame - 84, fps, config: { damping: 12 } });
  const success = spring({ frame: frame - 94, fps, config: { damping: 11, stiffness: 120 } });

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,#FFF4E6 0%,#FFFCF7 60%)', paddingTop: 90, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ transform: 'scale(1)', marginBottom: 6 }}>
        <LogoMark size={92} />
      </div>
      <div dir="rtl" style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 34, color: C.warmInk, marginTop: 14 }}>הצטרפו למשחק</div>
      <div dir="rtl" style={{ fontFamily: FONT.body, fontSize: 18, color: C.warmInk2, marginTop: 6 }}>הזינו את הקוד מהמארגן</div>

      {!joined ? (
        <>
          <div style={{ display: 'flex', gap: 10, marginTop: 40, direction: 'ltr' }}>
            {code.split('').map((ch, i) => (
              <div
                key={i}
                style={{
                  width: 46,
                  height: 60,
                  borderRadius: 12,
                  background: '#fff',
                  border: `2px solid ${i < typed ? C.fire : C.warmBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: 30,
                  color: C.warmInk,
                  boxShadow: i < typed ? '0 6px 16px -8px rgba(255,87,34,0.5)' : 'none',
                }}
              >
                {i < typed ? ch : ''}
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 44,
              width: 300,
              padding: '18px 0',
              textAlign: 'center',
              borderRadius: 16,
              background: FIRE_GRAD,
              color: '#fff',
              fontFamily: FONT.display,
              fontWeight: 800,
              fontSize: 24,
              transform: `scale(${1 - btn * 0.06})`,
              opacity: typed >= 6 ? 1 : 0.5,
              boxShadow: '0 12px 30px -10px rgba(255,87,34,0.6)',
            }}
          >
            כניסה למשחק
          </div>
        </>
      ) : (
        <div style={{ marginTop: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${success})`, opacity: success }}>
          <div style={{ width: 130, height: 130, borderRadius: '50%', background: C.go, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 16px 40px -10px rgba(16,185,129,0.6)' }}>
            <svg width="70" height="70" viewBox="0 0 24 24"><path d="M5 13 L10 18 L20 6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div dir="rtl" style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 30, color: C.warmInk, marginTop: 26 }}>הצטרפתם! 🎉</div>
          <div dir="rtl" style={{ fontFamily: FONT.body, fontSize: 19, color: C.warmInk2, marginTop: 6 }}>קבוצה: הנמרים הכתומים</div>
        </div>
      )}
    </div>
  );
};
