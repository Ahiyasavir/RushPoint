const { hairlineWidth } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'monospace'],
        brand: ['Outfit', 'Inter', 'sans-serif'],
      },
      colors: {
        // ── "Jerusalem Stone & Sapphire" — premium matte dark ──────────────
        // Token NAMES are kept (neon-*) so screens don't need rewriting, but the
        // VALUES are now a mature gold/sapphire/slate palette — no arcade neon.
        'app-bg':       '#0B0F17',  // matte obsidian
        'app-surface':  '#111827',
        'app-card':     '#0F172A',  // slate-900
        'app-raised':   '#1E293B',  // slate-800
        // ── Accents ────────────────────────────────────────────────────────
        'neon-green':   '#F59E0B',  // PRIMARY — amber: active states, progression, scores
        'neon-cyan':    '#2563EB',  // SECONDARY — sapphire: matchmaking / structure
        'neon-orange':  '#D97706',  // deep amber — Tene-finding stage
        'neon-red':     '#EF4444',  // clean red — SOS / urgency
        'neon-gold':    '#D4AF37',  // metallic gold — Tene / trophy / victory
        'neon-blue':    '#2563EB',  // sapphire (nav / frozen / structural)
        'neon-purple':  '#8b5cf6',
        // ── Slot type colours ─────────────────────────────────────────────
        'slot-green':   '#F59E0B',
        'slot-orange':  '#D97706',
        'slot-gold':    '#D4AF37',
        // ── Surfaces / borders (flat, crisp — no glow) ─────────────────────
        'glass-bg':     'rgba(15,23,42,0.9)',    // slate-900/90 (near-solid)
        'glass-border': 'rgba(255,255,255,0.06)',// crisp 1px hairline
        'glass-hover':  'rgba(255,255,255,0.10)',
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      boxShadow: {
        // No neon auras — crisp, realistic elevation (premium card lift).
        'glow-green':   '0 10px 30px -12px rgba(0,0,0,0.7)',
        'glow-orange':  '0 10px 30px -12px rgba(0,0,0,0.7)',
        'glow-gold':    '0 10px 30px -12px rgba(0,0,0,0.7)',
        'glow-cyan':    '0 10px 30px -12px rgba(0,0,0,0.7)',
        'glow-red':     '0 10px 30px -12px rgba(0,0,0,0.7)',
        'glow-blue':    '0 10px 30px -12px rgba(0,0,0,0.7)',
        'glow-purple':  '0 10px 30px -12px rgba(0,0,0,0.7)',
        'glow-cta':     '0 12px 32px -10px rgba(0,0,0,0.8)',
        'inner-glow':   'inset 0 1px 0 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
        'grid-pattern': `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
      animation: {
        'pulse-neon': 'pulse-neon 2s ease-in-out infinite',
        'shimmer':    'shimmer 2.5s ease-in-out infinite',
        'float':      'float 3s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
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
      },
    },
  },
  plugins: [],
};
