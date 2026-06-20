/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        brand: ['Outfit', 'Inter', 'sans-serif'],
        mono:  ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // ── "Warm Trail" — light, airy & inviting (mirrors creator-web) ──
        'app-bg':       '#FBF7F0',  // warm parchment
        'app-surface':  '#FFFFFF',
        'app-card':     '#FFFFFF',
        'app-raised':   '#F3ECE0',  // warm sand
        'accent':       '#F97316',  // electric-orange — success / progress
        'accent-warm':  '#EA580C',
        'accent-gold':  '#CA8A04',
        'danger':       '#E11D48',
        'glass-border': 'rgba(90,70,45,0.14)',
        'glass-hover':  'rgba(90,70,45,0.06)',
        // Reversed/warm text scale so existing text-zinc-* reads dark on light.
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
        'soft': '0 1px 2px rgba(60,45,25,0.06), 0 4px 12px -4px rgba(60,45,25,0.10)',
      },
    },
  },
  plugins: [],
};
