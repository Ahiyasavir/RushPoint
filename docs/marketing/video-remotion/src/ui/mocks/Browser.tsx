import React from 'react';
import { C, FONT } from '../../lib/theme';

export const BrowserChrome: React.FC<{
  url?: string;
  width: number;
  height: number;
  children: React.ReactNode;
}> = ({ url = 'rushpoint.app/build', width, height, children }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 20,
      overflow: 'hidden',
      background: C.bg1,
      border: `1px solid ${C.border}`,
      boxShadow: '0 50px 140px -40px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.03)',
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    <div
      style={{
        height: 52,
        flexShrink: 0,
        background: '#0A0B14',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', gap: 9 }}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          height: 30,
          borderRadius: 8,
          background: '#151726',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontFamily: FONT.mono,
          fontSize: 15,
          color: C.ink2,
          maxWidth: 420,
          margin: '0 auto',
        }}
      >
        <span style={{ color: C.go, fontSize: 12 }}>🔒</span>
        {url}
      </div>
      <div style={{ width: 60 }} />
    </div>
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>{children}</div>
  </div>
);
