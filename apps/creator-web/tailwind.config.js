import { tailwindFontFamily } from '@rushpoint/brand';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // From the brand package (packages/brand/tokens.mjs), never restated
      // here. Both faces carry Hebrew AND Latin; the previous pairing loaded
      // latin only, so Hebrew fell through to the system font.
      fontFamily: tailwindFontFamily(),
      colors: {
        // ── Brand accent tokens ───────────────────────────────────────────────
        'rp-fire':   '#FF5722',
        'rp-amber':  '#FFB300',
        'rp-plasma': '#06B6D4',
        'rp-signal': '#7C3AED',
        'rp-go':     '#10B981',
        'rp-alert':  '#EF4444',

        // ── Legacy "Warm Trail" tokens (kept for backward compat) ─────────────
        'app-bg':       '#FBF7F0',
        'app-surface':  '#FFFFFF',
        'app-card':     '#FFFFFF',
        'app-raised':   '#F3ECE0',
        'neon-green':   '#FF5722',  // updated to rp-fire
        'neon-cyan':    '#06B6D4',
        'neon-orange':  '#FF8A00',
        'neon-red':     '#EF4444',
        'neon-gold':    '#FFB300',
        'neon-blue':    '#2563EB',
        'neon-purple':  '#7C3AED',
        'slot-green':   '#FF5722',
        'slot-orange':  '#FF8A00',
        'slot-gold':    '#FFB300',
        'glass-bg':     'rgba(255,255,255,0.85)',
        'glass-border': 'rgba(90,70,45,0.14)',
        'glass-hover':  'rgba(90,70,45,0.06)',

        // ── Text scale (reversed so text-zinc-* reads dark on light bg) ───────
        zinc: {
          50:  '#fafaf9',
          100: '#1c1917',
          200: '#292524',
          300: '#44403c',
          400: '#57534e',
          500: '#78716c',
          600: '#a8a29e',
          700: '#d6d3d1',
          800: '#e7e5e4',
          900: '#f5f5f4',
        },
      },
      boxShadow: {
        'soft':        '0 1px 2px rgba(60,45,25,0.06), 0 4px 12px -4px rgba(60,45,25,0.10)',
        'card-light':  '0 1px 3px rgba(15,16,32,0.06), 0 8px 24px -6px rgba(15,16,32,0.08)',
        'card-dark':   '0 1px 3px rgba(0,0,0,0.30), 0 8px 24px -6px rgba(0,0,0,0.40)',
        'card-hover':  '0 4px 16px rgba(15,16,32,0.10), 0 12px 40px -8px rgba(15,16,32,0.12)',
        'glow-fire':   '0 4px 20px rgba(255,87,34,0.45), 0 1px 4px rgba(255,87,34,0.3)',
        'glow-subtle': '0 2px 12px rgba(255,87,34,0.20)',
        'glow-green':  '0 8px 24px -10px rgba(255,87,34,0.45)',
        'glow-orange': '0 8px 24px -10px rgba(234,88,12,0.45)',
        'glow-gold':   '0 8px 24px -10px rgba(255,179,0,0.45)',
        'glow-cyan':   '0 8px 24px -10px rgba(6,182,212,0.45)',
        'glow-red':    '0 8px 24px -10px rgba(239,68,68,0.45)',
        'glow-blue':   '0 8px 24px -10px rgba(37,99,235,0.40)',
        'glow-purple': '0 8px 24px -10px rgba(124,58,237,0.40)',
        'glow-cta':    '0 8px 28px -6px rgba(255,87,34,0.55)',
        'inner-glow':  'inset 0 1px 0 0 rgba(255,255,255,0.6)',
      },
      backgroundImage: {
        'gradient-radial':  'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
        'gradient-fire':    'linear-gradient(135deg, #FF5722 0%, #FFB300 100%)',
        'grid-pattern':     `linear-gradient(rgba(90,70,45,0.05) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(90,70,45,0.05) 1px, transparent 1px)`,
        'hero-glow':        'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,87,34,0.12) 0%, transparent 70%)',
        'dark-hero-glow':   'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,87,34,0.18) 0%, transparent 70%)',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
      animation: {
        'pulse-neon':   'pulse-neon 2s ease-in-out infinite',
        'shimmer':      'shimmer 2.5s ease-in-out infinite',
        'float':        'float 3s ease-in-out infinite',
        'glow-pulse':   'glow-pulse 2s ease-in-out infinite',
        'fade-up':      'fade-up 0.4s ease-out both',
        'score-pop':    'score-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
        'border-glow':  'border-glow 3s ease-in-out infinite',
      },
      keyframes: {
        'pulse-neon': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.7' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'score-pop': {
          '0%':   { opacity: '0', transform: 'scale(0.7)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'border-glow': {
          '0%, 100%': { opacity: '0.6' },
          '50%':      { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
