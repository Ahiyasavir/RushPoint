/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'monospace'],
        brand: ['Outfit', 'Inter', 'sans-serif'],
      },
      colors: {
        // ── Base palette — "Cyber-Biblical Neon" (deep pitch black) ────────
        'app-bg':       '#030712',  // slate-950
        'app-surface':  '#0b1220',
        'app-card':     '#0f172a',  // slate-900
        'app-raised':   '#1e293b',  // slate-800
        // ── Neon accents ──────────────────────────────────────────────────
        'neon-green':   '#39FF14',  // tasks / progression
        'neon-cyan':    '#00F0FF',  // duels / matchmaking
        'neon-orange':  '#ff6b00',
        'neon-red':     '#FF0055',  // SOS / urgency
        'neon-gold':    '#FFD700',  // Tene / trophy
        'neon-blue':    '#00aaff',
        'neon-purple':  '#a855f7',
        // ── Slot type colours ─────────────────────────────────────────────
        'slot-green':   '#39FF14',
        'slot-orange':  '#ff6b00',
        'slot-gold':    '#FFD700',
        // ── Glass ─────────────────────────────────────────────────────────
        'glass-bg':     'rgba(15,23,42,0.6)',
        'glass-border': 'rgba(255,255,255,0.10)',
        'glass-hover':  'rgba(255,255,255,0.14)',
      },
      boxShadow: {
        'glow-green':   '0 0 24px 4px rgba(57,255,20,0.35)',
        'glow-orange':  '0 0 24px 4px rgba(255,107,0,0.35)',
        'glow-gold':    '0 0 24px 4px rgba(255,215,0,0.35)',
        'glow-cyan':    '0 0 24px 4px rgba(0,240,255,0.35)',
        'glow-red':     '0 0 24px 4px rgba(255,0,85,0.35)',
        'glow-blue':    '0 0 24px 4px rgba(0,170,255,0.35)',
        'glow-purple':  '0 0 24px 4px rgba(168,85,247,0.35)',
        'glow-cta':     '0 4px 28px 4px rgba(57,255,20,0.45)',
        'inner-glow':   'inset 0 1px 0 0 rgba(255,255,255,0.06)',
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
          '0%, 100%': { boxShadow: '0 0 20px 2px rgba(57,255,20,0.3)' },
          '50%':      { boxShadow: '0 0 40px 8px rgba(57,255,20,0.5)' },
        },
      },
    },
  },
  plugins: [],
};
