import { tailwindFontFamily, tailwindFontSize, tailwindInkColors } from '@rushpoint/brand';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // From the brand package (packages/brand/tokens.mjs), never restated
      // here. Both faces carry Hebrew AND Latin; the previous pairing loaded
      // latin only, so Hebrew fell through to the system font.
      fontFamily: tailwindFontFamily(),
      // Also from the brand package: xs/sm bumped so "secondary text" stops
      // meaning "barely readable" (packages/brand/tokens.mjs has the full story).
      fontSize: tailwindFontSize(),
      colors: {
        // ── Brand tokens ──────────────────────────────────────────────────────
        'rp-fire':   '#FF5722',
        'rp-amber':  '#FFB300',
        'rp-plasma': '#06B6D4',
        'rp-go':     '#10B981',
        'rp-alert':  '#EF4444',

        // ── "Warm Trail" legacy tokens ────────────────────────────────────────
        'app-bg':       '#FFFCF7',
        'app-surface':  '#FFFFFF',
        'app-card':     '#FFFFFF',
        'app-raised':   '#FFF0E6',
        'accent':       '#FF5722',
        'accent-warm':  '#FF8A00',
        'accent-gold':  '#FFB300',
        'danger':       '#EF4444',
        'glass-border': 'rgba(90,70,45,0.12)',
        'glass-hover':  'rgba(90,70,45,0.06)',

        // ── "Ink" text tokens (change: play-web-accessibility) ────────────────
        // The brand colours above FAIL WCAG AA as text on this light theme:
        // #FF5722 = 3.16:1, #FF8A00 = 2.36:1, #FFB300 = 1.79:1, #EF4444 = 3.76:1
        // and #10B981 = 2.54:1 on white. Participants read this screen outdoors in
        // direct sun, so these are the darkened variants used for TEXT ONLY —
        // every fill, border, ring and gradient keeps the original brand colour,
        // which is why they are separate tokens and not a retune.
        //
        // Moved to packages/brand/tokens.mjs (the single source, so creator-web
        // can share it instead of drifting): scripts/test-play-a11y-scan.ts now
        // reads the hex values from THERE, not from this file's text.
        ...tailwindInkColors(),

        // Reversed/warm text scale — dark text on light background.
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
        'soft':      '0 1px 2px rgba(60,45,25,0.06), 0 4px 12px -4px rgba(60,45,25,0.10)',
        'task-card': '0 2px 8px rgba(26,10,0,0.08), 0 8px 24px -6px rgba(26,10,0,0.10)',
        'card-hover':'0 4px 16px rgba(26,10,0,0.12), 0 12px 40px -8px rgba(26,10,0,0.14)',
        'cta-glow':  '0 4px 20px rgba(255,87,34,0.50), 0 1px 4px rgba(255,87,34,0.30)',
        'stage-badge':'0 2px 8px rgba(255,87,34,0.25)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
        'hero-warm':       'linear-gradient(160deg, #FFF4E6 0%, #FFFCF7 60%)',
        'gradient-fire':   'linear-gradient(135deg, #FF5722 0%, #FFB300 100%)',
        'dot-grid':        'radial-gradient(rgba(90,70,45,0.18) 1px, transparent 1px)',
      },
      backgroundSize: {
        'dot': '20px 20px',
      },
      animation: {
        'race-in':     'race-in 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'task-appear': 'task-appear 0.35s ease-out both',
        'score-pop':   'score-pop 0.6s cubic-bezier(0.34,1.56,0.64,1) both',
        'finish-pulse':'finish-pulse 2s ease-in-out infinite',
        'shimmer':     'shimmer 2.5s ease-in-out infinite',
        'fade-up':     'fade-up 0.4s ease-out both',
        // Squash-and-stretch receipt for the answer the player just tapped
        // (change: test-mode-game-feel). Unlike score-pop this is NOT an
        // entrance — the element is already on screen, so it starts and ends at
        // scale 1 and only dips and overshoots in between.
        'answer-pop':  'answer-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
      },
      keyframes: {
        'race-in': {
          '0%':   { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'task-appear': {
          '0%':   { opacity: '0', transform: 'scale(0.95) translateY(8px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'score-pop': {
          '0%':   { opacity: '0', transform: 'scale(0.5)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'finish-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,87,34,0)' },
          '50%':       { boxShadow: '0 0 0 16px rgba(255,87,34,0)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'answer-pop': {
          '0%':   { transform: 'scale(1)' },
          '30%':  { transform: 'scale(0.94)' },
          '60%':  { transform: 'scale(1.04)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
