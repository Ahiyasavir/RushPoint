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
        // ── "Warm Trail" — light, airy & inviting ──────────────────────────
        'app-bg':       '#FBF7F0',  // warm parchment
        'app-surface':  '#FFFFFF',
        'app-card':     '#FFFFFF',  // crisp white cards
        'app-raised':   '#F3ECE0',  // warm sand — raised / hover surfaces
        // ── Accents (warm, vivid; one primary) ─────────────────────────────
        'neon-green':   '#F97316',  // PRIMARY electric-orange: active / progress / CTAs
        'neon-cyan':    '#0D9488',  // SECONDARY teal: structure / routed pools
        'neon-orange':  '#EA580C',
        'neon-red':     '#E11D48',  // warm rose-red
        'neon-gold':    '#CA8A04',  // amber gold — trophy / scores
        'neon-blue':    '#2563EB',
        'neon-purple':  '#7C3AED',
        // ── Slot type colours ─────────────────────────────────────────────
        'slot-green':   '#F97316',
        'slot-orange':  '#EA580C',
        'slot-gold':    '#CA8A04',
        // ── Surfaces / borders (soft warm) ─────────────────────────────────
        'glass-bg':     'rgba(255,255,255,0.85)',
        'glass-border': 'rgba(90,70,45,0.14)',
        'glass-hover':  'rgba(90,70,45,0.06)',
        // ── Text scale (reversed/warm so existing text-zinc-* reads dark) ──
        zinc: {
          50:  '#fafaf9',
          100: '#1c1917',  // primary text
          200: '#292524',
          300: '#44403c',
          400: '#57534e',  // secondary text
          500: '#78716c',  // muted text
          600: '#a8a29e',  // faint text
          700: '#d6d3d1',
          800: '#e7e5e4',
          900: '#f5f5f4',
        },
      },
      boxShadow: {
        // Soft, realistic light-theme elevation — no neon auras.
        'soft':         '0 1px 2px rgba(60,45,25,0.06), 0 4px 12px -4px rgba(60,45,25,0.10)',
        'glow-green':   '0 8px 24px -10px rgba(249,115,22,0.45)',
        'glow-orange':  '0 8px 24px -10px rgba(234,88,12,0.45)',
        'glow-gold':    '0 8px 24px -10px rgba(202,138,4,0.40)',
        'glow-cyan':    '0 8px 24px -10px rgba(13,148,136,0.40)',
        'glow-red':     '0 8px 24px -10px rgba(225,29,72,0.40)',
        'glow-blue':    '0 8px 24px -10px rgba(37,99,235,0.40)',
        'glow-purple':  '0 8px 24px -10px rgba(124,58,237,0.40)',
        'glow-cta':     '0 10px 28px -8px rgba(249,115,22,0.50)',
        'inner-glow':   'inset 0 1px 0 0 rgba(255,255,255,0.6)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
        'grid-pattern': `linear-gradient(rgba(90,70,45,0.05) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(90,70,45,0.05) 1px, transparent 1px)`,
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
