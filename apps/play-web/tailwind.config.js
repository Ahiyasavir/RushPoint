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
        'app-bg':       '#0B0F17',
        'app-surface':  '#111827',
        'app-card':     '#0F172A',
        'app-raised':   '#1E293B',
        'accent':       '#22D3EE',   // electric turquoise — success/progress accent
        'accent-warm':  '#F59E0B',
        'accent-gold':  '#D4AF37',
        'danger':       '#EF4444',
        'glass-border': 'rgba(255,255,255,0.08)',
        'glass-hover':  'rgba(255,255,255,0.12)',
      },
    },
  },
  plugins: [],
};
